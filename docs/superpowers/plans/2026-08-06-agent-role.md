# Agent Role & Downline Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third `casino_members.role` value, `'agent'`, whose holders get read-only Members/Stats/Trades access scoped server-side to a "downline" of members an owner/admin explicitly assigns to them from the member profile popup.

**Architecture:** One migration adds the `agent_id` downline column, widens the role constraint, and adds/updates RPCs so agent-scoped reads are enforced in SQL (not just hidden in the UI). The frontend (all in `CasinoDashboard.tsx` + its two hooks) adds an `isAgent` branch alongside the existing `isOwner`/`isAdmin`, a new "Assign agent" flow in the member popup, and switches the Members tab's data source from a raw table read to the new scoped RPC.

**Tech Stack:** Vite + React + TypeScript, Supabase (Postgres + RPCs, no ORM), Zustand, Tailwind. No existing unit-test coverage for RPCs or this page — verification is via `tsc`/build, direct SQL checks (Supabase MCP `execute_sql`/`get_advisors`), and Playwright against the running dev server, matching this repo's existing conventions.

---

## Task 1: Database migration — agent role, downline column, and RPCs

**Files:**
- Create: `supabase/migrations/043_agent_role.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Add an 'agent' role: a scoped-visibility role that can view (not manage)
-- a subset of casino members ("downline") assigned to them by an owner/admin.

-- 1. Widen the role check constraint to allow 'agent'.
alter table public.casino_members drop constraint if exists casino_members_role_check;
alter table public.casino_members add constraint casino_members_role_check
  check (role = any (array['member'::text, 'admin'::text, 'agent'::text]));

-- 2. Downline link: which agent (by user_id) a member reports to, if any.
alter table public.casino_members add column if not exists agent_id uuid references auth.users(id) on delete set null;
create index if not exists casino_members_agent_id_idx on public.casino_members (casino_id, agent_id);

-- 3. Shared authorization helpers (replacing the "owner OR role='admin'" block
-- duplicated across several RPCs below).
create or replace function public.is_casino_owner_or_admin(p_casino_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.casinos where id = p_casino_id and owner_id = auth.uid()
    union all
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_casino_agent(p_casino_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'agent'
  );
$$;

-- 4. set_member_role: allow 'agent' as a settable role. Promoting to agent
-- clears the member's own agent_id (agents can't be someone's downline).
-- Demoting away from agent clears agent_id for their former downline.
create or replace function public.set_member_role(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_new_role text
) returns void
language plpgsql
security definer
as $$
declare
  v_old_role text;
begin
  if (select owner_id from public.casinos where id = p_casino_id) is distinct from auth.uid() then
    raise exception 'Only the casino creator can change member roles';
  end if;
  if p_new_role not in ('member', 'admin', 'agent') then
    raise exception 'Role must be member, admin, or agent';
  end if;
  if p_target_user_id = auth.uid() then
    raise exception 'Cannot change your own role';
  end if;

  select role into v_old_role
  from public.casino_members
  where casino_id = p_casino_id and user_id = p_target_user_id;

  if not found then
    raise exception 'Member not found';
  end if;

  update public.casino_members
  set role = p_new_role,
      agent_id = case when p_new_role = 'agent' then null else agent_id end
  where casino_id = p_casino_id and user_id = p_target_user_id;

  if v_old_role = 'agent' and p_new_role <> 'agent' then
    update public.casino_members
    set agent_id = null
    where casino_id = p_casino_id and agent_id = p_target_user_id;
  end if;
end;
$$;

-- 5. Assign (or unassign, when p_agent_user_id is null) which agent a member
-- reports to. Owner or admin only. Rejects assigning an agent under another agent.
create or replace function public.assign_member_agent(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_agent_user_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_target_role text;
  v_agent_role text;
begin
  if not public.is_casino_owner_or_admin(p_casino_id) then
    raise exception 'Only the casino creator or an admin can assign an agent';
  end if;

  select role into v_target_role
  from public.casino_members
  where casino_id = p_casino_id and user_id = p_target_user_id;

  if not found then
    raise exception 'Member not found';
  end if;

  if v_target_role = 'agent' then
    raise exception 'An agent cannot be assigned to another agent''s downline';
  end if;

  if p_agent_user_id is not null then
    select role into v_agent_role
    from public.casino_members
    where casino_id = p_casino_id and user_id = p_agent_user_id;

    if v_agent_role is distinct from 'agent' then
      raise exception 'Target is not an agent in this casino';
    end if;
  end if;

  update public.casino_members
  set agent_id = p_agent_user_id
  where casino_id = p_casino_id and user_id = p_target_user_id;
end;
$$;

-- 6. Scoped member list: owner/admin see everyone, an agent sees only their
-- downline, anyone else sees nothing. Replaces the frontend's previous raw
-- `select * from casino_members`, which relied on an RLS policy that lets
-- any casino member read every other member's row (balances included) —
-- an acceptable gap while only owner/admin could reach the Members tab, but
-- agents now need a real server-side restriction, not just a UI gate.
create or replace function public.get_casino_members(p_casino_id uuid)
returns table (
  id uuid,
  casino_id uuid,
  user_id uuid,
  balance numeric(14,2),
  role text,
  agent_id uuid,
  joined_at timestamptz,
  last_played_at timestamptz,
  profile jsonb
)
language plpgsql
security definer
as $$
declare
  v_is_owner_or_admin boolean;
  v_is_agent boolean;
begin
  v_is_owner_or_admin := public.is_casino_owner_or_admin(p_casino_id);
  v_is_agent := public.is_casino_agent(p_casino_id);

  return query
  select cm.id, cm.casino_id, cm.user_id, cm.balance, cm.role, cm.agent_id,
         cm.joined_at, cm.last_played_at,
         jsonb_build_object('username', p.username, 'avatar_url', p.avatar_url) as profile
  from public.casino_members cm
  left join public.profiles p on p.id = cm.user_id
  where cm.casino_id = p_casino_id
    and (
      v_is_owner_or_admin
      or (v_is_agent and cm.agent_id = auth.uid())
    )
  order by cm.joined_at asc;
end;
$$;

-- 7. get_member_profit_loss: authorize agents for members in their downline.
create or replace function public.get_member_profit_loss(
  p_casino_id   uuid,
  p_user_id     uuid,
  p_from        timestamptz default null,
  p_to          timestamptz default null
) returns numeric(14,2)
language plpgsql
security definer
as $$
declare
  v_authorized  boolean;
  v_profit_loss numeric(14,2);
begin
  select
    public.is_casino_owner_or_admin(p_casino_id)
    or (
      public.is_casino_agent(p_casino_id)
      and exists (
        select 1 from public.casino_members
        where casino_id = p_casino_id and user_id = p_user_id and agent_id = auth.uid()
      )
    )
  into v_authorized;

  if not v_authorized then
    raise exception 'Not authorized to view member stats';
  end if;

  select coalesce(sum(amount), 0)
  into v_profit_loss
  from public.transactions
  where casino_id    = p_casino_id
    and user_id      = p_user_id
    and game_type_id is not null
    and (p_from is null or created_at >= p_from)
    and (p_to   is null or created_at <= p_to);

  return v_profit_loss;
end;
$$;

-- 8. get_casino_stats / get_casino_profit_loss_timeseries: authorize agents,
-- scoped to their downline's transactions only.
create or replace function public.get_casino_stats(
  p_casino_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_game_type_id text default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_is_owner_or_admin boolean;
  v_is_agent boolean;
  v_player_pl numeric(14,2);
begin
  v_is_owner_or_admin := public.is_casino_owner_or_admin(p_casino_id);
  v_is_agent := public.is_casino_agent(p_casino_id);

  if not (v_is_owner_or_admin or v_is_agent) then
    raise exception 'Not authorized';
  end if;

  select coalesce(sum(amount), 0)
  into v_player_pl
  from public.transactions t
  where t.casino_id = p_casino_id
    and t.game_type_id is not null
    and (p_from is null or t.created_at >= p_from)
    and (p_to is null or t.created_at <= p_to)
    and (p_game_type_id is null or t.game_type_id = p_game_type_id)
    and (
      v_is_owner_or_admin
      or exists (
        select 1 from public.casino_members cm
        where cm.casino_id = p_casino_id and cm.user_id = t.user_id and cm.agent_id = auth.uid()
      )
    );

  return jsonb_build_object('player_profit_loss', v_player_pl);
end;
$$;

create or replace function public.get_casino_profit_loss_timeseries(
  p_casino_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_game_type_id text default null
) returns table(bucket date, daily_amount numeric)
language plpgsql security definer as $$
declare
  v_is_owner_or_admin boolean;
  v_is_agent boolean;
begin
  v_is_owner_or_admin := public.is_casino_owner_or_admin(p_casino_id);
  v_is_agent := public.is_casino_agent(p_casino_id);

  if not (v_is_owner_or_admin or v_is_agent) then
    raise exception 'Not authorized';
  end if;

  return query
  select
    date_trunc('day', t.created_at at time zone 'UTC')::date as bucket,
    sum(t.amount)::numeric as daily_amount
  from public.transactions t
  where t.casino_id = p_casino_id
    and t.game_type_id is not null
    and (p_from is null or t.created_at >= p_from)
    and (p_to is null or t.created_at <= p_to)
    and (p_game_type_id is null or t.game_type_id = p_game_type_id)
    and (
      v_is_owner_or_admin
      or exists (
        select 1 from public.casino_members cm
        where cm.casino_id = p_casino_id and cm.user_id = t.user_id and cm.agent_id = auth.uid()
      )
    )
  group by date_trunc('day', t.created_at at time zone 'UTC')::date
  order by bucket;
end;
$$;

-- 9. list_chip_transactions: agents see ledger rows for their downline too.
create or replace function public.list_chip_transactions(
  p_casino_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns table (
  id uuid,
  user_id uuid,
  username text,
  admin_id uuid,
  admin_username text,
  amount numeric(14,2),
  balance_after numeric(14,2),
  created_at timestamptz
) language plpgsql security definer as $$
declare
  v_is_owner_or_admin boolean;
  v_is_agent boolean;
begin
  v_is_owner_or_admin := public.is_casino_owner_or_admin(p_casino_id);
  v_is_agent := public.is_casino_agent(p_casino_id);

  return query
  select t.id, t.user_id, p.username, t.admin_id, pa.username,
         t.amount, t.balance_after, t.created_at
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  left join public.profiles pa on pa.id = t.admin_id
  where t.casino_id = p_casino_id
    and t.admin_id is not null
    and t.created_at >= p_from
    and t.created_at <= p_to
    and (
      v_is_owner_or_admin
      or t.user_id = auth.uid()
      or (v_is_agent and exists (
        select 1 from public.casino_members cm
        where cm.casino_id = p_casino_id and cm.user_id = t.user_id and cm.agent_id = auth.uid()
      ))
    )
  order by t.created_at desc;
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Use `mcp__claude_ai_Supabase__apply_migration` with `name: "agent_role"` and the SQL above (project id `tvivhadsgtvfvxwpahef`).
Expected: applies with no errors.

- [ ] **Step 3: Check for advisor warnings**

Call `mcp__claude_ai_Supabase__get_advisors` with `type: "security"` and again with `type: "performance"`.
Expected: no new warnings referencing `casino_members`, `get_casino_members`, `assign_member_agent`, `is_casino_owner_or_admin`, or `is_casino_agent` (pre-existing unrelated warnings are fine).

- [ ] **Step 4: Verify the schema change**

Run via `mcp__claude_ai_Supabase__execute_sql`:
```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'casino_members_role_check';
select column_name, data_type, is_nullable from information_schema.columns
where table_name = 'casino_members' and column_name = 'agent_id';
```
Expected: constraint def contains `'agent'::text`; `agent_id` column exists, type `uuid`, nullable.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/043_agent_role.sql
git commit -m "Add agent role with server-scoped downline access"
```

