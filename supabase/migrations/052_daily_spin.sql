-- Daily Spin. Config lives in casinos.settings->'specialFeatures'->'dailySpin'
-- (jsonb, no schema change needed). The only state a cooldown needs is the
-- last claim time; per-claim history is already the transactions row.

alter table public.casino_members
  add column if not exists last_daily_spin_at timestamptz;

-- Credits an already-chosen daily spin prize.
--
-- The prize itself is picked in TypeScript (supabase/functions/daily-spin),
-- so this function knows nothing about wheels or odds -- it only moves money,
-- atomically, behind the cooldown guard.
--
-- `balance = balance + p_amount` rather than a value computed by the caller:
-- every game function in this codebase reads a balance and writes back a
-- number derived from it, which is safe there because a player has one round
-- in flight at a time. A daily spin can land while a game round is resolving,
-- so the increment is done here, against the current row, under its lock.
create or replace function public.claim_daily_spin(
  p_casino_id uuid,
  p_user_id uuid,
  p_amount numeric(16,4),
  p_cooldown_hours int,
  p_description text
)
returns numeric(16,4)
language plpgsql security definer
set search_path = public
as $$
declare
  v_balance numeric(16,4);
begin
  update public.casino_members
     set balance = balance + p_amount,
         last_daily_spin_at = now()
   where casino_id = p_casino_id
     and user_id = p_user_id
     and (last_daily_spin_at is null
          or last_daily_spin_at <= now() - make_interval(hours => p_cooldown_hours))
  returning balance into v_balance;

  -- No row matched: either still cooling down, or not a member. The caller
  -- cannot tell these apart from a null, and does not need to -- it has
  -- already proven membership before getting here, so a null means the
  -- cooldown guard rejected the claim.
  if not found then
    return null;
  end if;

  -- game_type_id is null on purpose: the stats RPCs all filter
  -- `game_type_id is not null`, so a spin stays out of per-game profit/loss.
  -- It is a chip grant, like give_chips, not a wager.
  insert into public.transactions
    (casino_id, user_id, amount, balance_after, game_type_id, description)
  values
    (p_casino_id, p_user_id, p_amount, v_balance, null, p_description);

  return v_balance;
end;
$$;

-- Only the edge function (service-role key) may call this. Without the
-- revoke, any client holding the anon key could award itself any amount.
revoke execute on function public.claim_daily_spin(uuid, uuid, numeric, int, text)
  from public, anon, authenticated;
