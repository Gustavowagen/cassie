# Agent Role & Downline Assignment — Design

## Summary

Add a third `casino_members.role` value, `'agent'`, alongside the existing `'member'` and `'admin'`. An agent gets read-only, scope-limited access to the Members, Stats, and Trades tabs — limited to a "downline" of regular members an owner/admin has explicitly assigned to them via a new "Assign agent" action on the member profile popup.

## Goals

- New `agent` role, settable the same way `admin` is today (owner-only, via the existing role-toggle buttons).
- Owner/admin can assign any non-agent member to report to one agent, from that member's profile popup ("Assign agent" → picker of available agents in the casino).
- An agent sees Members / Stats / Trades tabs, but strictly scoped to their assigned downline — enforced server-side, not just hidden in the UI.
- Agents cannot perform admin actions (no role changes, no give/remove chips, no assigning agents) — view-only.

## Non-goals

- Nested/multi-level agent hierarchies (agents cannot be placed under other agents).
- Multiple agents per member (one agent per member, or none).
- Any change to an assigned member's own gameplay, permissions, or balance handling — the assignment is a visibility link only.
- Commission tracking, payouts to agents, or any other agent-specific business logic beyond visibility scoping.

## Data model

Migration `supabase/migrations/043_agent_role.sql`:

- Widen `casino_members_role_check` from `('member', 'admin')` to `('member', 'admin', 'agent')`.
- Add `casino_members.agent_id uuid null references auth.users(id) on delete set null` — the user_id of the agent this member reports to, or `null` if unassigned. Indexed on `(casino_id, agent_id)`.

An agent's own `agent_id` is always `null` (agents are exempt from being placed under anyone — enforced in both `set_member_role` and `assign_member_agent`, see below).

## Backend

### New shared helpers

Several existing RPCs hand-duplicate an "owner OR role='admin'" authorization check. Since this work touches most of them anyway, consolidate into:

- `is_casino_owner_or_admin(p_casino_id uuid) returns boolean` — the existing check, centralized.
- `is_casino_agent(p_casino_id uuid) returns boolean` — caller's role is `'agent'` in that casino.

### Modified RPCs

- **`set_member_role(p_casino_id, p_target_user_id, p_new_role)`** — allow `'agent'` as a valid `p_new_role` (still owner-only, unchanged permission). Side effects:
  - Promoting a member to `'agent'`: clear their own `agent_id` (they can no longer be someone's downline).
  - Demoting a member away from `'agent'`: clear `agent_id` for every row that pointed at them (their former downline becomes unassigned, not dangling).

- **`get_member_profit_loss`, `get_casino_stats`, `get_casino_profit_loss_timeseries`** — extend authorization to accept agents, but scope the underlying `transactions` query to `user_id IN (SELECT user_id FROM casino_members WHERE casino_id = p_casino_id AND agent_id = auth.uid())` when the caller is an agent (not owner/admin, who keep seeing everything).

- **`list_chip_transactions`** — same scoping: agents see ledger rows for their downline's `user_id`s, in addition to the existing owner/admin-sees-all / everyone-else-sees-own-rows behavior.

### New RPCs

- **`assign_member_agent(p_casino_id uuid, p_target_user_id uuid, p_agent_user_id uuid)`** (nullable `p_agent_user_id` to unassign) — caller must be owner or admin. Validates:
  - Target member exists in the casino.
  - Target member's own role is not `'agent'` (an agent cannot be placed under another agent).
  - If `p_agent_user_id` is non-null, it must belong to a `casino_members` row in the same casino with `role = 'agent'`.
  - Sets `agent_id` on the target's row.

- **`get_casino_members(p_casino_id uuid)`** — returns members joined with profile info, replacing the frontend's current raw `select * from casino_members` (which today relies on an RLS policy letting any casino member read every other member's row, including balances — the admin-only restriction is currently UI-only). New behavior:
  - Owner/admin: every member.
  - Agent: only members where `agent_id = auth.uid()`.
  - Anyone else: empty.

  This is the one change in this design that turns "restricted to downline" from a UI convention into a real server-side guarantee.

## Frontend

All changes are within `src/pages/CasinoDashboard.tsx` (Members/Stats/Trades tabs, role display, and the member popup all live there today — no new files needed) plus `src/hooks/useCasino.ts` (RPC wrappers) and `src/types/index.ts` (role union type).

- **Role display**: `displayRole()` / `roleBadgeClass()` add an `'agent'` branch with a distinct badge color.
- **Granting the role**: the existing owner-only role-toggle buttons in `MemberPopup` gain a third "Agent" option, wired to the same `set_member_role` call.
- **Assign agent flow**: for owner/admin viewing a member who is not themselves an agent and not the casino creator, `MemberPopup` shows an "Assign agent" button. Clicking it swaps the popup body for a picker listing every member with role `'agent'` in the casino (filtered client-side from the already-loaded member list — no extra fetch) plus an "Unassign" option. Selecting one calls `assign_member_agent` and returns to the normal popup view. If the member already has an agent, the popup shows "Reports to: `<agent name>`" with a quick unassign action.
- **Tab access**: add `isAgent = membership?.role === 'agent'` next to the existing `isOwner`/`isAdmin`/`canManageMembers`. Agents get access to Members, Stats, and Trades tabs (not Settings/Games), using the *same* tab components as owner/admin — the scoping is entirely server-side now:
  - **Members tab**: switches its fetch from the raw table `select` to `get_casino_members`. For an agent, `MemberPopup` renders read-only (no role buttons, no give/remove chips, no "Assign agent" button) — profile, balance, joined/last-played, and their profit/loss only. Empty downline shows a plain empty state.
  - **Stats tab**: no UI changes — same RPC calls, now scoped server-side per caller.
  - **Trades tab**: `showUserColumn` becomes `canManageMembers || isAgent` so agents see the Player column; `list_chip_transactions` already returns only downline rows for them.

## Testing

- Migration applies cleanly; existing member/admin flows unaffected (regression: give/remove chips, role toggle, stats, ledger still work for owner/admin/member).
- New agent role: promote a member to agent, verify `agent_id` cleared on promotion.
- Assign a member to an agent; verify agent sees them in Members/Stats/Trades, and that another agent (or a plain member) does not.
- Attempt to assign an agent as someone's downline agent target → rejected.
- Demote an agent back to member; verify their former downline's `agent_id` is cleared.
- Verify agent's Members tab popup has no admin action buttons.
