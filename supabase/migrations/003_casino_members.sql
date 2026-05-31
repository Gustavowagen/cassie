create table public.casino_members (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  balance bigint not null default 0,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  unique(casino_id, user_id)
);

alter table public.casino_members enable row level security;

create policy "Casino members can view all members of same casino"
  on public.casino_members for select using (
    exists (
      select 1 from public.casino_members cm
      where cm.casino_id = casino_members.casino_id and cm.user_id = auth.uid()
    )
  );

create policy "Users can join casinos"
  on public.casino_members for insert with check (auth.uid() = user_id);

create or replace function public.join_casino(p_casino_id uuid)
returns public.casino_members language plpgsql security definer as $$
declare
  v_starting_balance bigint;
  v_member public.casino_members;
begin
  select (settings->>'startingBalance')::bigint
  into v_starting_balance
  from public.casinos
  where id = p_casino_id and is_active = true;

  if not found then
    raise exception 'Casino not found or inactive';
  end if;

  insert into public.casino_members (casino_id, user_id, balance)
  values (p_casino_id, auth.uid(), v_starting_balance)
  returning * into v_member;

  return v_member;
end;
$$;
