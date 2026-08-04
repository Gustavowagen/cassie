-- crash_rounds mirrors mines_rounds' shape and guarantees exactly: one
-- active (non-complete) round per user per casino, RLS-on-no-policies
-- since only the service-role key (used by the edge function) touches it.
create table public.crash_rounds (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crash_rounds_active_idx
  on public.crash_rounds (casino_id, user_id, status);

create unique index crash_rounds_one_active_idx
  on public.crash_rounds (casino_id, user_id)
  where status <> 'complete';

alter table public.crash_rounds enable row level security;