---

## Task 2: SQL-level authorization verification

**Files:** none (verification only, via `execute_sql`)

This exercises the new/updated RPCs directly with `auth.uid()` impersonation (`set_config('request.jwt.claims', ...)`), so it catches authorization bugs before any UI exists. Uses the pre-seeded test account (`claudetest.cassie@gmail.com`, admin in all casinos — see CLAUDE.md) as the owner/admin identity, and creates disposable rows for an "agent" and a "downline member" that are cleaned up at the end.

- [ ] **Step 1: Look up the test account's user id and one of their casinos**

```sql
select id from auth.users where email = 'claudetest.cassie@gmail.com';
```
Note the returned uuid as `<claudetest_id>`.

```sql
select id, owner_id from public.casinos where owner_id = '<claudetest_id>' limit 1;
```
Note the returned casino id as `<casino_id>`. If none exists, create one:
```sql
insert into public.casinos (name, slug, join_code, owner_id, settings, theme)
values ('Agent QA Casino', 'agent-qa-casino', 'AGENTQA', '<claudetest_id>',
        '{"startingBalance": 10000, "allowPublicJoin": true, "maxMembers": 500}'::jsonb,
        '{"primaryColor": "#7c3aed", "backgroundUrl": null}'::jsonb)
returning id;
```

