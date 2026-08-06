-- Reorder the downline index so it also covers the agent_id FK lookup
-- (leading column agent_id), addressing the unindexed-foreign-key advisor
-- warning on casino_members_agent_id_fkey. Column order doesn't matter for
-- the RPCs' two-predicate equality lookups (casino_id = ... and agent_id = ...).
drop index if exists public.casino_members_agent_id_idx;
create index if not exists casino_members_agent_id_idx on public.casino_members (agent_id, casino_id);
