-- Fix: when an owner transfers ownership away, they become an admin
-- (not a plain member) so they retain management privileges.
CREATE OR REPLACE FUNCTION public.transfer_casino_ownership(
  p_casino_id uuid,
  p_new_owner_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (SELECT owner_id FROM public.casinos WHERE id = p_casino_id) IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the casino owner can transfer ownership';
  END IF;

  IF p_new_owner_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.casino_members
    WHERE casino_id = p_casino_id AND user_id = p_new_owner_id
  ) THEN
    RAISE EXCEPTION 'Target user is not a member of this casino';
  END IF;

  UPDATE public.casinos SET owner_id = p_new_owner_id WHERE id = p_casino_id;

  UPDATE public.casino_members
  SET role = 'admin'
  WHERE casino_id = p_casino_id AND user_id = auth.uid();
END;
$$;
