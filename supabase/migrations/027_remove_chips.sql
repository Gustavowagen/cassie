-- RPC: Remove chips from a member's balance (casino creator or admin only).
-- Mirrors give_chips but subtracts and blocks the balance from going negative.
CREATE OR REPLACE FUNCTION public.remove_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(14,2)
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_balance numeric(14,2);
  v_new_balance numeric(14,2);
  v_authorized boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.casinos WHERE id = p_casino_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.casino_members
    WHERE casino_id = p_casino_id AND user_id = auth.uid() AND role = 'admin'
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Only the casino creator or an admin can remove chips';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT balance INTO v_current_balance
  FROM public.casino_members
  WHERE casino_id = p_casino_id AND user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  v_new_balance := v_current_balance - p_amount;
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Cannot remove more chips than the member has';
  END IF;

  UPDATE public.casino_members
  SET balance = v_new_balance
  WHERE casino_id = p_casino_id AND user_id = p_target_user_id;

  INSERT INTO public.transactions (casino_id, user_id, amount, balance_after, description)
  VALUES (p_casino_id, p_target_user_id, -p_amount, v_new_balance, 'Admin chip removal');
END;
$$;
