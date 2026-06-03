create table public.blackjack_rounds (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  status text not null default 'player_turn',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast lookup of a user's active round in a casino.
create index blackjack_rounds_active_idx
  on public.blackjack_rounds (casino_id, user_id, status);

-- RLS on with NO policies: the anon/authenticated roles get zero access.
-- The edge function uses the service role key, which bypasses RLS.
alter table public.blackjack_rounds enable row level security;
