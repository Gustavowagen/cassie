-- Helper function that checks membership without triggering RLS recursion.
-- SECURITY DEFINER runs as the function owner, bypassing RLS on casino_members.
create or replace function public.is_casino_member(p_casino_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid()
  );
$$;

-- Replace the self-referential policy with one that calls the helper.
drop policy if exists "Casino members can view all members of same casino" on public.casino_members;

create policy "Casino members can view all members of same casino"
on public.casino_members for select
using (public.is_casino_member(casino_id));
