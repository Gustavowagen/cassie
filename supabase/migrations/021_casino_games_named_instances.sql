-- Restructure casino_games to support multiple named instances per game type per casino.
-- Replaces the (casino_id, game_type_id) composite PK with a uuid id PK.

-- 1. Add new columns
ALTER TABLE public.casino_games
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS custom_name text;

-- 2. Backfill existing rows
UPDATE public.casino_games
SET id = gen_random_uuid(), custom_name = game_type_id
WHERE custom_name IS NULL;

-- 3. Make NOT NULL
ALTER TABLE public.casino_games
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN custom_name SET NOT NULL;

-- 4. Replace primary key
ALTER TABLE public.casino_games DROP CONSTRAINT casino_games_pkey;
ALTER TABLE public.casino_games ADD PRIMARY KEY (id);

-- 5. Unique constraint: no duplicate names for same game type within a casino
ALTER TABLE public.casino_games
  ADD CONSTRAINT casino_games_unique_name
  UNIQUE (casino_id, game_type_id, custom_name);

-- 6. Update RLS: allow admins (not just owners) to manage games
DROP POLICY IF EXISTS "Only casino owner can manage games" ON public.casino_games;

CREATE POLICY "Casino owner or admin can manage games"
  ON public.casino_games FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.casinos WHERE id = casino_id AND owner_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.casino_members
      WHERE casino_id = casino_games.casino_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );
