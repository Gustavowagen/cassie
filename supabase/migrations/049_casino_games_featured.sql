-- Admin-controlled "featured" flag driving which games surface in the
-- lobby's home "Featured Games" section. Category browsing always shows
-- every game in that category regardless of this flag.
-- Defaults to true so every existing game stays visible with no behavior
-- change until an admin explicitly unfeatures something.
alter table public.casino_games
  add column if not exists is_featured boolean not null default true;
