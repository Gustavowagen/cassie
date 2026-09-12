# Daily Spin — Design Spec

Turns the lobby's inert "Daily spin" promo card (`src/components/lobby/PromoCards.tsx`) into a real, server-authoritative feature, and gives a casino owner full control of it under a new **Special Features** category in casino settings.

## Summary

Once per cooldown window (default 24h) a member may spin a prize wheel for free chips. The wheel's slices are defined entirely by the casino owner: each slice carries a label, a chip amount, a weight (its odds) and a colour. A slice paying **0 chips is "Nothing"** and is a first-class, expected outcome — the shipped default wheel lands on Nothing about a third of the time.

Nothing is bet, so there is no house edge to reason about. The design constraint is the opposite one: the wheel must be a nudge, not an income. The shipped default averages ~420 chips per spin against a 10,000 default starting balance (~4%/day), and the settings editor shows the owner a live average-payout readout so they can see when they have made theirs overpowered.

Scope decision: prizes are **chips or nothing, only**. No temporary multiplier buffs (would require every game engine to read and consume a live per-member effect) and no free-spin credits on Tumble/Olympus (would require a credit ledger and a redemption path in those games). Both were considered and cut.

## 1. Config Shape

The config lives in the existing `casinos.settings` jsonb under a new `specialFeatures` key, so it needs no migration of its own and no new table. `specialFeatures` is a namespace, not a one-off — it is where the next owner-configurable non-game feature will go.

```ts
// src/types/index.ts
export interface DailySpinSegment {
  id: string;      // stable key across reorder/edit; not meaningful to the server
  label: string;   // "Jackpot", "Nothing", "Pocket change"
  amount: number;  // chips awarded; 0 means Nothing
  weight: number;  // relative odds within this wheel; not a percentage
  color: string;   // "#rrggbb", the slice fill
}

export interface DailySpinSettings {
  enabled: boolean;
  title: string;            // promo card title
  subtitle: string;         // promo card one-liner
  cooldownHours: number;    // hours between spins
  segments: DailySpinSegment[];
}

export interface SpecialFeaturesSettings {
  dailySpin?: DailySpinSettings;
}

export interface CasinoSettings {
  startingBalance: number;
  allowPublicJoin: boolean;
  maxMembers: number;
  specialFeatures?: SpecialFeaturesSettings;   // added
}
```

`specialFeatures` is optional: every casino created before this ships has no such key, and must behave as a casino with the feature **off**. See `resolveDailySpin` below — a missing config resolves to the default wheel with `enabled: false`, so nothing appears in any existing lobby until an owner turns it on.

### Validation (authoritative in `resolveDailySpin`)

Nothing written by the settings UI is trusted. The server re-resolves the stored config on every claim, and the settings UI calls the same function to render its preview, so the preview cannot promise odds the server won't roll.

| Field | Rule | On violation |
|---|---|---|
| `enabled` | boolean | non-boolean → `false` |
| `title` | trimmed, 1–32 chars | empty/too long → default / truncated |
| `subtitle` | trimmed, 0–60 chars | too long → truncated |
| `cooldownHours` | integer 1–168 | out of range → clamped; non-numeric → 24 |
| `segments` | 3–12 entries surviving per-segment validation | fewer than 3 survive → the whole default wheel |
| `segment.label` | trimmed, 1–24 chars | empty → derived from amount (`"Nothing"` / `"500 chips"`) |
| `segment.amount` | `roundMoney`, 0 ≤ amount ≤ 10,000,000 | non-finite/negative → 0; above ceiling → clamped |
| `segment.weight` | integer 1–1000 | out of range → clamped; non-numeric → 1 |
| `segment.color` | `/^#[0-9a-f]{6}$/i` | invalid → palette colour for that index |
| `segment.id` | non-empty string | missing → index-derived |

Weight has a **floor of 1, not 0**: a zero-weight slice would be visible on the wheel and never winnable, which reads as a bug to a player.

## 2. The Default Wheel

