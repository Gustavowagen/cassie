-- Add optional per-game filtering to the casino stats RPCs so admins can view
-- profit/loss for a single game type, not just the casino-wide total.

DROP FUNCTION IF EXISTS public.get_casino_stats(uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.get_casino_stats(
  p_casino_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_game_type_id text DEFAULT NULL
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
    AND (p_to IS NULL OR created_at <= p_to)
    AND (p_game_type_id IS NULL OR game_type_id = p_game_type_id);

  RETURN jsonb_build_object('player_profit_loss', v_player_pl);
END;
$$;

DROP FUNCTION IF EXISTS public.get_casino_profit_loss_timeseries(uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.get_casino_profit_loss_timeseries(
  p_casino_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_game_type_id text DEFAULT NULL
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
    AND (p_game_type_id IS NULL OR game_type_id = p_game_type_id)
  GROUP BY DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')::date
  ORDER BY bucket;
END;
$$;
