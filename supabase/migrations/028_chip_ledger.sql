-- Track which admin performed a chip grant/removal, and expose a scoped
-- ledger RPC: admins/owner see every member's rows, everyone else sees
-- only their own.

alter table public.transactions
  add column admin_id uuid references auth.users(id) on delete set null;

-- Recreate give_chips (unchanged behavior) to also record the acting admin.
create or replace function public.give_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(14,2)
)
returns void language plpgsql security definer as $$
declare
  v_new_balance numeric(14,2);
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

-- Recreate remove_chips (unchanged behavior) to also record the acting admin.
create or replace function public.remove_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(14,2)
)
returns void language plpgsql security definer as $$
declare
  v_current_balance numeric(14,2);
  v_new_balance numeric(14,2);
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

-- Scoped ledger read: admins/owner get every member's grant/removal rows,
-- everyone else gets only their own.
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