Shipped as `DEFAULT_DAILY_SPIN` in the engine and used verbatim for any casino that has never configured one.

| Label | Chips | Weight | Odds |
|---|---:|---:|---:|
| Nothing | 0 | 18 | 18.4% |
| Pocket change | 100 | 22 | 22.4% |
| Small stack | 250 | 18 | 18.4% |
| Nothing | 0 | 14 | 14.3% |
| Lucky handful | 500 | 13 | 13.3% |
| Big stack | 1,000 | 8 | 8.2% |
| High roller | 2,500 | 4 | 4.1% |
| Jackpot | 10,000 | 1 | 1.0% |

Total weight 98. Expected value `41,200 / 98 ≈ 420.4` chips per spin. Probability of Nothing `32 / 98 ≈ 32.7%`.

The two Nothing slices are deliberate and sit on opposite arcs of the wheel, so a near-miss on the Jackpot is visually adjacent to a blank. `enabled` defaults to **false** — an owner opts in.

## 3. Data Model

Migration `supabase/migrations/051_daily_spin.sql`.

No new table. The only state a cooldown needs is the last claim time, and per-claim history is already recorded as a `transactions` row:

```sql
alter table public.casino_members
  add column last_daily_spin_at timestamptz;
```

Existing rows get `null`, which reads as "never spun" — correct, and no backfill needed.

### The claim RPC

The prize is chosen in TypeScript (see §4) but the money must move atomically, so the edge function hands the already-chosen amount to a small plpgsql function that knows nothing about wheels:

```sql
create or replace function public.claim_daily_spin(
  p_casino_id uuid,
  p_user_id uuid,
  p_amount numeric(16,4),
  p_cooldown_hours int,
  p_description text
)
returns numeric(16,4)
language plpgsql security definer as $$
declare
  v_balance numeric(16,4);
begin
  -- Locks the row, so two concurrent claims cannot both pass the cooldown
  -- check, and so the balance increment cannot clobber a game payout landing
  -- at the same instant.
  update public.casino_members
     set balance = balance + p_amount,
         last_daily_spin_at = now()
   where casino_id = p_casino_id
     and user_id = p_user_id
     and (last_daily_spin_at is null
          or last_daily_spin_at <= now() - make_interval(hours => p_cooldown_hours))
  returning balance into v_balance;

  -- No row matched: either still cooling down, or not a member. The caller
  -- cannot tell these apart from a null, and does not need to — it has
  -- already proven membership before getting here, so a null means the
  -- cooldown guard rejected the claim.
  if not found then
    return null;
  end if;

  insert into public.transactions
    (casino_id, user_id, amount, balance_after, game_type_id, description)
  values
    (p_casino_id, p_user_id, p_amount, v_balance, null, p_description);

  return v_balance;
end;
$$;

-- Only the edge function (service-role key) may call this. Without the
-- revoke, any client holding the anon key could award itself any amount.
revoke execute on function public.claim_daily_spin(uuid, uuid, numeric, int, text)
  from anon, authenticated;
```

Two details worth stating explicitly:

- **`balance = balance + p_amount`, not a value computed in the edge function.** Every game function in this codebase reads a balance and writes back a number derived from it, which is safe there because a player has one round in flight at a time. A daily spin can land while a game round is resolving, so the increment is done in SQL against the current row.
- **`game_type_id` is `null`.** The stats RPCs (`019_member_roles_and_stats.sql:40` and friends) all filter `game_type_id IS NOT NULL`, so a daily spin stays out of per-game profit/loss — it is a chip grant, like `give_chips`, not a wager.

## 4. Engine & Edge Function

`supabase/functions/daily-spin/engine.ts` is free of Deno and Supabase imports, exactly like `supabase/functions/olympus/engine.ts`, and is re-exported by `src/lib/dailySpin.ts` (a one-line `export *`, following `src/lib/olympusEngine.ts`). The settings preview, the lobby card and the server therefore run the same code; the preview cannot drift from reality.

