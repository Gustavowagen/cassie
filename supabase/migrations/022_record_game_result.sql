-- Generic RPC for client-side games to record a result atomically.
-- Updates casino_members.balance and inserts a transaction row.
-- The last_played_at trigger on transactions fires automatically.

CREATE OR REPLACE FUNCTION public.record_game_result(
  p_casino_id uuid,
  p_game_type_id text,
  p_net_amount numeric(14,2),
  p_description text DEFAULT NULL
) RETURNS numeric(14,2)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance numeric(14,2);
  v_new_balance     numeric(14,2);
BEGIN
  SELECT balance INTO v_current_balance
  FROM public.casino_members
  WHERE casino_id = p_casino_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this casino';
  END IF;

  v_new_balance := v_current_balance + p_net_amount;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE public.casino_members
  SET balance = v_new_balance
  WHERE casino_id = p_casino_id AND user_id = auth.uid();

  INSERT INTO public.transactions (casino_id, user_id, amount, balance_after, game_type_id, description)
  VALUES (p_casino_id, auth.uid(), p_net_amount, v_new_balance, p_game_type_id, p_description);

  RETURN v_new_balance;
END;
$$;
