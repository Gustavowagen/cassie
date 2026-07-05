-- Extend roulette range to cover all three stake tiers, matching blackjack
-- (Low min = 0.1, High max = 1,000,000).
update public.game_types set min_bet = 0.1, max_bet = 1000000 where id = 'roulette';
