create table public.casinos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text unique not null,
  description text,
  theme jsonb not null default '{"primaryColor":"#7c3aed","logoUrl":null,"backgroundUrl":null}'::jsonb,
  settings jsonb not null default '{"startingBalance":10000,"allowPublicJoin":true,"maxMembers":500}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

alter table public.casinos enable row level security;

create policy "Casinos are publicly viewable"
  on public.casinos for select using (true);

create policy "Authenticated users can create casinos"
  on public.casinos for insert with check (auth.uid() = owner_id);

create policy "Only owner can update casino"
  on public.casinos for update using (auth.uid() = owner_id);

create policy "Only owner can delete casino"
  on public.casinos for delete using (auth.uid() = owner_id);

alter table public.casinos
  add constraint casinos_slug_format check (slug ~ '^[a-z0-9-]+$');
