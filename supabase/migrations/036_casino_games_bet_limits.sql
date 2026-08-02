-- Per-instance bet limits: admins can now set custom min/max bets on each
-- casino_games instance instead of every instance sharing the global
-- game_types limits.

alter table public.casino_games
  add column if not exists min_bet numeric(16,4),
  add column if not exists max_bet numeric(16,4);

update public.casino_games cg
set min_bet = gt.min_bet,
    max_bet = gt.max_bet
from public.game_types gt
where gt.id = cg.game_type_id
  and cg.min_bet is null;

alter table public.casino_games
  alter column min_bet set not null,
  alter column max_bet set not null;

alter table public.casino_games
  add constraint casino_games_bet_range_check check (min_bet > 0 and max_bet >= min_bet);
