create table public.game_types (
  id text primary key,
  name text not null,
  description text,
  min_bet bigint not null default 100,
  max_bet bigint not null default 100000
);

insert into public.game_types (id, name, description, min_bet, max_bet) values
  ('slots', 'Slot Machine', 'Classic 3-reel slot machine', 100, 50000),
  ('blackjack', 'Blackjack', 'Beat the dealer to 21', 500, 100000),
  ('roulette', 'Roulette', 'European single-zero roulette', 100, 100000),
  ('crash', 'Crash', 'Cash out before the multiplier crashes', 100, 50000),
  ('dice', 'Dice Roll', 'Roll over or under a target number', 100, 50000);

create table public.casino_games (
  casino_id uuid not null references public.casinos(id) on delete cascade,
  game_type_id text not null references public.game_types(id),
  is_active boolean not null default true,
  primary key (casino_id, game_type_id)
);

alter table public.casino_games enable row level security;
alter table public.game_types enable row level security;

create policy "Game types are public"
  on public.game_types for select using (true);

create policy "Casino games visible to all"
  on public.casino_games for select using (true);

create policy "Only casino owner can manage games"
  on public.casino_games for all using (
    exists (select 1 from public.casinos where id = casino_id and owner_id = auth.uid())
  );