```ts
export const DEFAULT_DAILY_SPIN: DailySpinSettings;
export const SEGMENT_PALETTE: string[];          // fallback slice colours
export const MIN_SEGMENTS = 3, MAX_SEGMENTS = 12;

/** Sanitizes anything into a valid config. Never throws. */
export function resolveDailySpin(raw: unknown): DailySpinSettings;

/** Weighted pick. Returns the winning index. */
export function pickSegment(config: DailySpinSettings, rng: () => number): number;

/** Mean chips per spin — the settings editor's OP-check. */
export function expectedValue(config: DailySpinSettings): number;

/** Odds of landing a 0-chip slice, 0–1. */
export function nothingChance(config: DailySpinSettings): number;

/** When the next spin unlocks, or null if one is available now. */
export function nextSpinAt(lastSpinAt: string | null, cooldownHours: number): Date | null;
```

`pickSegment` walks the cumulative weights and returns the first index whose running total exceeds `rng() * totalWeight`, clamping to the last index so a `rng()` of exactly 1 can't fall off the end.

### `supabase/functions/daily-spin/index.ts`

Follows `supabase/functions/dice/index.ts` throughout: same CORS block, same `json()` helper, same crypto `rng`, same user-client-for-reads / admin-client-for-writes split.

`POST { casino_id }` →

1. Reject unauthenticated (401).
2. Read the membership row (`last_daily_spin_at`) with the **user** client — RLS proves membership — and the casino's `settings` with the admin client, in one `Promise.all`. No membership → 403.
3. `resolveDailySpin(settings?.specialFeatures?.dailySpin)`. Not `enabled` → 400 `"Daily spin is not available in this casino"`.
4. Cooldown check against `nextSpinAt(...)` → 429 `{ error, nextSpinAt }`. This is a fast-path reject only; the RPC re-checks authoritatively.
5. `pickSegment(config, rng)` → the winning segment.
6. `claim_daily_spin(...)` with `description = "Daily spin: ${label}"`. A `null` return means the fast path raced and lost → 429.
7. Respond:

```ts
{
  segmentIndex: number,     // which slice the wheel must stop on
  label: string,
  amount: number,
  balance: number,          // authoritative, post-credit
  nextSpinAt: string        // ISO
}
```

The client is told the index, not asked to derive it — the wheel animates to whatever the server picked.

### Tests — `supabase/functions/daily-spin/engine.test.ts` (vitest, `npm test`)

- `resolveDailySpin`: undefined/null/garbage → default wheel, disabled; each clamp rule in §1's table; a 2-segment list falls back to the full default; a 20-segment list truncates to 12.
- `pickSegment`: a seeded sequential rng hits each slice at its boundary; `rng = () => 0` → index 0; `rng = () => 0.999…` → last index; a 100k-draw distribution sits within tolerance of the configured weights.
- `expectedValue` / `nothingChance`: exact values for the default wheel (420.408…, 0.3265…); an all-zero wheel is 0 EV and 100% nothing.
- `nextSpinAt`: null last-spin → null (available); an hour into a 24h cooldown → 23h out; exactly at the boundary → available.

## 5. Client

### `src/hooks/useDailySpin.ts`

Owns the feature's client state for one casino: the resolved config, the member's `last_daily_spin_at`, a derived `nextSpinAt`, a ticking `readyIn` countdown, and `spin()` which invokes the edge function. Returns `{ config, available, nextSpinAt, spinning, spin, error }`. The countdown re-renders on a 1s interval only while a cooldown is actually pending.

### `src/components/lobby/PromoCards.tsx`

Takes a `casino` prop (already available in `GamesLobby`, which renders it at line 95).

- Feature disabled → **the Daily spin card is not rendered at all.** Daily bonus and Leaderboard remain the inert placeholders they are today; this spec does not touch them.
- Enabled and available → title/subtitle from config, button reads `Spin now`, opens the wheel modal.
- Enabled, cooling down → button reads `Ready in 7h 12m`, disabled.

### `src/components/DailySpinWheel.tsx`

