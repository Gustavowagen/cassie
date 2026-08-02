-- Widen money columns from numeric(14,2) to numeric(16,4) so balances,
-- bets, and transactions carry 4 decimal places instead of 2.
alter table public.casino_members alter column balance type numeric(16,4);
alter table public.game_types alter column min_bet type numeric(16,4);
alter table public.game_types alter column max_bet type numeric(16,4);
alter table public.transactions alter column amount type numeric(16,4);
alter table public.transactions alter column balance_after type numeric(16,4);

-- Recreate every function that declares a numeric(14,2) param/local/return so
-- none of them silently truncate the new 4-decimal-place values back to 2.

create or replace function public.join_casino(p_casino_id uuid)
returns public.casino_members language plpgsql security definer as $$
declare
  v_starting_balance numeric(16,4);
  v_member public.casino_members;
begin
  select (settings->>'startingBalance')::numeric(16,4)
  into v_starting_balance
  from public.casinos
  where id = p_casino_id and is_active = true;

  if not found then
    raise exception 'Casino not found or inactive';
  end if;

  insert into public.casino_members (casino_id, user_id, balance)
  values (p_casino_id, auth.uid(), v_starting_balance)
  returning * into v_member;

  return v_member;
end;
$$;

create or replace function public.auto_join_owner()
returns trigger language plpgsql security definer as $$
begin
  insert into public.casino_members (casino_id, user_id, balance, role)
  values (
    new.id,
    new.owner_id,
    coalesce((new.settings->>'startingBalance')::numeric(16,4), 0),
    'member'
  )
  on conflict (casino_id, user_id) do nothing;
  return new;
end;
$$;

create or replace function public.give_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(16,4)
)
returns void language plpgsql security definer as $$
declare
  v_new_balance numeric(16,4);
  v_authorized boolean;
begin
  select exists (
    select 1 from public.casinos where id = p_casino_id and owner_id = auth.uid()
    union all
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'admin'
  ) into v_authorized;

  if not v_authorized then
    raise exception 'Only the casino creator or an admin can give chips';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  update public.casino_members
  set balance = balance + p_amount
  where casino_id = p_casino_id and user_id = p_target_user_id
  returning balance into v_new_balance;

  if not found then
    raise exception 'Member not found';
  end if;

  insert into public.transactions (casino_id, user_id, admin_id, amount, balance_after, description)
  values (p_casino_id, p_target_user_id, auth.uid(), p_amount, v_new_balance, 'Admin chip grant');
end;
$$;

create or replace function public.remove_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(16,4)
)
returns void language plpgsql security definer as $$
declare
  v_current_balance numeric(16,4);
  v_new_balance numeric(16,4);
  v_authorized boolean;
begin
  select exists (
    select 1 from public.casinos where id = p_casino_id and owner_id = auth.uid()
    union all
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'admin'
  ) into v_authorized;

  if not v_authorized then
    raise exception 'Only the casino creator or an admin can remove chips';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select balance into v_current_balance
  from public.casino_members
  where casino_id = p_casino_id and user_id = p_target_user_id
  for update;

  if not found then
    raise exception 'Member not found';
  end if;

  v_new_balance := v_current_balance - p_amount;
  if v_new_balance < 0 then
    raise exception 'Cannot remove more chips than the member has';
  end if;

  update public.casino_members
  set balance = v_new_balance
  where casino_id = p_casino_id and user_id = p_target_user_id;

  insert into public.transactions (casino_id, user_id, admin_id, amount, balance_after, description)
  values (p_casino_id, p_target_user_id, auth.uid(), -p_amount, v_new_balance, 'Admin chip removal');
end;
$$;

create or replace function public.get_member_profit_loss(
  p_casino_id   uuid,
  p_user_id     uuid,
  p_from        timestamptz default null,
  p_to          timestamptz default null
) returns numeric(16,4)
language plpgsql
security definer
as $$
declare
  v_authorized  boolean;
  v_profit_loss numeric(16,4);
begin
  select exists (
    select 1 from public.casinos where id = p_casino_id and owner_id = auth.uid()
    union all
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'admin'
  ) into v_authorized;

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

create or replace function public.get_casino_stats(
  p_casino_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_authorized boolean;
  v_player_pl numeric(16,4);
begin
  select exists (
    select 1 from public.casinos where id = p_casino_id and owner_id = auth.uid()
    union all
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'admin'
  ) into v_authorized;

  if not v_authorized then raise exception 'Not authorized'; end if;

  select coalesce(sum(amount), 0)
  into v_player_pl
  from public.transactions
  where casino_id = p_casino_id
    and game_type_id is not null
    and (p_from is null or created_at >= p_from)
    and (p_to is null or created_at <= p_to);

  return jsonb_build_object('player_profit_loss', v_player_pl);
end;
$$;

create or replace function public.record_game_result(
  p_casino_id uuid,
  p_game_type_id text,
  p_net_amount numeric(16,4),
  p_description text default null
) returns numeric(16,4)
language plpgsql
security definer
as $$
declare
  v_current_balance numeric(16,4);
  v_new_balance     numeric(16,4);
begin
  select balance into v_current_balance
  from public.casino_members
  where casino_id = p_casino_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Not a member of this casino';
  end if;

  v_new_balance := v_current_balance + p_net_amount;

  if v_new_balance < 0 then
    raise exception 'Insufficient balance';
  end if;

  update public.casino_members
  set balance = v_new_balance
  where casino_id = p_casino_id and user_id = auth.uid();

  insert into public.transactions (casino_id, user_id, amount, balance_after, game_type_id, description)
  values (p_casino_id, auth.uid(), p_net_amount, v_new_balance, p_game_type_id, p_description);

  return v_new_balance;
end;
$$;

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
  amount numeric(16,4),
  balance_after numeric(16,4),
  created_at timestamptz
) language plpgsql security definer as $$
declare
  v_is_admin boolean;
begin
  select exists (
    select 1 from public.casinos c where c.id = p_casino_id and c.owner_id = auth.uid()
    union all
    select 1 from public.casino_members cm
    where cm.casino_id = p_casino_id and cm.user_id = auth.uid() and cm.role = 'admin'
  ) into v_is_admin;

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
    and (v_is_admin or t.user_id = auth.uid())
  order by t.created_at desc;
end;
$$;
