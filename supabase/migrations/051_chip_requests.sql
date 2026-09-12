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