Rendered inside the existing `<Modal>`. An SVG wheel of `segments.length` slices, each filled with its colour and labelled, under a fixed pointer.

Reveal behaviour follows the CLAUDE.md rule for outcome-decided-then-animated games (Dice's slide, Roulette's wheel):

- The server decides before the animation starts, but **nothing about the result is shown until the wheel physically lands.** No balance change, no label, no toast mid-spin.
- Spin is a CSS `transform: rotate()` transition of ~4s ease-out through at least 5 full turns, landing with `segmentIndex`'s slice under the pointer, plus a small random jitter within the slice so it doesn't stop dead-centre every time.
- The authoritative `balance` from the response is applied **on the transition's `transitionend`**, not on the response — the header balance must not spoil the landing.
- There is no bet, so there is no optimistic deduction to make or roll back. A failed request simply surfaces the error and leaves the wheel untouched.
- **Prize slice** → payout pop-in plus a particle burst, following `src/components/games/Mines.tsx`.
- **Nothing slice** → per CLAUDE.md's loss rule, no banner, no modal, no loss text. The labelled slice sitting under the pointer is the entire feedback; the modal settles back to its neutral state showing the new countdown.

Sizing follows the fill rule: the wheel diameter is a `clamp(minPx, Nvw, maxPx)` so it grows with the viewport instead of sitting small in a large modal, checked at ~375px and ~1920px.

### `src/components/settings/SpecialFeaturesPanel.tsx`

A **new file**, not another section of `src/pages/CasinoDashboard.tsx` — that file is already 1,747 lines and its `SettingsTab` (line 610) is the largest thing in it. `CasinoDashboard.tsx` gains only a third menu card ("Special Features", `Sparkles` icon, alongside Games and Club Appearance) and a `view === "special"` branch that renders this component.

The panel edits a local draft and saves the whole `settings` jsonb back to `casinos` in one update, mirroring how `handleSaveDetails` (line 677) already saves description/theme/rules.

- Master **enabled** toggle. Off greys out the rest of the panel but keeps it editable.
- **Title** and **subtitle** text inputs, with the character limits from §1 enforced in the input.
- **Cooldown** in hours, 1–168.
- **Segment editor**: a row per slice — colour swatch, label, chip amount, weight — plus delete. "+ Add segment" up to 12; delete disabled at 3. Each row shows its own computed odds (`weight / totalWeight`) so the owner can see what a weight actually means.
- **Live preview**: the real `DailySpinWheel` in a non-interactive mode, rendered from the draft config, beside a readout — **"Average 420 chips per spin · 33% nothing"** — recomputed from `expectedValue` / `nothingChance` on every keystroke. This is the OP-check, and the reason those functions live in the shared engine rather than the edge function alone.
- A "Reset to default wheel" action.

Owner-only, gated by the same `canManageMembers` check that already gates the Settings tab.

## 6. Error Handling

| Case | Behaviour |
|---|---|
| Not authenticated | 401; the lobby is behind `AuthGuard`, so this is defence in depth |
| Not a member | 403; card isn't rendered for non-members anyway |
| Feature disabled | 400; possible if an owner disables it while a player has the modal open — the modal shows the message and closes |
| Still cooling down | 429 with `nextSpinAt`; the client snaps its countdown to the server's answer, which resolves any client clock skew |
| Concurrent double-claim | The RPC's conditional update wins; the loser gets 429 and pays out nothing |
| Network failure mid-spin | Wheel does not start; error surfaces in the modal; no state changed |
| Config is garbage in the DB | `resolveDailySpin` falls back rather than throwing — a malformed jsonb can never take the lobby down |

## 7. Out of Scope

- Daily bonus and Leaderboard promo cards stay inert.
- No streak bonuses, no "spin again" slices, no multi-spin days.
- No admin-facing history of who won what beyond the existing `transactions` ledger (which has 30-day retention per `038_transactions_30d_retention.sql`).
- No push/email notification when a spin becomes available.
