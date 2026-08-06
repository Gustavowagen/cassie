-- Fix list_chip_transactions: the unconditional `t.user_id = auth.uid()`
-- branch let an agent see their own chip-grant/removal rows (since an
-- agent is also a casino_members row with their own user_id), leaking
-- outside the agent's downline-only view. A plain member should still see
-- their own rows; an agent's Trades view should be strictly their downline.
create or replace function public.list_chip_transactions(
  p_casino_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns table (
  id uuid,
  user_id uuid,
  username text,
  admin_id uuid,
  admin_username text,
  amount numeric(14,2),
  balance_after numeric(14,2),
  created_at timestamptz
) language plpgsql security definer as $$
declare
  v_is_owner_or_admin boolean;
  v_is_agent boolean;
begin
  v_is_owner_or_admin := public.is_casino_owner_or_admin(p_casino_id);
  v_is_agent := public.is_casino_agent(p_casino_id);

  return query
  select t.id, t.user_id, p.username, t.admin_id, pa.username,
         t.amount, t.balance_after, t.created_at
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  left join public.profiles pa on pa.id = t.admin_id
  where t.casino_id = p_casino_id
    and t.admin_id is not null
    and t.created_at >= p_from
    and t.created_at <= p_to
    and (
      v_is_owner_or_admin
      or (not v_is_agent and t.user_id = auth.uid())
      or (v_is_agent and exists (
        select 1 from public.casino_members cm
        where cm.casino_id = p_casino_id and cm.user_id = t.user_id and cm.agent_id = auth.uid()
      ))
    )
  order by t.created_at desc;
end;
$$;
