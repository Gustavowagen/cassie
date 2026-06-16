alter table public.casinos
  add column if not exists member_count int not null default 0;

-- Backfill existing rows
update public.casinos c
set member_count = (
  select count(*) from public.casino_members m where m.casino_id = c.id
);

create or replace function public.casinos_member_count_sync()
returns trigger language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.casinos
      set member_count = member_count + 1
      where id = new.casino_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.casinos
      set member_count = greatest(member_count - 1, 0)
      where id = old.casino_id;
    return old;
  end if;
  return null;
end;
$$;

create or replace trigger casino_members_count_sync
  after insert or delete on public.casino_members
  for each row execute function public.casinos_member_count_sync();
