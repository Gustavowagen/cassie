create or replace function public.give_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount bigint
)
returns void language plpgsql security definer as $$
declare
  v_owner_id uuid;
  v_new_balance bigint;
begin
  select owner_id into v_owner_id
  from public.casinos
  where id = p_casino_id and is_active = true;

  if v_owner_id is null or v_owner_id <> auth.uid() then
    raise exception 'Only the casino owner can give chips';
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

  insert into public.transactions (casino_id, user_id, amount, balance_after, description)
  values (p_casino_id, p_target_user_id, p_amount, v_new_balance, 'Admin chip grant');
end;
$$;
