-- casino_members was never added to the supabase_realtime publication, so
-- postgres_changes subscriptions (e.g. useBalance) never fired on UPDATE,
-- requiring a manual page refresh to see balance changes like admin chip grants.
alter publication supabase_realtime add table public.casino_members;

-- Ensure UPDATE payloads include full old/new row data so client-side filters
-- (e.g. filter by casino_id) evaluate correctly.
alter table public.casino_members replica identity full;
