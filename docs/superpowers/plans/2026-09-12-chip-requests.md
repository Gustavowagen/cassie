# Chip Requests + Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lobby's "Get chips" button open a popup where a member can request a chip amount; the request shows up on the casino's Trades page for an admin/owner to Accept or Deny, and a new notification bell tells both sides what happened.

**Architecture:** Two new Postgres tables (`chip_requests`, `notifications`) accessed exclusively through `security definer` RPCs, following the exact pattern `give_chips`/`remove_chips`/`list_chip_transactions` already use. Accepting a request reuses `give_chips`'s balance-update + `transactions`-insert shape so accepted requests show up in the existing ledger for free. Two new React hooks (`useChipRequests`, `useNotifications`) wrap the RPCs; three new small components (`GetChipsModal`, `NotificationsModal`, and a pure `notificationMessage` formatter) plug into the existing lobby top bar and Trades tab.

**Tech Stack:** Supabase (Postgres + RPC), React + TypeScript, Vitest, Playwright (manual verification against the live dev project).

**Spec:** `docs/superpowers/specs/2026-09-12-chip-requests-design.md`

## Global Constraints

- One pending request per `(casino_id, user_id)`, enforced by a partial unique index — not just client-side state.
- Accept grants the *exact* requested amount; there is no amount-editing step.
- `chip_requests` and `notifications` both have RLS enabled with **zero** policies — every access path is a `security definer` RPC (no direct `.from()` reads/writes on these two tables anywhere in the frontend).
- No realtime subscriptions for notifications — fetched once when the lobby (`GamesLobby`) mounts/casino changes, consistent with the spec's explicit scope decision.
- Amounts are `numeric(14,2)`, matching `give_chips`/`remove_chips`/`transactions.amount`.
- Authorization for accept/deny/list is re-checked server-side via the existing `public.is_casino_owner_or_admin(casino_id)` helper (from `043_agent_role.sql`) — never inferred from what the client sends.
- Money/format display always goes through `formatChips()` from `src/lib/utils.ts`.

---

### Task 1: Database — `chip_requests` + `notifications` tables and RPCs

**Files:**
- Create: `supabase/migrations/051_chip_requests.sql`

**Interfaces:**
- Produces (consumed by every later task via `supabase.rpc(...)`):
  - `request_chips(p_casino_id uuid, p_amount numeric) returns public.chip_requests` — raises a `unique_violation` (Postgres code `23505`) if the caller already has a pending request in that casino.
  - `cancel_chip_request(p_request_id uuid) returns void`
  - `accept_chip_request(p_request_id uuid) returns void`
  - `deny_chip_request(p_request_id uuid) returns void`
  - `list_chip_requests(p_casino_id uuid) returns table(id uuid, user_id uuid, username text, amount numeric, created_at timestamptz)` — pending only.
  - `list_notifications(p_casino_id uuid) returns table(id uuid, type text, payload jsonb, read_at timestamptz, created_at timestamptz)` — caller's own, newest first, capped at 50.
  - `mark_notifications_read(p_casino_id uuid) returns void`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/051_chip_requests.sql` with this exact content:

```sql
-- Member-initiated chip requests, resolved by an admin/owner, plus a small
-- generic notifications table that today only the request lifecycle feeds.
create table public.chip_requests (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','accepted','denied')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index chip_requests_one_pending_per_member
  on public.chip_requests (casino_id, user_id)
  where status = 'pending';

alter table public.chip_requests enable row level security;
-- No policies: every read/write goes through the security definer RPCs
-- below, which (like give_chips/remove_chips) run as the function owner
-- and so bypass RLS.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('chip_request_created', 'chip_request_accepted', 'chip_request_denied')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, casino_id) where read_at is null;

alter table public.notifications enable row level security;
-- No direct policies either; RPC-only.

create or replace function public.request_chips(p_casino_id uuid, p_amount numeric(14,2))
returns public.chip_requests
language plpgsql security definer as $$
declare
  v_request public.chip_requests;
  v_username text;
