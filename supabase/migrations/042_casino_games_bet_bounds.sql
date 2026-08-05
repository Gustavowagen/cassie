-- Enforce a global floor/ceiling on per-instance bet limits: admins can set
-- min_bet no lower than 0.01 and max_bet no higher than 10,000,000.

alter table public.casino_games
  drop constraint casino_games_bet_range_check;

alter table public.casino_games
  add constraint casino_games_bet_range_check
  check (min_bet >= 0.01 and max_bet <= 10000000 and max_bet >= min_bet);
