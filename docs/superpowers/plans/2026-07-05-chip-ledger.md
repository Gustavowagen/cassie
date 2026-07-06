# Chip Ledger ("Trades" Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Trades" tab (admin/owner view of every member's admin chip grants/removals) and a "My Chip History" section (regular members' own history) to each casino, filterable by a time range that defaults to the last 24 hours.

**Architecture:** A new nullable `admin_id` column on `transactions` plus a `security definer` RPC (`list_chip_transactions`) that returns all members' rows to an admin/owner or just the caller's own rows to a regular member — the DB enforces visibility, so one hook + one set of components serve both views. Two new frontend files (`ChipLedgerTable`, `ChipLedgerPanel`) keep `CasinoDashboard.tsx` from growing further; it already holds several inline tab components at 1132 lines.

**Tech Stack:** Vite + React + TypeScript, Supabase (Postgres RPC + `supabase-js`), Tailwind, existing `DateRangePicker` component.

**Spec:** `docs/superpowers/specs/2026-07-05-chip-ledger-design.md`

---

## Task 1: Database — `admin_id` column + `list_chip_transactions` RPC

**Files:**
- Create: `supabase/migrations/028_chip_ledger.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Track which admin performed a chip grant/removal, and expose a scoped
-- ledger RPC: admins/owner see every member's rows, everyone else sees
-- only their own.

alter table public.transactions
  add column admin_id uuid references auth.users(id);

-- Recreate give_chips (unchanged behavior) to also record the acting admin.
create or replace function public.give_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(14,2)
)
returns void language plpgsql security definer as $$
declare
  v_new_balance numeric(14,2);
  v_authorized boolean;
begin
  select exists (
    select 1 from public.casinos where id = p_casino_id and owner_id = auth.uid()
    union all
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'admin'
  ) into v_authorized;

  if not v_authorized then
    raise exception 'Only the casino creator or an admin can give chips';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  update public.casino_members
  set balance = balance + p_amount
  where casino_id = p_casino_id and user_id = p_target_user_id
  returning balance into v_new_balance;

  if not found then
    raise exception 'Member not found';
  end if;

  insert into public.transactions (casino_id, user_id, admin_id, amount, balance_after, description)
  values (p_casino_id, p_target_user_id, auth.uid(), p_amount, v_new_balance, 'Admin chip grant');
end;
$$;

-- Recreate remove_chips (unchanged behavior) to also record the acting admin.
create or replace function public.remove_chips(
  p_casino_id uuid,
  p_target_user_id uuid,
  p_amount numeric(14,2)
)
returns void language plpgsql security definer as $$
declare
  v_current_balance numeric(14,2);
  v_new_balance numeric(14,2);
  v_authorized boolean;
begin
  select exists (
    select 1 from public.casinos where id = p_casino_id and owner_id = auth.uid()
    union all
    select 1 from public.casino_members
    where casino_id = p_casino_id and user_id = auth.uid() and role = 'admin'
  ) into v_authorized;

  if not v_authorized then
    raise exception 'Only the casino creator or an admin can remove chips';
  end if;

  if p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select balance into v_current_balance
  from public.casino_members
  where casino_id = p_casino_id and user_id = p_target_user_id
  for update;

  if not found then
    raise exception 'Member not found';
  end if;

  v_new_balance := v_current_balance - p_amount;
  if v_new_balance < 0 then
    raise exception 'Cannot remove more chips than the member has';
  end if;

  update public.casino_members
  set balance = v_new_balance
  where casino_id = p_casino_id and user_id = p_target_user_id;

  insert into public.transactions (casino_id, user_id, admin_id, amount, balance_after, description)
  values (p_casino_id, p_target_user_id, auth.uid(), -p_amount, v_new_balance, 'Admin chip removal');
end;
$$;

-- Scoped ledger read: admins/owner get every member's grant/removal rows,
-- everyone else gets only their own.
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

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool against project `tvivhadsgtvfvxwpahef` with `name: "chip_ledger"` and the SQL above as `query`.

- [ ] **Step 3: Verify the column was added**

Use the Supabase MCP `execute_sql` tool against project `tvivhadsgtvfvxwpahef`:

```sql
select column_name from information_schema.columns
where table_name = 'transactions' and column_name = 'admin_id';
```

Expected: one row, `admin_id`.

- [ ] **Step 4: Smoke-test the RPC**

```sql
select * from public.list_chip_transactions(
  '00000000-0000-0000-0000-000000000000'::uuid,
  now() - interval '1 day',
  now()
);
```

Expected: runs without error, returns zero rows (no `auth.uid()` in this raw SQL context, so nothing matches `user_id = auth.uid()`, and `v_is_admin` is false).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/028_chip_ledger.sql
git commit -m "feat(db): add chip ledger RPC and admin_id tracking"
```

---

## Task 2: Frontend type — `ChipTransaction`

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the type**

Append to the end of `src/types/index.ts`:

