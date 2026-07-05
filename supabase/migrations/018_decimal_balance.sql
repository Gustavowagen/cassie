-- Widen money columns to numeric(14,2) to support fractional chip values (Low stake tier).
alter table public.casino_members alter column balance type numeric(14,2);
alter table public.game_types alter column min_bet type numeric(14,2);
alter table public.game_types alter column max_bet type numeric(14,2);
alter table public.transactions alter column amount type numeric(14,2);
alter table public.transactions alter column balance_after type numeric(14,2);

-- Extend blackjack range to cover all three stake tiers (Low min = 0.1, High max = 500000).
update public.game_types set min_bet = 0.1, max_bet = 1000000 where id = 'blackjack';

-- Recreate join_casino with numeric(14,2) local variable so the cast doesn't truncate decimals.
create or replace function public.join_casino(p_casino_id uuid)
returns public.casino_members language plpgsql security definer as $$
declare
  v_starting_balance numeric(14,2);
  v_member public.casino_members;
begin
  select (settings->>'startingBalance')::numeric(14,2)
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

-- Recreate give_chips with numeric(14,2) so decimal balances aren't silently truncated.
create or replace function public.give_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(14,2)
)
returns void language plpgsql security definer as $$
declare
  v_owner_id uuid;
  v_new_balance numeric(14,2);
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