- [ ] **Step 2: Create two disposable member rows to act as agent + downline**

Reuse any two other existing `auth.users` ids that are not already members of `<casino_id>` — or, since this is a scratch verification pass only (not real user data), insert two throwaway member rows referencing the test account's own id is not possible (unique per user per casino), so instead pick two arbitrary distinct existing profile ids:
```sql
select id from public.profiles where id != '<claudetest_id>' limit 2;
```
Note these as `<agent_id>` and `<downline_id>`. If fewer than 2 other profiles exist, skip Steps 2-6 of this task (rely on Task 9/10's real Playwright accounts instead) and proceed to Task 3.

```sql
insert into public.casino_members (casino_id, user_id, balance, role)
values ('<casino_id>', '<agent_id>', 0, 'agent')
on conflict (casino_id, user_id) do update set role = 'agent';

insert into public.casino_members (casino_id, user_id, balance, role, agent_id)
values ('<casino_id>', '<downline_id>', 0, 'member', '<agent_id>')
on conflict (casino_id, user_id) do update set role = 'member', agent_id = '<agent_id>';
```

- [ ] **Step 3: Verify `get_casino_members` scoping as the agent**

```sql
select set_config('request.jwt.claims', json_build_object('sub', '<agent_id>', 'role', 'authenticated')::text, true);
select user_id, role from public.get_casino_members('<casino_id>');
```
Expected: returns exactly one row, `user_id = <downline_id>` — not the agent's own row, not the owner's.

- [ ] **Step 4: Verify `get_casino_members` still returns everyone for the owner**

```sql
select set_config('request.jwt.claims', json_build_object('sub', '<claudetest_id>', 'role', 'authenticated')::text, true);
select user_id, role from public.get_casino_members('<casino_id>');
```
Expected: returns all members of the casino, including the agent and downline rows just inserted.

- [ ] **Step 5: Verify `assign_member_agent` rejects assigning an agent as downline**

```sql
select public.assign_member_agent('<casino_id>', '<agent_id>', '<agent_id>');
```
Expected: raises `An agent cannot be assigned to another agent's downline` (still impersonating the owner from Step 4).

- [ ] **Step 6: Clean up the disposable rows**

```sql
delete from public.casino_members where casino_id = '<casino_id>' and user_id in ('<agent_id>', '<downline_id>');
select set_config('request.jwt.claims', '', true);
```

---

## Task 3: Frontend types

**Files:**
- Modify: `src/types/index.ts:26-51`

- [ ] **Step 1: Widen the role union and add `agent_id` on both member types**

Replace:
```ts
export interface CasinoMemberWithProfile {
  id: string;
  casino_id: string;
  user_id: string;
  balance: number;
  role: "member" | "admin";
  joined_at: string;
  last_played_at: string | null;
  profile: { username: string | null; avatar_url: string | null } | null;
}

export interface Profile {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

export interface CasinoMember {
  id: string;
  casino_id: string;
  user_id: string;
  balance: number;
  role: "member" | "admin";
  joined_at: string;
  last_played_at: string | null;
}
```

With:
```ts
export interface CasinoMemberWithProfile {
  id: string;
  casino_id: string;
  user_id: string;
  balance: number;
  role: "member" | "admin" | "agent";
  agent_id: string | null;
  joined_at: string;
  last_played_at: string | null;
  profile: { username: string | null; avatar_url: string | null } | null;
}

export interface Profile {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

export interface CasinoMember {
  id: string;
  casino_id: string;
  user_id: string;
  balance: number;
  role: "member" | "admin" | "agent";
  agent_id: string | null;
  joined_at: string;
  last_played_at: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "Widen casino member role type to include agent"
```

---

## Task 4: `useCasino` hook — scoped members RPC + assign-agent wrapper

**Files:**
- Modify: `src/hooks/useCasino.ts:130-140,160-167,223-238`

- [ ] **Step 1: Switch `getCasinoMembers` to the new RPC and widen `setMemberRole`**

Replace:
```ts
  async function getCasinoMembers(
    casinoId: string
  ): Promise<CasinoMemberWithProfile[]> {
    const { data, error } = await supabase
      .from("casino_members")
      .select("*, profile:profiles(username, avatar_url)")
      .eq("casino_id", casinoId)
      .order("joined_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as CasinoMemberWithProfile[];
  }
```

With:
```ts
  async function getCasinoMembers(
    casinoId: string
  ): Promise<CasinoMemberWithProfile[]> {
    const { data, error } = await supabase.rpc("get_casino_members", {
      p_casino_id: casinoId,
    });
    if (error) throw error;
    return (data ?? []) as CasinoMemberWithProfile[];
  }
```

Replace:
```ts
  async function setMemberRole(casinoId: string, targetUserId: string, newRole: "member" | "admin") {
```

With:
```ts
  async function setMemberRole(casinoId: string, targetUserId: string, newRole: "member" | "admin" | "agent") {
```

- [ ] **Step 2: Add the `assignMemberAgent` wrapper**

Insert immediately after `setMemberRole`'s closing brace (after line 167, before `transferOwnership`):
```ts
  async function assignMemberAgent(casinoId: string, targetUserId: string, agentUserId: string | null) {
    const { error } = await supabase.rpc("assign_member_agent", {
      p_casino_id: casinoId,
      p_target_user_id: targetUserId,
      p_agent_user_id: agentUserId,
    });
    if (error) throw error;
  }
```

- [ ] **Step 3: Export it from the hook**

Replace:
```ts
  return {
    createCasino,
    joinCasino,
    listCasinos,
    listJoinableCasinos,
    listMyCasinos,
    getCasinoBySlug,
    getCasinoMembers,
    giveChips,
    removeChips,
    setMemberRole,
    transferOwnership,
    getMemberProfitLoss,
    listChipTransactions,
    getPlatformStats,
  };
```

With:
```ts
  return {
    createCasino,
    joinCasino,
    listCasinos,
    listJoinableCasinos,
    listMyCasinos,
    getCasinoBySlug,
    getCasinoMembers,
    giveChips,
    removeChips,
    setMemberRole,
    assignMemberAgent,
    transferOwnership,
    getMemberProfitLoss,
    listChipTransactions,
    getPlatformStats,
  };
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: fails at this point (CasinoDashboard.tsx not yet updated to match) — that's expected here; just confirm the error is scoped to `CasinoDashboard.tsx`, not `useCasino.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCasino.ts
git commit -m "Scope member list to server-side RPC; add assignMemberAgent"
```

---

## Task 5: `CasinoDashboard.tsx` — role display, `isAgent`, tab access

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx:44-54,59,89-99,283-296,323-328,417-432,437-461`

- [ ] **Step 1: Add the agent branch to role display helpers**

Replace (lines 44-54):
```ts
function displayRole(member: CasinoMemberWithProfile, casinoOwnerId: string): "creator" | "admin" | "member" {
  if (member.user_id === casinoOwnerId) return "creator";
  if (member.role === "admin") return "admin";
  return "member";
}

function roleBadgeClass(role: "creator" | "admin" | "member"): string {
  if (role === "creator") return "bg-primary/20 text-primary";
  if (role === "admin") return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}
```

With:
```ts
function displayRole(member: CasinoMemberWithProfile, casinoOwnerId: string): "creator" | "admin" | "agent" | "member" {
  if (member.user_id === casinoOwnerId) return "creator";
  if (member.role === "admin") return "admin";
  if (member.role === "agent") return "agent";
  return "member";
}

function roleBadgeClass(role: "creator" | "admin" | "agent" | "member"): string {
  if (role === "creator") return "bg-primary/20 text-primary";
  if (role === "admin") return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
  if (role === "agent") return "bg-sky-500/20 text-sky-600 dark:text-sky-400";
  return "bg-muted text-muted-foreground";
}
```

- [ ] **Step 2: Pull in `assignMemberAgent` from the hook**

Replace (line 59):
```ts
  const { getCasinoBySlug, joinCasino, getCasinoMembers, giveChips, removeChips, setMemberRole, transferOwnership, getMemberProfitLoss } = useCasino();
```

With:
```ts
  const { getCasinoBySlug, joinCasino, getCasinoMembers, giveChips, removeChips, setMemberRole, assignMemberAgent, transferOwnership, getMemberProfitLoss } = useCasino();
```

- [ ] **Step 3: Add `isAgent`/`canViewMembers` and widen the fetch effect**

Replace (lines 89-99):
```ts
  const isOwner = user?.id === currentCasino?.owner_id;
  const isAdmin = membership?.role === "admin";
  const canManageMembers = isOwner || isAdmin;

  useEffect(() => {
    if (!canManageMembers || !currentCasino || activeTab !== "members") return;
    setMembersLoading(true);
    getCasinoMembers(currentCasino.id)
      .then(setMembers)
      .finally(() => setMembersLoading(false));
  }, [isOwner, isAdmin, currentCasino?.id, activeTab, membership?.id]);
```

With:
```ts
  const isOwner = user?.id === currentCasino?.owner_id;
  const isAdmin = membership?.role === "admin";
  const isAgent = membership?.role === "agent";
  const canManageMembers = isOwner || isAdmin;
  const canViewMembers = canManageMembers || isAgent;

  useEffect(() => {
    if (!canViewMembers || !currentCasino || activeTab !== "members") return;
    setMembersLoading(true);
    getCasinoMembers(currentCasino.id)
      .then(setMembers)
      .finally(() => setMembersLoading(false));
  }, [isOwner, isAdmin, isAgent, currentCasino?.id, activeTab, membership?.id]);
```

- [ ] **Step 4: Widen `handleRoleChange`'s role param and add `handleAssignAgent`**

Replace (lines 150-160, the existing `handleRoleChange`):
```ts
  async function handleRoleChange(userId: string, newRole: "member" | "admin") {
    if (!currentCasino) return;
    await setMemberRole(currentCasino.id, userId, newRole);
    getCasinoMembers(currentCasino.id).then((updated) => {
      setMembers(updated);
      if (selectedMember?.user_id === userId) {
        const refreshed = updated.find((m) => m.user_id === userId);
        if (refreshed) setSelectedMember(refreshed);
      }
    });
  }
```

With:
```ts
  async function handleRoleChange(userId: string, newRole: "member" | "admin" | "agent") {
    if (!currentCasino) return;
    await setMemberRole(currentCasino.id, userId, newRole);
    getCasinoMembers(currentCasino.id).then((updated) => {
      setMembers(updated);
      if (selectedMember?.user_id === userId) {
        const refreshed = updated.find((m) => m.user_id === userId);
        if (refreshed) setSelectedMember(refreshed);
      }
    });
  }

  async function handleAssignAgent(userId: string, agentUserId: string | null) {
    if (!currentCasino) return;
    await assignMemberAgent(currentCasino.id, userId, agentUserId);
    getCasinoMembers(currentCasino.id).then((updated) => {
      setMembers(updated);
      if (selectedMember?.user_id === userId) {
        const refreshed = updated.find((m) => m.user_id === userId);
        if (refreshed) setSelectedMember(refreshed);
      }
    });
  }
```

- [ ] **Step 5: Gate the Members/Stats tabs on `canViewMembers`, and Trades' user column**

Replace (lines 283-296):
```tsx
          {canManageMembers && activeTab === "members" && (
            <MembersTab
              members={members}
              loading={membersLoading}
              casinoOwnerId={currentCasino.owner_id}
              onSelectMember={setSelectedMember}
            />
          )}
          {canManageMembers && activeTab === "stats" && (
            <StatsTab casinoId={currentCasino.id} casinoGames={casinoGames} gameTypes={gameTypes} />
          )}
          {activeTab === "trades" && (
            <ChipLedgerPanel casinoId={currentCasino.id} showUserColumn={canManageMembers} />
          )}
```

With:
```tsx
          {canViewMembers && activeTab === "members" && (
            <MembersTab
              members={members}
              loading={membersLoading}
              casinoOwnerId={currentCasino.owner_id}
              onSelectMember={setSelectedMember}
            />
          )}
          {canViewMembers && activeTab === "stats" && (
            <StatsTab casinoId={currentCasino.id} casinoGames={casinoGames} gameTypes={gameTypes} />
          )}
          {activeTab === "trades" && (
            <ChipLedgerPanel casinoId={currentCasino.id} showUserColumn={canViewMembers} />
          )}
```

- [ ] **Step 6: Compute the tab set in the parent and pass it down**

Replace (lines 323-328):
```tsx
      {showTabs && (
        <CasinoBottomNav
          activeTab={activeTab}
          onChange={setActiveTab}
          canManageMembers={canManageMembers}
        />
      )}
```

With:
```tsx
      {showTabs && (
        <CasinoBottomNav
          activeTab={activeTab}
          onChange={setActiveTab}
          tabs={canManageMembers ? ADMIN_TABS : isAgent ? AGENT_TABS : MEMBER_TABS}
        />
      )}
```

- [ ] **Step 7: Pass the new props into `MemberPopup`**

Replace (lines 417-432):
```tsx
      {selectedMember && currentCasino && (
        <Modal onClose={() => setSelectedMember(null)} size="md">
          <MemberPopup
            member={selectedMember}
            casinoId={currentCasino.id}
            casinoOwnerId={currentCasino.owner_id}
            isCreator={isOwner}
            onClose={() => setSelectedMember(null)}
            onGiveChips={handleGiveChips}
            onRemoveChips={handleRemoveChips}
            onRoleChange={handleRoleChange}
            onTransferOwnership={handleTransferOwnership}
            getMemberProfitLoss={getMemberProfitLoss}
          />
        </Modal>
      )}
```

With:
```tsx
      {selectedMember && currentCasino && (
        <Modal onClose={() => setSelectedMember(null)} size="md">
          <MemberPopup
            member={selectedMember}
            casinoId={currentCasino.id}
            casinoOwnerId={currentCasino.owner_id}
            isCreator={isOwner}
            canManage={canManageMembers}
            agents={members.filter((m) => m.role === "agent")}
            onClose={() => setSelectedMember(null)}
            onGiveChips={handleGiveChips}
            onRemoveChips={handleRemoveChips}
            onRoleChange={handleRoleChange}
            onTransferOwnership={handleTransferOwnership}
            onAssignAgent={handleAssignAgent}
            getMemberProfitLoss={getMemberProfitLoss}
          />
        </Modal>
      )}
```

- [ ] **Step 8: Add `AGENT_TABS` and switch `CasinoBottomNav` to accept a tab list directly**

Replace (lines 437-461):
```tsx
const ADMIN_TABS: { id: OwnerTab; label: string; icon: React.ElementType }[] = [
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "members", label: "Members", icon: Users },
  { id: "stats", label: "Stats", icon: BarChart2 },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
  { id: "settings", label: "Settings", icon: Settings },
];

const MEMBER_TABS: { id: OwnerTab; label: string; icon: React.ElementType }[] = [
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
];

// Casino-scoped tab bar, styled to match the homepage's persistent BottomNav
// (see components/BottomNav.tsx) but driving in-page tab state instead of routes.
function CasinoBottomNav({
  activeTab,
  onChange,
  canManageMembers,
}: {
  activeTab: OwnerTab;
  onChange: (tab: OwnerTab) => void;
  canManageMembers: boolean;
}) {
  const items = canManageMembers ? ADMIN_TABS : MEMBER_TABS;
```

With:
```tsx
const ADMIN_TABS: { id: OwnerTab; label: string; icon: React.ElementType }[] = [
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "members", label: "Members", icon: Users },
  { id: "stats", label: "Stats", icon: BarChart2 },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
  { id: "settings", label: "Settings", icon: Settings },
];

const MEMBER_TABS: { id: OwnerTab; label: string; icon: React.ElementType }[] = [
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
];

// Agents get read-only Members/Stats/Trades, scoped server-side to their
// downline — no Games (they don't play through this role) and no Settings.
const AGENT_TABS: { id: OwnerTab; label: string; icon: React.ElementType }[] = [
  { id: "members", label: "Members", icon: Users },
  { id: "stats", label: "Stats", icon: BarChart2 },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
];

// Casino-scoped tab bar, styled to match the homepage's persistent BottomNav
// (see components/BottomNav.tsx) but driving in-page tab state instead of routes.
function CasinoBottomNav({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: OwnerTab;
  onChange: (tab: OwnerTab) => void;
  tabs: { id: OwnerTab; label: string; icon: React.ElementType }[];
}) {
  const items = tabs;
```

- [ ] **Step 9: Type-check**

Run: `npm run build`
Expected: fails only inside `MemberPopup`'s definition (new props not yet declared there) — confirms everything else above is wired correctly. Proceed to Task 6.

- [ ] **Step 10: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "Add agent role to dashboard: tab access, role display, assign-agent wiring"
```

---

## Task 6: `MemberPopup` — agent role button, canManage gating, Assign Agent flow

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx:1107-1428`

- [ ] **Step 1: Widen the props and add assign-agent state**

Replace (lines 1107-1145):
```tsx
function MemberPopup({
  member,
  casinoId,
  casinoOwnerId,
  isCreator,
  onClose,
  onGiveChips,
  onRemoveChips,
  onRoleChange,
  onTransferOwnership,
  getMemberProfitLoss,
}: {
  member: CasinoMemberWithProfile;
  casinoId: string;
  casinoOwnerId: string;
  isCreator: boolean;
  onClose: () => void;
  onGiveChips: (userId: string, amount: number) => Promise<void>;
  onRemoveChips: (userId: string, amount: number) => Promise<void>;
  onRoleChange: (userId: string, newRole: "member" | "admin") => Promise<void>;
  onTransferOwnership: (userId: string) => Promise<void>;
  getMemberProfitLoss: (casinoId: string, userId: string, from?: Date, to?: Date) => Promise<number>;
}) {
  const [profitLoss, setProfitLoss] = useState<number | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [period, setPeriod] = useState<StatPeriod>("all");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());

  const [chipAmount, setChipAmount] = useState("");
  const [giving, setGiving] = useState(false);
  const [giveError, setGiveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const role = displayRole(member, casinoOwnerId);
  const isCreatorMember = member.user_id === casinoOwnerId;
```

With:
```tsx
function MemberPopup({
  member,
  casinoId,
  casinoOwnerId,
  isCreator,
  canManage,
  agents,
  onClose,
  onGiveChips,
  onRemoveChips,
  onRoleChange,
  onTransferOwnership,
  onAssignAgent,
  getMemberProfitLoss,
}: {
  member: CasinoMemberWithProfile;
  casinoId: string;
  casinoOwnerId: string;
  isCreator: boolean;
  canManage: boolean;
  agents: CasinoMemberWithProfile[];
  onClose: () => void;
  onGiveChips: (userId: string, amount: number) => Promise<void>;
  onRemoveChips: (userId: string, amount: number) => Promise<void>;
  onRoleChange: (userId: string, newRole: "member" | "admin" | "agent") => Promise<void>;
  onTransferOwnership: (userId: string) => Promise<void>;
  onAssignAgent: (userId: string, agentUserId: string | null) => Promise<void>;
  getMemberProfitLoss: (casinoId: string, userId: string, from?: Date, to?: Date) => Promise<number>;
}) {
  const [profitLoss, setProfitLoss] = useState<number | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [period, setPeriod] = useState<StatPeriod>("all");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());

  const [chipAmount, setChipAmount] = useState("");
  const [giving, setGiving] = useState(false);
  const [giveError, setGiveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [assigningAgent, setAssigningAgent] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const role = displayRole(member, casinoOwnerId);
  const isCreatorMember = member.user_id === casinoOwnerId;
  const currentAgent = agents.find((a) => a.user_id === member.agent_id);

  async function handleAssignAgent(agentUserId: string | null) {
    setAssigning(true);
    setAssignError(null);
    try {
      await onAssignAgent(member.user_id, agentUserId);
      setAssigningAgent(false);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign agent");
    } finally {
      setAssigning(false);
    }
  }
```

- [ ] **Step 2: Extend the role toggle to include "agent", and gate the chips section on `canManage`**

Replace (lines 1335-1366, the Role section through the closing of the chips-section-opening `<div>`):
```tsx
        {isCreator && !isCreatorMember && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Role</p>
            <div className="flex gap-2">
              {(["member", "admin"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={member.role === r || changingRole}
                  onClick={() => handleRoleChange(r)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    member.role === r
                      ? r === "admin"
                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 cursor-default"
                        : "bg-white/10 text-foreground cursor-default"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50"
                  }`}
                >
                  {r}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setConfirmingTransfer(true)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                Make owner
              </button>
            </div>
            {roleError && <p className="text-xs text-destructive mt-1">{roleError}</p>}
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground mb-2">Give or remove chips</p>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              placeholder="Amount"
              value={chipAmount}
              onChange={(e) => setChipAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGive()}
              className="w-32 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button size="sm" onClick={handleGive} disabled={giving || removing} className={CTA_GRADIENT}>
              {giving ? "Sending…" : "Give"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRemove}
              disabled={giving || removing}
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          </div>
          {giveError && <p className="text-xs text-destructive mt-1">{giveError}</p>}
          {removeError && <p className="text-xs text-destructive mt-1">{removeError}</p>}
        </div>
      </div>
    </div>