```ts
export interface ChipTransaction {
  id: string;
  user_id: string;
  username: string | null;
  admin_id: string | null;
  admin_username: string | null;
  amount: number;
  balance_after: number;
  created_at: string;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add ChipTransaction type"
```

---

## Task 3: Hook — `listChipTransactions`

**Files:**
- Modify: `src/hooks/useCasino.ts`

- [ ] **Step 1: Update the type import**

Change line 2 from:
```ts
import type { Casino, CasinoMemberWithProfile } from "../types";
```
to:
```ts
import type { Casino, CasinoMemberWithProfile, ChipTransaction } from "../types";
```

- [ ] **Step 2: Add the function**

Add just before the `return { ... }` block at the end of `useCasino`:

```ts
  async function listChipTransactions(
    casinoId: string,
    from: Date,
    to: Date,
  ): Promise<ChipTransaction[]> {
    const { data, error } = await supabase.rpc("list_chip_transactions", {
      p_casino_id: casinoId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) throw error;
    return (data ?? []) as ChipTransaction[];
  }
```

- [ ] **Step 3: Add it to the returned object**

Add `listChipTransactions,` to the `return { ... }` object (alongside `getMemberProfitLoss`).

- [ ] **Step 4: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCasino.ts
git commit -m "feat(hooks): add listChipTransactions to useCasino"
```

---

## Task 4: `ChipLedgerTable` component

**Files:**
- Create: `src/components/ChipLedgerTable.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { ChipTransaction } from "../types";
import { formatChips } from "../lib/utils";

