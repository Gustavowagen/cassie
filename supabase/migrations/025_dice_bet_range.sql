-- Update dice game bet range to 0.1 - 10000000
update public.game_types set min_bet = 0.1, max_bet = 10000000 where id = 'dice';
