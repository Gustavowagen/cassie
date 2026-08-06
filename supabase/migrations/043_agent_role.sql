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
