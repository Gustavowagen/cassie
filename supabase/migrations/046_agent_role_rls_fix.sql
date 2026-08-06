-- Close a gap left by 043_agent_role.sql: get_casino_members() correctly
-- scopes an agent's view server-side, but the underlying casino_members
-- table's SELECT policy was left untouched (still "any casino member can
-- read every row" from migration 015), so an agent could bypass the RPC's
-- downline restriction entirely by querying the table directly (e.g. via
-- supabase.from('casino_members').select('*')) and read every member's
-- balance/role in the casino. This tightens the policy specifically for
-- the agent case; owner/admin/plain-member visibility is unchanged.
create or replace function public.my_casino_role(p_casino_id uuid)
returns text
language sql
security definer
stable
as $$
  select role from public.casino_members
  where casino_id = p_casino_id and user_id = auth.uid();
$$;

drop policy if exists "Casino members can view all members of same casino" on public.casino_members;

create policy "Casino members can view members per role"
on public.casino_members for select
using (
  public.is_casino_owner_or_admin(casino_id)
  or user_id = auth.uid()
  or (public.my_casino_role(casino_id) = 'agent' and agent_id = auth.uid())
  or public.my_casino_role(casino_id) = 'member'
);
