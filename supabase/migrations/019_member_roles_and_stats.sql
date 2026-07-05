-- 1. Add 'admin' to the role check constraint (keep 'owner' for constraint safety during migration)
ALTER TABLE public.casino_members DROP CONSTRAINT IF EXISTS casino_members_role_check;
ALTER TABLE public.casino_members ADD CONSTRAINT casino_members_role_check
  CHECK (role = ANY (ARRAY['member'::text, 'admin'::text, 'owner'::text]));

-- 2. Update auto_join_owner to use 'member' role — creator identity is tracked via casinos.owner_id
CREATE OR REPLACE FUNCTION public.auto_join_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.casino_members (casino_id, user_id, balance, role)
  VALUES (
    NEW.id,
    NEW.owner_id,
    COALESCE((NEW.settings->>'startingBalance')::numeric(14,2), 0),
    'member'
  )
  ON CONFLICT (casino_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. Migrate existing 'owner' role rows to 'member' (creator is now derived from casinos.owner_id)
UPDATE public.casino_members SET role = 'member' WHERE role = 'owner';

-- 4. Now tighten the constraint to only allow member and admin
ALTER TABLE public.casino_members DROP CONSTRAINT IF EXISTS casino_members_role_check;
ALTER TABLE public.casino_members ADD CONSTRAINT casino_members_role_check
  CHECK (role = ANY (ARRAY['member'::text, 'admin'::text]));

-- 5. Add last_played_at column
ALTER TABLE public.casino_members ADD COLUMN IF NOT EXISTS last_played_at timestamptz;

-- 6. Backfill last_played_at from existing game transactions
UPDATE public.casino_members cm
SET last_played_at = (
  SELECT MAX(created_at)
  FROM public.transactions t
  WHERE t.casino_id = cm.casino_id
    AND t.user_id = cm.user_id
    AND t.game_type_id IS NOT NULL
);

-- 7. Trigger function to update last_played_at when a game transaction is inserted
CREATE OR REPLACE FUNCTION public.update_member_last_played()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.game_type_id IS NOT NULL THEN
    UPDATE public.casino_members
    SET last_played_at = NEW.created_at
    WHERE casino_id = NEW.casino_id AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_member_last_played ON public.transactions;
CREATE TRIGGER trg_update_member_last_played
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_member_last_played();

-- 8. RPC: Set member role (casino creator only, member <-> admin)
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_new_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (SELECT owner_id FROM public.casinos WHERE id = p_casino_id) IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the casino creator can change member roles';
  END IF;
  IF p_new_role NOT IN ('member', 'admin') THEN
    RAISE EXCEPTION 'Role must be member or admin';
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;
  UPDATE public.casino_members
  SET role = p_new_role
  WHERE casino_id = p_casino_id AND user_id = p_target_user_id;
END;
$$;

-- 9. RPC: Get net profit/loss for a member from game transactions (creator or admin only)
CREATE OR REPLACE FUNCTION public.get_member_profit_loss(
  p_casino_id uuid,
  p_user_id uuid
) RETURNS numeric(14,2)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_authorized boolean;
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
  WHERE casino_id = p_casino_id
    AND user_id = p_user_id
    AND game_type_id IS NOT NULL;

  RETURN v_profit_loss;
END;
$$;

-- 10. RPC: Leave casino — transfers ownership to earliest non-creator member if creator leaves
CREATE OR REPLACE FUNCTION public.leave_casino(p_casino_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_owner_id uuid;
BEGIN
  IF (SELECT owner_id FROM public.casinos WHERE id = p_casino_id) = auth.uid() THEN
    SELECT user_id INTO v_next_owner_id
    FROM public.casino_members
    WHERE casino_id = p_casino_id AND user_id != auth.uid()
    ORDER BY joined_at ASC
    LIMIT 1;

    IF v_next_owner_id IS NOT NULL THEN
      UPDATE public.casinos SET owner_id = v_next_owner_id WHERE id = p_casino_id;
    END IF;
  END IF;

  DELETE FROM public.casino_members
  WHERE casino_id = p_casino_id AND user_id = auth.uid();
END;
$$;

-- 11. Update give_chips to allow admins to give chips (not just the creator)
CREATE OR REPLACE FUNCTION public.give_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(14,2)
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
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
    RAISE EXCEPTION 'Only the casino creator or an admin can give chips';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  UPDATE public.casino_members
  SET balance = balance + p_amount
  WHERE casino_id = p_casino_id AND user_id = p_target_user_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  INSERT INTO public.transactions (casino_id, user_id, amount, balance_after, description)
  VALUES (p_casino_id, p_target_user_id, p_amount, v_new_balance, 'Admin chip grant');
END;
$$;
