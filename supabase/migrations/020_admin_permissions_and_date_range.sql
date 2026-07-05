-- 1. Helper: check if current user is an admin of a given casino (bypasses RLS to avoid recursion)
CREATE OR REPLACE FUNCTION public.is_casino_admin(p_casino_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.casino_members
    WHERE casino_id = p_casino_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- 2. Let admins update casino settings (description, theme, enabled games, etc.)
DROP POLICY IF EXISTS "Only owner can update casino" ON public.casinos;
CREATE POLICY "Owner or admin can update casino"
  ON public.casinos FOR UPDATE
  USING (auth.uid() = owner_id OR public.is_casino_admin(id));

-- 3. Rebuild get_member_profit_loss with optional date-range params
CREATE OR REPLACE FUNCTION public.get_member_profit_loss(
  p_casino_id   uuid,
  p_user_id     uuid,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL
) RETURNS numeric(14,2)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_authorized  boolean;
  v_profit_loss numeric(14,2);
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.casinos WHERE id = p_casino_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.casino_members
    WHERE casino_id = p_casino_id AND user_id = auth.uid() AND role = 'admin'
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to view member stats';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_profit_loss
  FROM public.transactions
  WHERE casino_id    = p_casino_id
    AND user_id      = p_user_id
    AND game_type_id IS NOT NULL
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to   IS NULL OR created_at <= p_to);

  RETURN v_profit_loss;
END;
$$;
