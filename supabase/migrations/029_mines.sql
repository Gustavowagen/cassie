insert into public.game_types (id, name, description, min_bet, max_bet) values
  ('mines', 'Mines', 'Find gems, avoid the mines', 100, 50000);

create table public.mines_rounds (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast lookup of a user's active round in a casino.
create index mines_rounds_active_idx
  on public.mines_rounds (casino_id, user_id, status);

-- Guarantee at most one active (non-complete) mines round per user per
-- casino, closing the same double-deduction window Blackjack guards against.
create unique index mines_rounds_one_active_idx
  on public.mines_rounds (casino_id, user_id)
  where status <> 'complete';

-- RLS on with NO policies: the anon/authenticated roles get zero access.
-- The edge function uses the service role key, which bypasses RLS.
alter table public.mines_rounds enable row level security;
