alter table public.casinos
  add column if not exists join_code text unique not null
  default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