begin
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  if not exists (
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this casino';
  end if;

  insert into public.chip_requests (casino_id, user_id, amount)
  values (p_casino_id, auth.uid(), p_amount)
  returning * into v_request;

  select username into v_username from public.profiles where id = auth.uid();

  insert into public.notifications (casino_id, user_id, type, payload)
  select p_casino_id, recipient, 'chip_request_created',
         jsonb_build_object('request_id', v_request.id, 'amount', p_amount, 'requester_username', v_username)
  from (
    select user_id as recipient from public.casino_members
    where casino_id = p_casino_id and role = 'admin' and user_id <> auth.uid()
    union
    select owner_id from public.casinos
    where id = p_casino_id and owner_id <> auth.uid()
  ) recipients;

  return v_request;
end;
$$;

create or replace function public.cancel_chip_request(p_request_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.chip_requests
  set status = 'denied', resolved_by = auth.uid(), resolved_at = now()
  where id = p_request_id and user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'No pending request to cancel';
  end if;
end;
$$;

create or replace function public.accept_chip_request(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_req public.chip_requests;
  v_new_balance numeric(14,2);
begin
  select * into v_req from public.chip_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request already resolved'; end if;

  if not public.is_casino_owner_or_admin(v_req.casino_id) then
    raise exception 'Only the casino creator or an admin can resolve chip requests';
  end if;

  update public.casino_members
  set balance = balance + v_req.amount
  where casino_id = v_req.casino_id and user_id = v_req.user_id
  returning balance into v_new_balance;
  if not found then raise exception 'Member not found'; end if;

  insert into public.transactions (casino_id, user_id, admin_id, amount, balance_after, description)
  values (v_req.casino_id, v_req.user_id, auth.uid(), v_req.amount, v_new_balance, 'Chip request');

  update public.chip_requests
  set status = 'accepted', resolved_by = auth.uid(), resolved_at = now()
  where id = p_request_id;

  insert into public.notifications (casino_id, user_id, type, payload)
  values (v_req.casino_id, v_req.user_id, 'chip_request_accepted',
          jsonb_build_object('request_id', p_request_id, 'amount', v_req.amount));
end;
$$;

create or replace function public.deny_chip_request(p_request_id uuid)
returns void language plpgsql security definer as $$
declare
  v_req public.chip_requests;
begin
  select * into v_req from public.chip_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request already resolved'; end if;

  if not public.is_casino_owner_or_admin(v_req.casino_id) then
    raise exception 'Only the casino creator or an admin can resolve chip requests';
  end if;

  update public.chip_requests
  set status = 'denied', resolved_by = auth.uid(), resolved_at = now()
  where id = p_request_id;

  insert into public.notifications (casino_id, user_id, type, payload)
  values (v_req.casino_id, v_req.user_id, 'chip_request_denied',
          jsonb_build_object('request_id', p_request_id, 'amount', v_req.amount));
end;
$$;

create or replace function public.list_chip_requests(p_casino_id uuid)
returns table (
  id uuid,
  user_id uuid,
  username text,
  amount numeric(14,2),
  created_at timestamptz
) language plpgsql security definer as $$
begin
  return query
  select r.id, r.user_id, p.username, r.amount, r.created_at
  from public.chip_requests r
  join public.profiles p on p.id = r.user_id
  where r.casino_id = p_casino_id
    and r.status = 'pending'
    and (public.is_casino_owner_or_admin(p_casino_id) or r.user_id = auth.uid())
  order by r.created_at asc;
end;
$$;

create or replace function public.list_notifications(p_casino_id uuid)
returns table (
  id uuid,
  type text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz
) language plpgsql security definer as $$
begin
  return query
  select n.id, n.type, n.payload, n.read_at, n.created_at
  from public.notifications n
  where n.casino_id = p_casino_id and n.user_id = auth.uid()
  order by n.created_at desc
  limit 50;
end;
$$;

create or replace function public.mark_notifications_read(p_casino_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.notifications
  set read_at = now()
  where casino_id = p_casino_id and user_id = auth.uid() and read_at is null;
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool: `mcp__claude_ai_Supabase__apply_migration` with `project_id: "tvivhadsgtvfvxwpahef"`, `name: "chip_requests"`, and `query` set to the exact SQL from Step 1.

Expected: `{"success":true}`.

- [ ] **Step 3: Verify the schema landed correctly**

Use `mcp__claude_ai_Supabase__execute_sql` with `project_id: "tvivhadsgtvfvxwpahef"` and this query:

```sql
select
  (select count(*) from information_schema.columns where table_name = 'chip_requests') as chip_requests_cols,
  (select count(*) from information_schema.columns where table_name = 'notifications') as notifications_cols,
  (select relrowsecurity from pg_class where relname = 'chip_requests') as chip_requests_rls,
  (select relrowsecurity from pg_class where relname = 'notifications') as notifications_rls,
  (select count(*) from pg_policies where tablename = 'chip_requests') as chip_requests_policies,
  (select count(*) from pg_policies where tablename = 'notifications') as notifications_policies,
  (select count(*) from pg_proc where proname in
    ('request_chips','cancel_chip_request','accept_chip_request','deny_chip_request',
     'list_chip_requests','list_notifications','mark_notifications_read')) as rpc_count;
```

Expected: `chip_requests_cols = 8`, `notifications_cols = 6`, both `*_rls = true`, both `*_policies = 0`, `rpc_count = 7`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/051_chip_requests.sql
git commit -m "feat(chip-requests): add chip_requests/notifications tables and RPCs"
```

---

### Task 2: `ChipRequest` type + `useChipRequests` hook

**Files:**
- Modify: `src/types/index.ts` (add after the `ChipTransaction` interface)
- Create: `src/hooks/useChipRequests.ts`

**Interfaces:**
- Consumes: `request_chips`/`cancel_chip_request`/`accept_chip_request`/`deny_chip_request`/`list_chip_requests` RPCs from Task 1.
- Produces:
  - `interface ChipRequest { id: string; user_id: string; username: string | null; amount: number; created_at: string }`
  - `type ChipRequestStatus = "pending" | "accepted" | "denied"`
  - `useChipRequests(): { requestChips(casinoId: string, amount: number): Promise<ChipRequest>; cancelChipRequest(requestId: string): Promise<void>; acceptChipRequest(requestId: string): Promise<void>; denyChipRequest(requestId: string): Promise<void>; listChipRequests(casinoId: string): Promise<ChipRequest[]> }`

- [ ] **Step 1: Add the types**

In `src/types/index.ts`, find the `ChipTransaction` interface:

```ts
export interface ChipTransaction {
  id: string;
  user_id: string;
  username: string | null;
  admin_id: string | null;
  admin_username: string | null;
  amount: number;
  balance_after: number;
  created_at: string;
}
```

Immediately after it, insert:

```ts

export type ChipRequestStatus = "pending" | "accepted" | "denied";

export interface ChipRequest {
  id: string;
  user_id: string;
  username: string | null;
  amount: number;
  created_at: string;
}
```

- [ ] **Step 2: Write `src/hooks/useChipRequests.ts`**

```ts
import { supabase } from "../lib/supabase";
import type { ChipRequest } from "../types";

export function useChipRequests() {
  async function requestChips(casinoId: string, amount: number): Promise<ChipRequest> {
    const { data, error } = await supabase.rpc("request_chips", {
      p_casino_id: casinoId,
      p_amount: amount,
    });
    if (error) {
      if (error.code === "23505") {
        throw new Error("You already have a pending request");
      }
      throw error;
    }
    return {
      id: data.id,
      user_id: data.user_id,
      username: null,
      amount: data.amount,
      created_at: data.created_at,
    };
  }

  async function cancelChipRequest(requestId: string): Promise<void> {
    const { error } = await supabase.rpc("cancel_chip_request", { p_request_id: requestId });
    if (error) throw error;
  }

  async function acceptChipRequest(requestId: string): Promise<void> {
    const { error } = await supabase.rpc("accept_chip_request", { p_request_id: requestId });
    if (error) throw error;
  }

  async function denyChipRequest(requestId: string): Promise<void> {
    const { error } = await supabase.rpc("deny_chip_request", { p_request_id: requestId });
    if (error) throw error;
  }

  async function listChipRequests(casinoId: string): Promise<ChipRequest[]> {
    const { data, error } = await supabase.rpc("list_chip_requests", { p_casino_id: casinoId });
    if (error) throw error;
    return (data ?? []) as ChipRequest[];
  }

  return { requestChips, cancelChipRequest, acceptChipRequest, denyChipRequest, listChipRequests };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/hooks/useChipRequests.ts
git commit -m "feat(chip-requests): add ChipRequest type and useChipRequests hook"
```

---

### Task 3: `AppNotification` type + `useNotifications` hook

**Files:**
- Modify: `src/types/index.ts` (add after the `ChipRequest` block from Task 2)
- Create: `src/hooks/useNotifications.ts`

**Interfaces:**
- Consumes: `list_notifications`/`mark_notifications_read` RPCs from Task 1.
- Produces:
  - `type NotificationType = "chip_request_created" | "chip_request_accepted" | "chip_request_denied"`
  - `interface AppNotification { id: string; type: NotificationType; payload: { request_id: string; amount: number; requester_username?: string }; read_at: string | null; created_at: string }`
  - `useNotifications(): { listNotifications(casinoId: string): Promise<AppNotification[]>; markNotificationsRead(casinoId: string): Promise<void> }`

- [ ] **Step 1: Add the types**

In `src/types/index.ts`, immediately after the `ChipRequest` interface added in Task 2, insert:

```ts

export type NotificationType = "chip_request_created" | "chip_request_accepted" | "chip_request_denied";

export interface AppNotification {
  id: string;
  type: NotificationType;
  payload: { request_id: string; amount: number; requester_username?: string };
  read_at: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Write `src/hooks/useNotifications.ts`**

```ts
import { supabase } from "../lib/supabase";
import type { AppNotification } from "../types";

export function useNotifications() {
  async function listNotifications(casinoId: string): Promise<AppNotification[]> {
    const { data, error } = await supabase.rpc("list_notifications", { p_casino_id: casinoId });
    if (error) throw error;
    return (data ?? []) as AppNotification[];
  }

  async function markNotificationsRead(casinoId: string): Promise<void> {
    const { error } = await supabase.rpc("mark_notifications_read", { p_casino_id: casinoId });
    if (error) throw error;
  }

  return { listNotifications, markNotificationsRead };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/hooks/useNotifications.ts
git commit -m "feat(chip-requests): add AppNotification type and useNotifications hook"
```

---

### Task 4: `notificationMessage` formatter (TDD)

**Files:**
- Create: `src/lib/notifications.ts`
- Test: `src/lib/notifications.test.ts`

**Interfaces:**
- Consumes: `AppNotification` type from Task 3.
- Produces: `notificationMessage(n: Pick<AppNotification, "type" | "payload">): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/notifications.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { notificationMessage } from "./notifications";

describe("notificationMessage", () => {
  it("formats a request-created notification for an admin", () => {
    expect(
      notificationMessage({
        type: "chip_request_created",
        payload: { request_id: "r1", amount: 500, requester_username: "nora" },
      })
    ).toBe("nora requested 500.0000 chips");
  });

  it("falls back to 'A member' when the requester username is missing", () => {
    expect(
      notificationMessage({ type: "chip_request_created", payload: { request_id: "r1", amount: 500 } })
    ).toBe("A member requested 500.0000 chips");
  });

  it("formats an accepted notification for the requester", () => {
    expect(
      notificationMessage({ type: "chip_request_accepted", payload: { request_id: "r1", amount: 250 } })
    ).toBe("Your request for 250.0000 chips was accepted");
  });

  it("formats a denied notification for the requester", () => {
    expect(
      notificationMessage({ type: "chip_request_denied", payload: { request_id: "r1", amount: 250 } })
    ).toBe("Your request for 250.0000 chips was denied");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/notifications.test.ts`
Expected: FAIL — `Cannot find module './notifications'` (the file doesn't exist yet).

- [ ] **Step 3: Write `src/lib/notifications.ts`**

```ts
import { formatChips } from "./utils";
import type { AppNotification } from "../types";

export function notificationMessage(n: Pick<AppNotification, "type" | "payload">): string {
  const amount = formatChips(n.payload.amount);
  switch (n.type) {
    case "chip_request_created":
      return `${n.payload.requester_username ?? "A member"} requested ${amount} chips`;
    case "chip_request_accepted":
      return `Your request for ${amount} chips was accepted`;
    case "chip_request_denied":
      return `Your request for ${amount} chips was denied`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/notifications.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts
git commit -m "feat(chip-requests): add notificationMessage formatter"
```

---

### Task 5: "Get chips" popup

**Files:**
- Create: `src/components/lobby/GetChipsModal.tsx`
- Modify: `src/components/lobby/LobbyTopBar.tsx`
- Modify: `src/components/lobby/GamesLobby.tsx`

**Interfaces:**
- Consumes: `useChipRequests()` from Task 2, `ChipRequest` type from Task 2, `Modal` from `src/components/ui/modal.tsx`, `useAuthStore()` from `src/stores/authStore.ts`.
- Produces: `GetChipsModal({ casinoId: string; userId: string; onClose: () => void })` — a self-contained modal-content component (header + body + close button, matching `GameSettingsModal`'s shape) meant to be wrapped in `<Modal>` by its caller.

- [ ] **Step 1: Write `src/components/lobby/GetChipsModal.tsx`**

```tsx
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { formatChips } from "../../lib/utils";
import { useChipRequests } from "../../hooks/useChipRequests";
import type { ChipRequest } from "../../types";

const GLASS = "bg-background border border-white/10";

export function GetChipsModal({
  casinoId,
  userId,
  onClose,
}: {
  casinoId: string;
  userId: string;
  onClose: () => void;
}) {
  const { requestChips, cancelChipRequest, listChipRequests } = useChipRequests();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ChipRequest | null>(null);
  const [amountText, setAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listChipRequests(casinoId)
      .then((rows) => {
        if (cancelled) return;
        setPending(rows.find((r) => r.user_id === userId) ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [casinoId, userId]);

  const amount = parseFloat(amountText);
  const amountValid = isFinite(amount) && amount > 0;

  async function handleSubmit() {
    if (!amountValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const request = await requestChips(casinoId, amount);
      setPending(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!pending || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelChipRequest(pending.id);
      setPending(null);
      setAmountText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`rounded-2xl ${GLASS} overflow-hidden flex-1 min-h-0 flex flex-col`}>
      <div className="flex items-start justify-between p-5 border-b border-white/10 shrink-0">
        <p className="font-semibold text-base">Get chips</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5 space-y-4 overflow-y-auto min-h-0">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pending ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your request for{" "}
              <span className="font-semibold text-foreground">{formatChips(pending.amount)} chips</span> is waiting
              on an admin.
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button size="sm" variant="outline" onClick={handleCancel} disabled={submitting}>
              {submitting ? "Cancelling…" : "Cancel request"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="get-chips-amount">Amount</Label>
              <Input
                id="get-chips-amount"
                type="number"
                min={0.0001}
                step="any"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0"
                className="mt-1.5"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSubmit} disabled={submitting || !amountValid}>
                {submitting ? "Sending…" : "Send request"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the button in `LobbyTopBar.tsx`**

In `src/components/lobby/LobbyTopBar.tsx`, the `Props` interface currently reads:

```ts
interface Props {
  casino: Casino;
  balance: number;
  query: string;
  onQueryChange: (value: string) => void;
  onBack: () => void;
  codeCopied: boolean;
  onCopyCode: () => void;
}
```

Replace it with:

```ts
interface Props {
  casino: Casino;
  balance: number;
  query: string;
  onQueryChange: (value: string) => void;
  onBack: () => void;
  codeCopied: boolean;
  onCopyCode: () => void;
  onOpenGetChips: () => void;
}
```

Update the function signature line:

```ts
export function LobbyTopBar({ casino, balance, query, onQueryChange, onBack, codeCopied, onCopyCode }: Props) {
```

to:

```ts
export function LobbyTopBar({ casino, balance, query, onQueryChange, onBack, codeCopied, onCopyCode, onOpenGetChips }: Props) {
```

Then replace the "Get chips" button:

```tsx
          {/* No functionality yet. */}
          <button
            type="button"
            aria-label="Get chips"
            className={cn(
              EMERALD_CTA,
              "flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold shadow-[0_4px_14px_rgba(16,185,129,0.35)] lg:h-8 lg:w-auto lg:gap-1.5 lg:pl-[11px] lg:pr-3.5",
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.8} />
            <span className="hidden lg:inline">Get chips</span>
          </button>
```

with:

```tsx
          <button
            type="button"
            onClick={onOpenGetChips}
            aria-label="Get chips"
            className={cn(
              EMERALD_CTA,
              "flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold shadow-[0_4px_14px_rgba(16,185,129,0.35)] lg:h-8 lg:w-auto lg:gap-1.5 lg:pl-[11px] lg:pr-3.5",
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.8} />
            <span className="hidden lg:inline">Get chips</span>
          </button>
```

- [ ] **Step 3: Own the modal state in `GamesLobby.tsx`**

In `src/components/lobby/GamesLobby.tsx`, update the imports at the top. Current:

```tsx
import { useMemo, useState } from "react";
import { ChevronDown, Gamepad2, LayoutGrid, List, Search } from "lucide-react";
import { GameTile } from "../GameTile";
import {
  LOBBY_CATEGORIES,
  countByCategory,
  filterLobbyGames,
  lobbyAccentVars,
  type LobbyFilter,
} from "../../lib/lobby";
import { cn } from "../../lib/utils";
import type { Casino, CasinoGame } from "../../types";
import { FeaturedBanner } from "./FeaturedBanner";
import { LobbySidebar } from "./LobbySidebar";
import { LobbyTopBar } from "./LobbyTopBar";
import { PromoCards } from "./PromoCards";
import { RecentWins } from "./RecentWins";
import { ACCENT_CTA, ACCENT_SOFT, ACCENT_TEXT, GLASS, SWIPE_ROW } from "./styles";
```

Change to:

```tsx
import { useMemo, useState } from "react";
import { ChevronDown, Gamepad2, LayoutGrid, List, Search } from "lucide-react";
import { GameTile } from "../GameTile";
import {
  LOBBY_CATEGORIES,
  countByCategory,
  filterLobbyGames,
  lobbyAccentVars,
  type LobbyFilter,
} from "../../lib/lobby";
import { cn } from "../../lib/utils";
import type { Casino, CasinoGame } from "../../types";
import { useAuthStore } from "../../stores/authStore";
import { Modal } from "../ui/modal";
import { FeaturedBanner } from "./FeaturedBanner";
import { GetChipsModal } from "./GetChipsModal";
import { LobbySidebar } from "./LobbySidebar";
import { LobbyTopBar } from "./LobbyTopBar";
import { PromoCards } from "./PromoCards";
import { RecentWins } from "./RecentWins";
import { ACCENT_CTA, ACCENT_SOFT, ACCENT_TEXT, GLASS, SWIPE_ROW } from "./styles";
```

Inside the `GamesLobby` function body, right after the existing `const [filter, setFilter] = useState<LobbyFilter>("all");` line, add:

```tsx
  const { user } = useAuthStore();
  const [getChipsOpen, setGetChipsOpen] = useState(false);
```

Then find the `<LobbyTopBar ... />` element:

```tsx
        <LobbyTopBar
          casino={casino}
          balance={balance}
          query={query}
          onQueryChange={setQuery}
          onBack={onBack}
          codeCopied={codeCopied}
          onCopyCode={onCopyCode}
        />
```

Replace with:

```tsx
        <LobbyTopBar
          casino={casino}
          balance={balance}
          query={query}
          onQueryChange={setQuery}
          onBack={onBack}
          codeCopied={codeCopied}
          onCopyCode={onCopyCode}
          onOpenGetChips={() => setGetChipsOpen(true)}
        />
```

Finally, right before the closing `</div>` that ends the component's returned JSX (the outermost `<div className="relative isolate" ...>`), add:

```tsx
      {getChipsOpen && user && (
        <Modal onClose={() => setGetChipsOpen(false)} size="md">
          <GetChipsModal casinoId={casino.id} userId={user.id} onClose={() => setGetChipsOpen(false)} />
        </Modal>
      )}
```

so the end of the file reads:

```tsx
            </section>
          </div>
        </div>
      </div>

      {getChipsOpen && user && (
        <Modal onClose={() => setGetChipsOpen(false)} size="md">
          <GetChipsModal casinoId={casino.id} userId={user.id} onClose={() => setGetChipsOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Manual verification (Playwright, test account)**

Using the seeded test account (`claudetest.cassie@gmail.com` / `ClaudeTest123!`, see `CLAUDE.md`):
1. Start the dev server (`npm run dev`), sign in, open any casino's Games tab.
2. Click "Get chips" — the popup should open with an empty amount field.
3. Enter an amount (e.g. `250`) and submit — the popup should switch to "Your request for 250.0000 chips is waiting on an admin." with a Cancel button.
4. Reopen the popup (close and click "Get chips" again) — it should show the same pending state (not the form).
5. Click "Cancel request" — the popup should return to the empty form.

Report any visual or behavioral issue found; fix before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/components/lobby/GetChipsModal.tsx src/components/lobby/LobbyTopBar.tsx src/components/lobby/GamesLobby.tsx
git commit -m "feat(chip-requests): wire up the Get chips popup"
```

---

### Task 6: Notification bell + popup

Named `NotificationsModal.tsx` here rather than the spec's `NotificationsPopover.tsx` —
it's built on the existing centered `<Modal>` component (same as `GetChipsModal` and
every other popup in this app) rather than a custom anchored dropdown, so the name
matches what it actually is. No behavior difference from the spec's description.

**Files:**
- Create: `src/components/lobby/NotificationsModal.tsx`
- Modify: `src/components/lobby/LobbyTopBar.tsx`
- Modify: `src/components/lobby/GamesLobby.tsx`

**Interfaces:**
- Consumes: `useNotifications()` from Task 3, `AppNotification` type from Task 3, `notificationMessage` from Task 4.
- Produces: `NotificationsModal({ notifications: AppNotification[]; loading: boolean; onClose: () => void })`.

- [ ] **Step 1: Write `src/components/lobby/NotificationsModal.tsx`**

```tsx
import { X } from "lucide-react";
import { notificationMessage } from "../../lib/notifications";
import type { AppNotification } from "../../types";

const GLASS = "bg-background border border-white/10";

export function NotificationsModal({
  notifications,
  loading,
  onClose,
}: {
  notifications: AppNotification[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className={`rounded-2xl ${GLASS} overflow-hidden flex-1 min-h-0 flex flex-col`}>
      <div className="flex items-start justify-between p-5 border-b border-white/10 shrink-0">
        <p className="font-semibold text-base">Notifications</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-2 overflow-y-auto min-h-0">
        {loading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-2.5 px-3 py-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "" : "bg-emerald-400"}`} />
                <div>
                  <p className="text-sm">{notificationMessage(n)}</p>
                  <p className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the bell in `LobbyTopBar.tsx`**

In the `Props` interface (already extended by Task 5), add one more field so it reads:

```ts
interface Props {
  casino: Casino;
  balance: number;
  query: string;
  onQueryChange: (value: string) => void;
  onBack: () => void;
  codeCopied: boolean;
  onCopyCode: () => void;
  onOpenGetChips: () => void;
  hasUnread: boolean;
  onOpenNotifications: () => void;
}
```

Update the function signature line to also destructure the two new props:

```ts
export function LobbyTopBar({
  casino,
  balance,
  query,
  onQueryChange,
  onBack,
  codeCopied,
  onCopyCode,
  onOpenGetChips,
  hasUnread,
  onOpenNotifications,
}: Props) {
```

Replace the bell button:

```tsx
        {/* No functionality yet. */}
        <button
          type="button"
          aria-label="Notifications"
          className={cn(GLASS, "hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 lg:flex")}
        >
          <Bell className="h-[18px] w-[18px]" />
        </button>
```

with:

```tsx
        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label="Notifications"
          className={cn(GLASS, "relative hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 lg:flex")}
        >
          <Bell className="h-[18px] w-[18px]" />
          {hasUnread && <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />}
        </button>
```

(The bell stays desktop-only — `lg:flex` — matching its existing pre-feature visibility; this plan doesn't add a mobile entry point for it.)

- [ ] **Step 3: Fetch notifications and own popup state in `GamesLobby.tsx`**

This step introduces the first `useEffect` call in this file, so first update the React import line:

```tsx
import { useMemo, useState } from "react";
```

to:

```tsx
import { useEffect, useMemo, useState } from "react";
```

Then add to the imports (alongside the `GetChipsModal` import from Task 5):

```tsx
import { useNotifications } from "../../hooks/useNotifications";
import { NotificationsModal } from "./NotificationsModal";
```

and change the type-only import line:

```tsx
import type { Casino, CasinoGame } from "../../types";
```

to:

```tsx
import type { AppNotification, Casino, CasinoGame } from "../../types";
```

Inside the `GamesLobby` function body, after the `const [getChipsOpen, setGetChipsOpen] = useState(false);` line added in Task 5, add:

```tsx
  const { listNotifications, markNotificationsRead } = useNotifications();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const hasUnread = notifications.some((n) => !n.read_at);

  useEffect(() => {
    let cancelled = false;
    setNotificationsLoading(true);
    listNotifications(casino.id)
      .then((rows) => {
        if (!cancelled) setNotifications(rows);
      })
      .finally(() => {
        if (!cancelled) setNotificationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [casino.id]);

  async function openNotifications() {
    setNotificationsOpen(true);
    if (!hasUnread) return;
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    try {
      await markNotificationsRead(casino.id);
    } catch {
      // Best-effort — a failed mark-as-read just means the dot may return on next load.
    }
  }
```

Then update the `<LobbyTopBar ... />` element from Task 5 to also pass the two new props:

```tsx
        <LobbyTopBar
          casino={casino}
          balance={balance}
          query={query}
          onQueryChange={setQuery}
          onBack={onBack}
          codeCopied={codeCopied}
          onCopyCode={onCopyCode}
          onOpenGetChips={() => setGetChipsOpen(true)}
          hasUnread={hasUnread}
          onOpenNotifications={openNotifications}
        />
```

Finally, add the notifications modal next to the `GetChipsModal` one from Task 5, so the end of the file reads:

```tsx
      {getChipsOpen && user && (
        <Modal onClose={() => setGetChipsOpen(false)} size="md">
          <GetChipsModal casinoId={casino.id} userId={user.id} onClose={() => setGetChipsOpen(false)} />
        </Modal>
      )}
      {notificationsOpen && (
        <Modal onClose={() => setNotificationsOpen(false)} size="md">
          <NotificationsModal
            notifications={notifications}
            loading={notificationsLoading}
            onClose={() => setNotificationsOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Manual verification (Playwright, test account)**

This depends on Task 7 having a way to generate `chip_request_created`/`accepted`/`denied` notifications, so do a light check now and the full flow in Task 8:
1. Sign in with the test account, open a casino's Games tab.
2. Confirm the bell shows no red dot when there are no notifications.
3. Click the bell — the popup should open showing "No notifications yet." and close on the X button or Escape.

- [ ] **Step 6: Commit**

```bash
git add src/components/lobby/NotificationsModal.tsx src/components/lobby/LobbyTopBar.tsx src/components/lobby/GamesLobby.tsx
git commit -m "feat(chip-requests): wire up the notification bell"
```

---

### Task 7: Trades page — pending requests, Accept/Deny/Cancel

**Files:**
- Modify: `src/components/ChipLedgerPanel.tsx`
- Modify: `src/pages/CasinoDashboard.tsx`

**Interfaces:**
- Consumes: `useChipRequests()` from Task 2, `ChipRequest` type from Task 2.
- Produces: `ChipLedgerPanel` gains a required `canManage: boolean` prop (owner/admin only — narrower than the existing `showUserColumn`, which also covers agents).

- [ ] **Step 1: Replace `src/components/ChipLedgerPanel.tsx`**

Replace the full file content with:

```tsx
import { useCallback, useEffect, useState } from "react";
import { DateRangePicker } from "./ui/datepicker";
import { Button } from "./ui/button";
import { ChipLedgerTable } from "./ChipLedgerTable";
import { useCasino } from "../hooks/useCasino";
import { useChipRequests } from "../hooks/useChipRequests";
import { formatChips } from "../lib/utils";
import type { ChipRequest, ChipTransaction } from "../types";

type LedgerPeriod = "today" | "7d" | "30d" | "custom";

const PERIODS: { id: LedgerPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "custom", label: "Custom" },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function ChipLedgerPanel({
  casinoId,
  showUserColumn,
  canManage,
}: {
  casinoId: string;
  showUserColumn: boolean;
  canManage: boolean;
}) {
  const { listChipTransactions } = useCasino();
  const { listChipRequests, acceptChipRequest, denyChipRequest, cancelChipRequest } = useChipRequests();
  const [period, setPeriod] = useState<LedgerPeriod>("today");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());
  const [rows, setRows] = useState<ChipTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<ChipRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const refreshLedger = useCallback(() => {
    const earliestAllowed = new Date(Date.now() - 30 * 86_400_000);
    let from: Date;
    let to = new Date();
    if (period === "today") from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    else if (period === "7d") from = new Date(Date.now() - 7 * 86_400_000);
    else if (period === "30d") from = earliestAllowed;
    else {
      from = customFrom ? new Date(customFrom) : earliestAllowed;
      if (from < earliestAllowed) from = earliestAllowed;
      to = customTo ? new Date(customTo + "T23:59:59") : new Date();
    }

    setLoading(true);
    setError(null);
    return listChipTransactions(casinoId, from, to)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
    // listChipTransactions deliberately omitted: useCasino() returns a fresh
    // function reference every render, so including it here would recompute
    // refreshLedger every render, retrigger the effect below, and loop.
  }, [casinoId, period, customFrom, customTo]);

  useEffect(() => {
    refreshLedger();
  }, [refreshLedger]);

  const refreshPending = useCallback(() => {
    setPendingLoading(true);
    return listChipRequests(casinoId)
      .then(setPending)
      .catch(() => setPending([]))
      .finally(() => setPendingLoading(false));
    // listChipRequests omitted for the same reason as listChipTransactions above.
  }, [casinoId]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  async function handleAccept(id: string) {
    setResolvingId(id);
    setPendingError(null);
    try {
      await acceptChipRequest(id);
      await Promise.all([refreshPending(), refreshLedger()]);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Failed to accept request");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleDeny(id: string) {
    setResolvingId(id);
    setPendingError(null);
    try {
      await denyChipRequest(id);
      await refreshPending();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Failed to deny request");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleCancel(id: string) {
    setResolvingId(id);
    setPendingError(null);
    try {
      await cancelChipRequest(id);
      await refreshPending();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Failed to cancel request");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {!pendingLoading && pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Pending requests</h3>
          <div className="space-y-2">
            {pending.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  {showUserColumn && <p className="text-sm font-medium truncate">{r.username ?? "Unknown"}</p>}
                  <p className="font-mono text-sm">{formatChips(r.amount)} chips</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canManage ? (
                    <>
                      <Button size="sm" variant="outline" disabled={resolvingId === r.id} onClick={() => handleDeny(r.id)}>
                        Deny
                      </Button>
                      <Button size="sm" disabled={resolvingId === r.id} onClick={() => handleAccept(r.id)}>
                        Accept
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" disabled={resolvingId === r.id} onClick={() => handleCancel(r.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {pendingError && <p className="text-xs text-destructive">{pendingError}</p>}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                period === id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <DateRangePicker
            from={customFrom}
            to={customTo}
            onFromChange={setCustomFrom}
            onToChange={setCustomTo}
            maxTo={todayStr()}
            minFrom={daysAgoStr(30)}
            maxRangeDays={30}
          />
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <ChipLedgerTable rows={rows} showUserColumn={showUserColumn} loading={loading} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Pass `canManage` from `CasinoDashboard.tsx`**

Find:

```tsx
          {activeTab === "trades" && (
            <ChipLedgerPanel casinoId={currentCasino.id} showUserColumn={canViewMembers} />
          )}
```

Replace with:

```tsx
          {activeTab === "trades" && (
            <ChipLedgerPanel casinoId={currentCasino.id} showUserColumn={canViewMembers} canManage={canManageMembers} />
          )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChipLedgerPanel.tsx src/pages/CasinoDashboard.tsx
git commit -m "feat(chip-requests): show pending requests on the Trades page with accept/deny/cancel"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full flow as a member, then as admin**

Using the seeded test account (which is admin in every casino — see `CLAUDE.md`), you need a second account to play the "member" side. If one doesn't already exist, sign up a second test user through the real signup flow using a real inbox you control (per `CLAUDE.md`'s email policy — do not use a made-up address), or seed one via direct DB insert mirroring the `@mock.cassie` pattern used elsewhere in the migrations, then join it to the same casino as a plain member (not admin).

As the member:
1. Open the casino's Games tab, click "Get chips", request e.g. `500` chips, confirm the popup shows the pending state.
2. Confirm the pending request also appears on the Trades tab with a Cancel button and no Accept/Deny.

As the admin (`claudetest.cassie@gmail.com`) in another browser context/tab:
3. Open the same casino's Trades tab — confirm the pending request appears under "Pending requests" with the member's username, the amount, and Accept/Deny buttons.
4. Confirm the bell shows a red dot (from the `chip_request_created` notification) and opening it shows "*{member} requested 500.0000 chips*"; confirm the dot clears after opening.
5. Click Accept — confirm the pending row disappears, the member's balance increases by exactly 500 (visible via the ledger table showing a new "Given" row with `admin_username` = the test admin), and re-fetch the ledger to confirm.

Back as the member:
6. Confirm the bell shows a red dot and opening it shows "Your request for 500.0000 chips was accepted".
7. Confirm "Get chips" now opens the empty form again (no lingering pending state).

Repeat steps 1-4 once more with a new request, but this time click **Deny** instead of Accept — confirm: the balance does not change, the pending row disappears from the Trades page, and the member's bell shows "Your request for {amount} chips was denied".

- [ ] **Step 2: Concurrent-request guard**

As the member, submit a request, then (before it's resolved) try to submit a second one from a second tab logged in as the same member. Confirm the second attempt fails with "You already have a pending request" rather than creating a second row.

- [ ] **Step 3: Report results**

If Playwright's browser is unavailable in this environment (as it was earlier in this project's session — a locked profile from another running Chrome process), say so explicitly rather than claiming the flow was verified, per `CLAUDE.md`'s testing guidance. In that case, at minimum re-run `npx tsc --noEmit -p .` and `npm run test` across the whole project and report those results, and ask the user to spot-check the flow manually.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as a small follow-up commit referencing which step failed.
