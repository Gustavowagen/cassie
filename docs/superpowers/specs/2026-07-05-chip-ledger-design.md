# Chip Ledger ("Trades") — Design Spec

**Date:** 2026-07-05
**Status:** Approved (design)

## Goal

Add a "Trades" page/tab to each casino showing admin chip grants ("given")
and admin chip removals ("claimed") per user, with a time-range filter
defaulting to the last 24 hours. Admins/owner see every member's history;
regular members see only their own.

## Background

There is no peer-to-peer trading in this app today. The only cross-user chip
movement is admin action via the `give_chips` / `remove_chips` RPCs
(`013_give_chips.sql`, `027_remove_chips.sql`), each inserting one row into
`transactions` with `description = 'Admin chip grant'` or
`'Admin chip removal'` and `game_type_id IS NULL`. Neither RPC currently
records which admin performed the action.

## Scope

- New nullable `admin_id` column on `transactions`, populated going forward
  by `give_chips` / `remove_chips`.
- New RPC returning chip grant/removal rows, scoped by caller's role.
- New "Trades" tab in the admin tab bar (all members' history).
- New "My Chip History" panel for regular members (their own history only).
- Preset time filters (Today / 7d / 30d / All time / Custom), default
  **Today** (last rolling 24 hours).

Out of scope: any new form of chip transfer (peer-to-peer), editing/deleting
past transactions, exporting the ledger, backfilling `admin_id` for existing
historical rows (they will show as "—" / unknown admin).

## Database

### Migration `028_chip_ledger.sql`

```sql
alter table public.transactions
  add column admin_id uuid references auth.users(id);
```

Update `give_chips` and `remove_chips` (`CREATE OR REPLACE FUNCTION`) to
insert `admin_id = auth.uid()` alongside the existing columns. No other
behavior changes.

New RPC:

```sql
create or replace function public.list_chip_transactions(
  p_casino_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns table (
  id uuid,
  user_id uuid,
  username text,
  admin_id uuid,
  admin_username text,
  amount numeric(14,2),
  balance_after numeric(14,2),
  created_at timestamptz
) language plpgsql security definer as $$
declare
  v_is_admin boolean;
begin
  select exists (
    select 1 from public.casinos where id = p_casino_id and owner_id = auth.uid()
    union all
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'admin'
  ) into v_is_admin;

  return query
  select t.id, t.user_id, p.username, t.admin_id, pa.username,
         t.amount, t.balance_after, t.created_at
  from public.transactions t
  join public.profiles p on p.id = t.user_id
  left join public.profiles pa on pa.id = t.admin_id
  where t.casino_id = p_casino_id
    and t.description in ('Admin chip grant', 'Admin chip removal')
    and t.created_at >= p_from
    and t.created_at <= p_to
    and (v_is_admin or t.user_id = auth.uid())
  order by t.created_at desc;
end;
$$;
```

The DB — not the client — enforces visibility: admins/owner get every
member's rows, everyone else only gets their own. This lets the admin
ledger and the member self-view share one RPC and one client code path.
`amount` sign distinguishes given (positive) from claimed (negative); the
UI derives the "Given"/"Claimed" label and color from the sign rather than
re-parsing `description`.

## Frontend

### `src/hooks/useCasino.ts`

Add `listChipTransactions(casinoId: string, from: Date, to: Date)` calling
`list_chip_transactions`, following the existing throw-on-error pattern used
by `getMemberProfitLoss`.

### `src/types/index.ts`

```ts
export interface ChipTransaction {
  id: string;
  user_id: string;
  username: string;
  admin_id: string | null;
  admin_username: string | null;
  amount: number;
  balance_after: number;
  created_at: string;
}
```

### `ChipLedgerTable` component (new, `src/components/ChipLedgerTable.tsx`)

Flat, chronological table. Columns: **User** (omitted in self-view since
it's always the viewer), **Type** (Given/Claimed badge colored green/red
from `amount` sign), **Amount** (absolute value, formatted with
`formatChips`), **By** (admin_username, or "—" for pre-migration rows),
**Date** (localized timestamp). Empty state: "No chip grants or removals in
this period." Loading and error states match existing tabs (e.g.
`MembersTab`'s inline text).

### Time filter (shared, inline in the tab/panel — no new shared component)

Preset buttons `Today | 7d | 30d | All time | Custom`, mirroring
`MemberPopup`'s `StatPeriod` pattern; `Custom` reveals the existing
`DateRangePicker`. Default preset is **Today**, computed as
`[now - 24h, now]` (a rolling window, not calendar-day midnight) so "one
day" always means the most recent 24 hours regardless of when the page is
opened.

### Integration (`src/pages/CasinoDashboard.tsx`)

- Add `"trades"` to the `OwnerTab` union and to the admin tab bar (icon:
  `ArrowLeftRight` or similar from `lucide-react`), rendering a new
  `TradesTab` that calls `listChipTransactions(currentCasino.id, from, to)`
  with no `user_id` filter (server returns all members' rows for an admin).
- In the existing non-admin branch (`isMember && !canManageMembers`), add a
  collapsible **"My Chip History"** section below `GameOverview` rendering
  the same `ChipLedgerTable` (User column omitted), fetched via the same
  hook — the RPC naturally scopes it to the caller's own rows.

## New / changed files

**New**
- `supabase/migrations/028_chip_ledger.sql`
- `src/components/ChipLedgerTable.tsx`

**Changed**
- `src/hooks/useCasino.ts` — add `listChipTransactions`.
- `src/types/index.ts` — add `ChipTransaction`.
- `src/pages/CasinoDashboard.tsx` — new `"trades"` tab (`TradesTab`) for
  admins, new "My Chip History" section for regular members.

## Testing

- **Manual/integration** (test account, Playwright): as admin, give and
  remove chips from a member via the existing Member popup, then confirm
  both actions appear in the Trades tab with correct sign/label/admin/time;
  confirm the "Today" default excludes an action older than 24h and that
  switching to "All time"/Custom brings it back; confirm a regular member
  only sees their own rows in "My Chip History" and cannot see other
  members' via the RPC (e.g. by calling it directly with another user's
  casino membership).
- No engine/pure-function logic here worth unit testing — the RPC is the
  single source of truth for filtering/authorization, verified manually
  against Postgres directly if needed.

## Security notes

- Visibility (self vs. all-members) is enforced inside
  `list_chip_transactions` via `security definer` + an explicit role check,
  not via client-side filtering — a non-admin cannot get other members' rows
  by calling the RPC directly with a different implicit `auth.uid()`.
- `admin_id` is nullable and never backfilled for historical rows; the UI
  must handle `admin_username === null` gracefully rather than assuming it's
  always present.
