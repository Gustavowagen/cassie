-- Tumble: a cascading 5x6 slot. Stateless like Plinko and Dice — one request
-- plays the whole round (opening board, every tumble, and the multiplier
-- orbs) and settles it, so there is no rounds table holding an in-flight
-- game. The client only replays the returned steps as an animation.
--
-- Bet bounds match slots (035_slots_bet_range.sql); per-instance limits still
-- come from casino_games.min_bet/max_bet (036_casino_games_bet_limits.sql),
-- which are seeded from these when a casino enables the game.
insert into public.game_types (id, name, description, min_bet, max_bet) values
  ('tumble', 'Tumble', 'Cascading 5x6 slot — winning symbols pop and new ones rain down', 0.001, 10000000);
