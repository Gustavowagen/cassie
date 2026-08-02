-- Plinko is stateless: one request drops one ball and settles immediately, so
-- unlike Blackjack/Mines there is no rounds table to hold an in-flight game.
insert into public.game_types (id, name, description, min_bet, max_bet) values
  ('plinko', 'Plinko', 'Drop a ball and win where it lands', 100, 50000);
