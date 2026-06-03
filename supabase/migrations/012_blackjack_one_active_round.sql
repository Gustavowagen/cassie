-- Guarantee at most one active (non-complete) blackjack round per user per
-- casino. Closes a double-deduction window where two concurrent `start` calls
-- could both insert an active round.
create unique index blackjack_rounds_one_active_idx
  on public.blackjack_rounds (casino_id, user_id)
  where status <> 'complete';
