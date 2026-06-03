-- Trigger: auto-join casino owner as a member when the casino is created.
create or replace function public.auto_join_owner()
returns trigger language plpgsql security definer as $$
begin
  insert into public.casino_members (casino_id, user_id, balance, role)
  values (
    NEW.id,
    NEW.owner_id,
    coalesce((NEW.settings->>'startingBalance')::bigint, 0),
    'owner'
  )
  on conflict (casino_id, user_id) do nothing;
  return NEW;
end;
$$;

create trigger on_casino_created
  after insert on public.casinos
  for each row execute function public.auto_join_owner();

-- Backfill: add owner membership for any casinos created before this migration.
insert into public.casino_members (casino_id, user_id, balance, role)
select
  c.id,
  c.owner_id,
  coalesce((c.settings->>'startingBalance')::bigint, 0),
  'owner'
from public.casinos c
where not exists (
  select 1 from public.casino_members m
  where m.casino_id = c.id and m.user_id = c.owner_id
);
