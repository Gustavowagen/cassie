-- Per-instance settings blob for casino_games (e.g. slots' reward mode).
-- Defaults to '{}' so every existing instance keeps its current behavior.
alter table public.casino_games
  add column if not exists settings jsonb not null default '{}'::jsonb;
