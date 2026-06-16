-- Switch chip balances/bets to decimal currency so blackjack's low-stakes
-- tier (0.1, 0.5 chip denominations) can be represented.
alter table public.casino_members alter column balance type numeric(14,2);
alter table public.game_types alter column min_bet type numeric(14,2);
alter table public.game_types alter column max_bet type numeric(14,2);
alter table public.transactions alter column amount type numeric(14,2);
alter table public.transactions alter column balance_after type numeric(14,2);

-- Blackjack's stake tiers now span 0.1 to 500000.
update public.game_types set min_bet = 0.1, max_bet = 500000 where id = 'blackjack';

-- Re-point functions that read/write balances at the new numeric type so
-- they don't silently truncate decimal balances back to whole numbers.
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

drop function if exists public.give_chips(uuid, uuid, bigint);
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

create or replace function public.auto_join_owner()
returns trigger language plpgsql security definer as $$
begin
  insert into public.casino_members (casino_id, user_id, balance, role)
  values (
    NEW.id,
    NEW.owner_id,
    coalesce((NEW.settings->>'startingBalance')::numeric(14,2), 0),
    'owner'
  )
  on conflict (casino_id, user_id) do nothing;
  return NEW;
end;
$$;