export function ChipLedgerTable({
  rows,
  showUserColumn,
  loading,
}: {
  rows: ChipTransaction[];
  showUserColumn: boolean;
  loading: boolean;
}) {
  if (loading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  if (rows.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        No chip grants or removals in this period.
      </p>
    );

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {showUserColumn && (
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Player</th>
            )}
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">By</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const given = r.amount >= 0;
            return (
              <tr key={r.id} className="border-b border-border last:border-0">
                {showUserColumn && (
                  <td className="px-4 py-3 font-medium">{r.username ?? "Unknown"}</td>
                )}
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                      given
                        ? "bg-green-500/15 text-green-600 dark:text-green-400"
                        : "bg-red-500/15 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {given ? "Given" : "Claimed"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatChips(Math.abs(r.amount))}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                  {r.admin_username ?? "—"}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ChipLedgerTable.tsx
git commit -m "feat(ui): add ChipLedgerTable component"
```

---

## Task 5: `ChipLedgerPanel` component (time filter + fetch)

**Files:**
- Create: `src/components/ChipLedgerPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import { DateRangePicker } from "./ui/datepicker";
import { ChipLedgerTable } from "./ChipLedgerTable";
import { useCasino } from "../hooks/useCasino";
import type { ChipTransaction } from "../types";

type LedgerPeriod = "today" | "7d" | "30d" | "all" | "custom";

const PERIODS: { id: LedgerPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function ChipLedgerPanel({
  casinoId,
  showUserColumn,
}: {
  casinoId: string;
  showUserColumn: boolean;
}) {
  const { listChipTransactions } = useCasino();
  const [period, setPeriod] = useState<LedgerPeriod>("today");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());
  const [rows, setRows] = useState<ChipTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let from: Date;
    let to = new Date();
    if (period === "today") from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    else if (period === "7d") from = new Date(Date.now() - 7 * 86_400_000);
    else if (period === "30d") from = new Date(Date.now() - 30 * 86_400_000);
    else if (period === "all") from = new Date(0);
    else {
      from = customFrom ? new Date(customFrom) : new Date(0);
      to = customTo ? new Date(customTo + "T23:59:59") : new Date();
    }

    setLoading(true);
    setError(null);
    listChipTransactions(casinoId, from, to)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [casinoId, period, customFrom, customTo]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {PERIODS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPeriod(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              period === id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {period === "custom" && (
        <DateRangePicker
          from={customFrom}
          to={customTo}
          onFromChange={setCustomFrom}
          onToChange={setCustomTo}
          maxTo={todayStr()}
        />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <ChipLedgerTable rows={rows} showUserColumn={showUserColumn} loading={loading} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ChipLedgerPanel.tsx
git commit -m "feat(ui): add ChipLedgerPanel with time-range presets"
```

---

## Task 6: Admin "Trades" tab in `CasinoDashboard`

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx`

- [ ] **Step 1: Add imports**

Change the icon import line (currently):
```ts
import { Copy, Check, Users, BarChart2, X, ChevronRight, Gamepad2, Settings, Trash2 } from "lucide-react";
```
to:
```ts
import { Copy, Check, Users, BarChart2, X, ChevronRight, Gamepad2, Settings, Trash2, ArrowLeftRight } from "lucide-react";
```

Add a new import after the `GameTile` import:
```ts
import { ChipLedgerPanel } from "../components/ChipLedgerPanel";
```

- [ ] **Step 2: Extend the `OwnerTab` union**

Change:
```ts
type OwnerTab = "games" | "members" | "stats" | "settings";
```
to:
```ts
type OwnerTab = "games" | "members" | "stats" | "trades" | "settings";
```

- [ ] **Step 3: Add the tab button**

In the tab bar array (inside `canManageMembers &&` block), change:
```ts
              [
                { id: "games", label: "Games", icon: Gamepad2 },
                { id: "members", label: "Members", icon: Users },
                { id: "stats", label: "Statistics", icon: BarChart2 },
                { id: "settings", label: "Settings", icon: Settings },
              ] as { id: OwnerTab; label: string; icon: React.ElementType }[]
```
to:
```ts
              [
                { id: "games", label: "Games", icon: Gamepad2 },
                { id: "members", label: "Members", icon: Users },
                { id: "stats", label: "Statistics", icon: BarChart2 },
                { id: "trades", label: "Trades", icon: ArrowLeftRight },
                { id: "settings", label: "Settings", icon: Settings },
              ] as { id: OwnerTab; label: string; icon: React.ElementType }[]
```

- [ ] **Step 4: Render the tab content**

After the `{activeTab === "stats" && <StatsTab casinoId={currentCasino.id} />}` line, add:
```tsx
          {activeTab === "trades" && (
            <ChipLedgerPanel casinoId={currentCasino.id} showUserColumn />
          )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "feat(casino): add admin Trades tab"
```

---

## Task 7: "My Chip History" section for regular members

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx`

- [ ] **Step 1: Add collapse state**

In `CasinoDashboard`, alongside the other `useState` declarations (near `selectedMember`), add:
```ts
  const [chipHistoryOpen, setChipHistoryOpen] = useState(true);
```

- [ ] **Step 2: Replace the regular-member render block**

Change:
```tsx
      {/* Game section — shown for regular members who don't have the tab bar */}
      {isMember && !canManageMembers && (
        <GameOverview
          casinoGames={casinoGames}
          onPlay={(instance) => setActiveGame(instance)}
          canAdmin={false}
        />
      )}
```
to:
```tsx
      {/* Game section — shown for regular members who don't have the tab bar */}
      {isMember && !canManageMembers && (
        <>
          <GameOverview
            casinoGames={casinoGames}
            onPlay={(instance) => setActiveGame(instance)}
            canAdmin={false}
          />
          <div className="rounded-xl border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setChipHistoryOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
            >
              My Chip History
              <ChevronRight
                className={`h-4 w-4 transition-transform ${chipHistoryOpen ? "rotate-90" : ""}`}
              />
            </button>
            {chipHistoryOpen && (
              <div className="px-4 pb-4">
                <ChipLedgerPanel casinoId={currentCasino.id} showUserColumn={false} />
              </div>
            )}
          </div>
        </>
      )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "feat(casino): add My Chip History section for regular members"
```

---

## Task 8: Manual verification (Playwright, test account)

No automated tests exist for hooks/components in this codebase (only Deno-based edge-function engine tests, and this feature adds no new pure game logic) — verification is manual, per the design spec's Testing section.

**Setup:**
- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background), confirm it serves on `http://localhost:5173`.

- [ ] **Step 2: Sign in as the test account**

Use Playwright to sign in with `claudetest.cassie@gmail.com` / `ClaudeTest123!` (admin in all casinos — see `CLAUDE.md`).

**Admin path:**
- [ ] **Step 3: Give and remove chips**

Navigate to any casino, open the Members tab, click a member (not the test account itself), give them e.g. 500 chips, then remove 200 chips via the existing popup controls.

- [ ] **Step 4: Verify the Trades tab**

Open the new **Trades** tab. Confirm:
- A "Given +500" row (green) and a "Claimed 200" row (red) appear for that member, each showing your test account under "By".
- Default period is **Today** and both rows are visible (they just happened).
- Switching to **All time** still shows them; switching to **Custom** and picking a range that excludes today hides them.

**Self-view path:**
- [ ] **Step 5: Temporarily demote the test account in one casino**

Use the Supabase MCP `execute_sql` tool (project `tvivhadsgtvfvxwpahef`) to find the test account's membership row in one casino and set its role to `'member'`:
```sql
update casino_members set role = 'member'
where user_id = (select id from auth.users where email = 'claudetest.cassie@gmail.com')
  and casino_id = '<pick one casino id from casinos table, not one the test account owns>';
```
(Skip any casino owned by the test account — the owner always sees the admin tabs regardless of `role`.)

- [ ] **Step 6: Verify the self-view**

Reload that casino's page. Confirm the tab bar is gone (regular member view) and a **"My Chip History"** section appears below the games grid, showing only chip grants/removals for that account (if any exist in that casino) or the empty state, with no "Player" column.

- [ ] **Step 7: Restore the test account's role**

```sql
update casino_members set role = 'admin'
where user_id = (select id from auth.users where email = 'claudetest.cassie@gmail.com')
  and casino_id = '<same casino id as step 5>';
```
Confirm the tab bar reappears on reload.

- [ ] **Step 8: Close the browser**

Close the Playwright browser session.
