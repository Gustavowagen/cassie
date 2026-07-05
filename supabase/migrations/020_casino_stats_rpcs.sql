
-- RPC: Get total player P&L for the casino (sum of all game transaction amounts)
-- A negative total means players lost chips overall = casino is profitable
CREATE OR REPLACE FUNCTION public.get_casino_stats(
  p_casino_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_authorized boolean;
  v_player_pl numeric(14,2);
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.casinos WHERE id = p_casino_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.casino_members
    WHERE casino_id = p_casino_id AND user_id = auth.uid() AND role = 'admin'
  ) INTO v_authorized;

  IF NOT v_authorized THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_player_pl
  FROM public.transactions
  WHERE casino_id = p_casino_id
    AND game_type_id IS NOT NULL
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at <= p_to);

  RETURN jsonb_build_object('player_profit_loss', v_player_pl);
END;
$$;

-- RPC: Get daily transaction buckets for chart rendering
CREATE OR REPLACE FUNCTION public.get_casino_profit_loss_timeseries(
  p_casino_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS TABLE(bucket date, daily_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_authorized boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.casinos WHERE id = p_casino_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.casino_members
    WHERE casino_id = p_casino_id AND user_id = auth.uid() AND role = 'admin'
  ) INTO v_authorized;

  IF NOT v_authorized THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')::date AS bucket,
    SUM(amount)::numeric AS daily_amount
  FROM public.transactions
  WHERE casino_id = p_casino_id
    AND game_type_id IS NOT NULL
    AND (p_from IS NULL OR created_at >= p_from)
    AND (p_to IS NULL OR created_at <= p_to)
  GROUP BY DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')::date
  ORDER BY bucket;
END;
$$;
