-- Gates of Olympus: a cascading 6x5 slot with multiplier orbs. Stateless like
-- Tumble and Plinko — one request plays a whole round (the opening board,
-- every cascade, and the orbs that survive them) and settles it, so there is
-- no rounds table holding an in-flight game. The client only replays the
-- returned steps as animation.
--
-- The feature buy is settled the same way: one request resolves all fifteen
-- free spins, including the multiplier that persists across them, and charges
-- the batch's price in the same atomic update.
--
-- Bet bounds match slots and tumble (035_slots_bet_range.sql,
-- 047_tumble.sql); per-instance limits still come from
-- casino_games.min_bet/max_bet (036_casino_games_bet_limits.sql), which are
-- seeded from these when a casino enables the game.
insert into public.game_types (id, name, description, min_bet, max_bet) values
  ('olympus', 'Gates of Olympus', 'Cascading 6x5 slot — 8 of a kind pays, and multiplier orbs multiply the lot', 0.001, 10000000);
