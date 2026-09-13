-- request_chips' notification used the client-sent p_amount (unrounded) instead of the
-- actually-stored v_request.amount (rounded to numeric(14,2)), so a fractional-cent request
-- could show a different amount in the admin's notification than everywhere else.
create or replace function public.request_chips(p_casino_id uuid, p_amount numeric(14,2))
returns public.chip_requests
language plpgsql security definer as $$
declare
  v_request public.chip_requests;
  v_username text;
begin
  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  if not exists (
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this casino';
  end if;

  insert into public.chip_requests (casino_id, user_id, amount)
  values (p_casino_id, auth.uid(), p_amount)
  returning * into v_request;

  select username into v_username from public.profiles where id = auth.uid();

  insert into public.notifications (casino_id, user_id, type, payload)
  select p_casino_id, recipient, 'chip_request_created',
         jsonb_build_object('request_id', v_request.id, 'amount', v_request.amount, 'requester_username', v_username)
  from (
    select user_id as recipient from public.casino_members
    where casino_id = p_casino_id and role = 'admin' and user_id <> auth.uid()
    union
    select owner_id from public.casinos
    where id = p_casino_id and owner_id <> auth.uid()
  ) recipients;

  return v_request;
end;
$$;
