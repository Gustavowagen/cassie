# Dice — Design Spec

**Date:** 2026-07-05
**Status:** Approved (design)

## Goal

Add Dice as a third playable game on OnlineCassie, styled after Stake's classic
dice game (roll-under/over a threshold on a 0–100 slider). Server-authoritative
like Blackjack, so the roll and payout can't be manipulated client-side. House
edge: **2%**.

## Scope

- Manual betting only: pick a bet amount, threshold, and direction; roll.
- Slider UI with linked Multiplier / Roll Over-Under / Win Chance fields,
  matching `stake-dice.png`.
- Single-request resolution — no multi-step round state (unlike Blackjack).

Out of scope: Auto-bet mode (strategy runner), roll history strip, provably-fair
seed verification UI.

## Game math

- Roll a value `r` in `[0, 100)` with 2-decimal precision, generated
  server-side via `crypto.getRandomValues`.
- Player chooses `target` (a threshold in `[0, 100]`) and `direction`
  (`"under"` | `"over"`).
- **Win chance**: `direction === "under" ? target : 100 - target`.
- **Multiplier**: `(100 * (1 - HOUSE_EDGE)) / winChance`, `HOUSE_EDGE = 0.02`.
- **Outcome**: `direction === "under" ? r < target : r > target`.
- **Payout on win**: `bet * multiplier` (chips returned, stake included).
  Net change to balance is `payout - bet` on a win, `-bet` on a loss.
- **Win chance is clamped to `[1, 95]`** to avoid near-zero-chance jackpot
  multipliers and near-certain trivial-payout bets. This bounds `target` to
  `[1, 95]` for `"under"` and `[5, 99]` for `"over"`. The edge function
  rejects any request whose resulting win chance falls outside this range
  (the frontend slider is clamped to match, so this should only ever trigger
  via a malformed/direct API call).

## Backend

New Edge Function `supabase/functions/dice/`, following the Blackjack layout
but simpler — a roll resolves fully in one request, so there is no persisted
round table.

1. **`engine.ts`** — pure functions, zero I/O, fully unit-tested:
   - `rollValue(rng: () => number): number` — 2-decimal roll in `[0, 100)`.
   - `winChanceFor(target: number, direction: Direction): number`
   - `multiplierFor(winChance: number): number`
   - `isWin(roll: number, target: number, direction: Direction): boolean`
   - `MIN_WIN_CHANCE = 1`, `MAX_WIN_CHANCE = 95`, `HOUSE_EDGE = 0.02` constants.

2. **`index.ts`** — single action, `POST { casino_id, bet, target, direction }`:
   - Verifies JWT → `auth.uid()`.
   - Fetches member balance + `game_types` bounds for `"dice"` (existing row:
     min 100, max 50000) in parallel, same pattern as Blackjack's `start`.
   - Validates: bet is a finite positive number within game_types min/max and
     ≤ balance; `direction` is `"under"`/`"over"`; resulting win chance is
     within `[MIN_WIN_CHANCE, MAX_WIN_CHANCE]`.
   - Rolls via `crypto.getRandomValues`-backed `rng`, computes outcome/payout.
   - Updates `casino_members.balance` and inserts **one** `transactions` row
     with the net amount and a description like
     `"Dice: rolled 42.17, needed under 50.00"`.
   - Returns `{ roll, target, direction, winChance, multiplier, won, payout, balance }`.

   No `verify_jwt`-exempt paths, no persisted state table — mirrors Blackjack's
   auth/validation approach but is a single round-trip.

## Frontend

### `src/types/index.ts`
```ts
export type DiceDirection = "under" | "over";
export interface DiceResult {
  roll: number;
  target: number;
  direction: DiceDirection;
  winChance: number;
  multiplier: number;
  won: boolean;
  payout: number;
  balance: number;
}
```

### `src/hooks/useDice.ts`
Same shape as `useBlackjack.ts`: wraps `supabase.functions.invoke("dice", ...)`,
tracks `loading` / `error` / last `DiceResult`, surfaces the parsed `{ error }`
body on non-2xx responses.

### `src/components/games/Dice.tsx`
Two-panel layout inside the existing game modal (`Modal` size `xl`, same as
Roulette), dark theme consistent with the rest of the app (not Blackjack's felt
theme — no card-table motif fits here):

- **Left panel** — bet controls:
  - Numeric bet amount input with `½` and `2×` quick-adjust buttons.
  - Read-only "Profit on win" field (`bet * (multiplier - 1)`).
  - Bet button (disabled while a request is in flight or bet is invalid).
- **Right panel** — the slider:
  - Horizontal track colored red (lose zone) / green (win zone), split at
    `target`; a draggable handle sets `target` (mouse + touch).
  - Three linked, independently editable fields below: **Multiplier**,
    **Roll Over/Under** (numeric target, with a swap icon toggling
    `direction`), **Win Chance**. Editing any one recalculates the other two
    and the slider handle position, all clamped to the win-chance bounds.
  - After a roll: a marker animates to the landed roll position over ~400ms,
    then a result banner shows Won/Lost + payout, matching Roulette's result
    banner treatment.
- Local balance state seeded from the `balance` prop and updated from each
  `DiceResult.balance`, same pattern as `Roulette.tsx`.

### Integration (`src/pages/CasinoDashboard.tsx`)
- Add `"dice"` to `PLAYABLE_GAME_IDS`.
- Import `Dice` and render it in the game modal when
  `activeGame.game_type_id === "dice"`, passing `casinoId`, `balance`,
  `minBet`/`maxBet` from `gameTypeMap["dice"]`, and `onExit`.

## New / changed files

**New**
- `supabase/functions/dice/index.ts`
- `supabase/functions/dice/engine.ts`
- `supabase/functions/dice/engine.test.ts`
- `src/components/games/Dice.tsx`
- `src/hooks/useDice.ts`

**Changed**
- `src/pages/CasinoDashboard.tsx` — add Dice to `PLAYABLE_GAME_IDS` and the
  game modal branch.
- `src/types/index.ts` — `DiceDirection`, `DiceResult`.

No migration needed — the `dice` `game_types` row already exists
(`004_games.sql`), and no new table is required.

## Testing

- **Engine unit tests (Vitest, TDD)**: `winChanceFor` for both directions,
  `multiplierFor` against known win-chance values (e.g. 50% → ~1.96x,
  1% → 98x, 95% → ~1.03x), `isWin` boundary behavior at exactly `target`,
  `rollValue` stays within `[0, 100)` with 2-decimal precision.
- **Manual/integration**: place a dice bet as the test account, verify balance
  updates and a `transactions` row is written with the correct net amount;
  verify the edge function rejects out-of-range bets and out-of-range win
  chances.

## Security notes

- All roll RNG and payout math run server-side in the edge function; the
  client only submits `{ bet, target, direction }` and renders the returned
  result — nothing to manipulate client-side, matching Blackjack's model.
- Edge function derives the player from the JWT, never trusts a
  client-supplied user id.
