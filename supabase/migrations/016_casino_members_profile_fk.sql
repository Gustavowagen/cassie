-- Swap the user_id FK to point at public.profiles so PostgREST can resolve the embed.
ALTER TABLE public.casino_members
  DROP CONSTRAINT casino_members_user_id_fkey;

ALTER TABLE public.casino_members
  ADD CONSTRAINT casino_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