```

With:
```tsx
        {isCreator && !isCreatorMember && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Role</p>
            <div className="flex gap-2">
              {(["member", "admin", "agent"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={member.role === r || changingRole}
                  onClick={() => handleRoleChange(r)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    member.role === r
                      ? r === "admin"
                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 cursor-default"
                        : r === "agent"
                        ? "bg-sky-500/20 text-sky-600 dark:text-sky-400 cursor-default"
                        : "bg-white/10 text-foreground cursor-default"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50"
                  }`}
                >
                  {r}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setConfirmingTransfer(true)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                Make owner
              </button>
            </div>
            {roleError && <p className="text-xs text-destructive mt-1">{roleError}</p>}
          </div>
        )}

        {canManage && !isCreatorMember && member.role !== "agent" && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Agent</p>
            <div className="flex items-center gap-2 flex-wrap">
              {currentAgent ? (
                <>
                  <span className="text-sm font-medium">
                    Reports to {currentAgent.profile?.username ?? "Unknown"}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setAssigningAgent(true)}>
                    Change
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setAssigningAgent(true)}>
                  Assign agent
                </Button>
              )}
            </div>
          </div>
        )}

        {canManage && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Give or remove chips</p>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                placeholder="Amount"
                value={chipAmount}
                onChange={(e) => setChipAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGive()}
                className="w-32 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button size="sm" onClick={handleGive} disabled={giving || removing} className={CTA_GRADIENT}>
                {giving ? "Sending…" : "Give"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRemove}
                disabled={giving || removing}
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
              >
                {removing ? "Removing…" : "Remove"}
              </Button>
            </div>
            {giveError && <p className="text-xs text-destructive mt-1">{giveError}</p>}
            {removeError && <p className="text-xs text-destructive mt-1">{removeError}</p>}
          </div>
        )}
      </div>
    </div>
```

- [ ] **Step 3: Add the Assign Agent picker modal**

Insert immediately after the closing `)}` of the transfer-ownership confirmation modal, before the closing `</>` (i.e. right after line 1425's `)}` in the original file):
```tsx
    {assigningAgent && (
      <Modal onClose={() => (assigning ? undefined : setAssigningAgent(false))} size="md">
        <div className={`rounded-2xl ${GLASS} ${CARD_GLOW} p-5 space-y-4`}>
          <div>
            <p className="font-semibold text-base">Assign agent</p>
            <p className="text-sm text-muted-foreground mt-1">
              Choose which agent {username} reports to.
            </p>
          </div>
          {assignError && <p className="text-xs text-destructive">{assignError}</p>}
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {agents.length === 0 && (
              <p className="text-sm text-muted-foreground">No agents in this casino yet.</p>
            )}
            {agents.map((a) => (
              <button
                key={a.user_id}
                type="button"
                disabled={assigning}
                onClick={() => handleAssignAgent(a.user_id)}
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  member.agent_id === a.user_id
                    ? "bg-primary/15 text-primary"
                    : "bg-white/5 hover:bg-white/10"
                }`}
              >
                {a.profile?.username ?? "Unknown"}
              </button>
            ))}
            {member.agent_id && (
              <button
                type="button"
                disabled={assigning}
                onClick={() => handleAssignAgent(null)}
                className="w-full rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                Unassign
              </button>
            )}
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setAssigningAgent(false)} disabled={assigning}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    )}
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "Add agent role button and Assign Agent picker to member popup"
```

---

## Task 7: Start the dev server for UI verification

**Files:** none

- [ ] **Step 1: Start the dev server**

Run in background: `npm run dev`
Expected: prints `Local: http://localhost:5173/`

- [ ] **Step 2: Sign in as the test account**

Using Playwright MCP tools (`mcp__plugin_playwright_playwright__browser_navigate`, `browser_fill_form`, `browser_click`), navigate to `http://localhost:5173/auth` and sign in with `claudetest.cassie@gmail.com` / `ClaudeTest123!` (per CLAUDE.md's Test Account section — re-create it per those instructions first if sign-in fails).
Expected: lands on the homepage, signed in.

---

## Task 8: QA fixtures — create two disposable test accounts (agent + downline)

Only needed if Task 2's SQL-level verification was skipped for lack of spare profile rows, or to get real Playwright coverage of the agent's own view (recommended either way — this is the only way to see the agent's UI rendered for real, not just inferred from the code).

**Files:** none (Supabase Auth + `execute_sql` only)

- [ ] **Step 1: Sign up the "agent" test account**

Using Playwright, navigate to `http://localhost:5173/auth`, switch to sign-up, and register:
- Email: `claudetest.agent@gmail.com`
- Password: `ClaudeTest123!`
- Nickname: `ClaudeTestAgent`

- [ ] **Step 2: Sign up the "downline" test account**

Same flow:
- Email: `claudetest.downline@gmail.com`
- Password: `ClaudeTest123!`
- Nickname: `ClaudeTestDownline`

- [ ] **Step 3: Confirm both emails via SQL**

```sql
update auth.users set email_confirmed_at = now()
where email in ('claudetest.agent@gmail.com', 'claudetest.downline@gmail.com')
  and email_confirmed_at is null;
```

- [ ] **Step 4: Join both into a test casino owned by ClaudeTest**

Sign in as each new account via Playwright and join a casino owned by `claudetest.cassie@gmail.com` (create one first, e.g. "Agent QA Casino", if none exists — use the "Create Casino" flow in the UI while signed in as ClaudeTest).

---

## Task 9: End-to-end verification — admin side

**Files:** none (manual/Playwright verification against the running dev server)

- [ ] **Step 1: Promote the agent test account to `agent`**

Signed in as `claudetest.cassie@gmail.com`, open the test casino → Members tab → click `ClaudeTestAgent`'s row → click the "Agent" role button.
Expected: role badge updates to "Agent" (sky-colored badge); no console errors.

- [ ] **Step 2: Assign the downline account under the new agent**

Click `ClaudeTestDownline`'s row → click "Assign agent" → select `ClaudeTestAgent` from the picker.
Expected: picker closes, popup now shows "Reports to ClaudeTestAgent".

- [ ] **Step 3: Verify the agent row itself has no "Assign agent" button**

Click `ClaudeTestAgent`'s row.
Expected: no "Assign agent" section is shown (role is `agent`, so the section is hidden per the `member.role !== "agent"` guard).

- [ ] **Step 4: Verify unassign works**

Reopen `ClaudeTestDownline`'s popup → "Change" → "Unassign".
Expected: popup returns to showing the plain "Assign agent" button (no "Reports to" line).

Re-assign them to the agent again before continuing to Task 10 (so there's a downline member to view).

---

## Task 10: End-to-end verification — agent's own scoped view

**Files:** none (manual/Playwright verification against the running dev server)

- [ ] **Step 1: Sign in as the agent test account**

Sign out, sign in as `claudetest.agent@gmail.com` / `ClaudeTest123!`, open the test casino.
Expected: bottom nav shows exactly Members, Stats, Trades (no Games, no Settings).

- [ ] **Step 2: Verify Members tab is downline-scoped and read-only**

Open the Members tab.
Expected: only `ClaudeTestDownline` is listed (not `ClaudeTestAgent` themselves, not the owner, not any other member). Click into the row.
Expected: popup shows profile/balance/profit-loss only — no Role section, no "Agent" section, no "Give or remove chips" section.

- [ ] **Step 3: Verify Stats tab is scoped**

Open the Stats tab.
Expected: loads without an "authorized" error (confirms `get_casino_stats` accepted the agent role) and reflects only the downline member's activity.

- [ ] **Step 4: Verify Trades tab is scoped**

Open the Trades tab.
Expected: Player column is visible (agent sees others, not just their own rows) and only shows rows for `ClaudeTestDownline`, not other casino members.

---

## Self-Review Notes

- **Spec coverage:** role widened + downline column (Task 1); assign-agent RPC + UI (Tasks 1, 6, 9); scoped members/stats/trades RPCs (Task 1) and their frontend gating (Tasks 5, 6, 10); agent exemption from being downline (Task 1 `assign_member_agent` + Task 9 Step 3); demotion clears downline (Task 1 `set_member_role`) — not covered by an explicit UI verification step since it's exercised at the SQL layer in Task 1 itself; acceptable since it's a straightforward `UPDATE` with no new UI surface.
- **Type consistency:** `CasinoMemberWithProfile.role`/`CasinoMember.role` (Task 3), `setMemberRole`/`handleRoleChange`/`MemberPopup.onRoleChange` role param (Tasks 4, 5, 6), and the RPC's `p_new_role` check (Task 1) all agree on `"member" | "admin" | "agent"`.
- **No placeholders:** every step above has literal code or literal SQL — none deferred.
