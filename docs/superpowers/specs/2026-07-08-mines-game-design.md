# Mines — Design Spec

**Date:** 2026-07-08
**Status:** Approved (design)

## Goal

Add Mines as a fourth playable game on OnlineCassie, styled after Stake's Mines
game (`mines.png`): a 5×5 grid hiding a chosen number of mines. The player
reveals tiles one at a time; each safe tile increases the payout multiplier;
hitting a mine ends the round with no payout. The player can cash out at any
point after at least one safe reveal. Server-authoritative like Blackjack —
this is a multi-step round, not a single-request resolution like Dice/Roulette.
House edge: **2%**.

## Scope

- Manual betting only: bet amount + mines count (1–24), then reveal tiles.
- Cash out any time after ≥1 safe reveal.
- Full board reveal when the round ends (win or loss), matching `mines.png`.
- Auto-complete (full payout) if the player reveals every safe tile.

Out of scope: Auto-bet mode (strategy runner across multiple rounds), reveal
history strip, provably-fair seed verification UI.

## Game math

- Grid: `GRID_SIZE = 25` tiles (5×5), tile indices `0`–`24`.
- Player chooses `minesCount` in `[1, 24]`. Mine positions are chosen
  server-side via a Fisher-Yates-style random pick over tile indices, using
  `crypto.getRandomValues`.
- **Fair multiplier after `n` safe picks**:
  `1 / Π_{i=0}^{n-1} ((GRID_SIZE - minesCount - i) / (GRID_SIZE - i))`
  — the inverse probability of surviving `n` picks without hitting a mine.
- **Multiplier with house edge**: `fairMultiplier * (1 - HOUSE_EDGE)`,
  `HOUSE_EDGE = 0.02` (same constant as Dice).
- **Payout** on cash-out or full clear: `bet * multiplierForPicks(picks, minesCount)`.
- Cash-out is rejected with 0 safe reveals (multiplier at 0 picks is
  `1 * (1 - HOUSE_EDGE)`, a guaranteed-loss cash-out that shouldn't be offered).
- Revealing the last safe tile (`revealed.length === GRID_SIZE - minesCount`)
  auto-completes the round at full payout — matches Stake's auto-cashout on a
  cleared board.

## Backend

New Edge Function `supabase/functions/mines/`, following the Blackjack layout
(persisted round, multiple actions per round) rather than Dice's single-request
model.

1. **`engine.ts`** — pure functions, zero I/O, fully unit-tested:
   - `GRID_SIZE = 25`, `HOUSE_EDGE = 0.02`, `MIN_MINES = 1`, `MAX_MINES = 24`.
   - `RoundState`: `{ mines: number[], revealed: number[], minesCount: number, bet: number, status: "active" | "complete", outcome?: "cashed_out" | "hit_mine" | "cleared", payout?: number }`.
   - `placeMines(minesCount: number, rng: Rng): number[]`.
   - `multiplierForPicks(picks: number, minesCount: number): number`.
   - `startRound(opts: { bet: number; minesCount: number; rng: Rng }): RoundState`.
   - `revealTile(state: RoundState, tile: number): RoundState` — throws on an
     out-of-range tile, an already-revealed tile, or a non-active round; sets
     `status: "complete"` / `outcome: "hit_mine"` (payout 0) on a mine, or
     `outcome: "cleared"` with full payout when it was the last safe tile.
   - `cashOut(state: RoundState): RoundState` — throws if `revealed.length === 0`
     or round isn't active; sets `status: "complete"`, `outcome: "cashed_out"`,
     `payout = bet * multiplierForPicks(revealed.length, minesCount)`.
   - `sanitize(state: RoundState, roundId: string, balance: number)` — while
     `status === "active"`, strips `mines` entirely from the response (client
     only sees `revealed`); once complete, includes the full `mines` array so
     the client can render the whole board.

2. **`index.ts`** — three actions sharing one round record, mirroring
   Blackjack's `start`/`action` dispatch:
   - **`start`** — `POST { action: "start", casino_id, bet, mines_count }`:
     - Verifies JWT → `auth.uid()`.
     - Fetches member balance + `game_types` bounds for `"mines"` in parallel.
     - Validates bet (finite, positive, within `game_types` min/max, ≤ balance)
       and `mines_count` (integer in `[MIN_MINES, MAX_MINES]`).
     - Deletes any stale non-complete round for this user/casino (one active
       round at a time, same cleanup as Blackjack's `start`).
     - Calls `startRound`, deducts the bet from balance immediately, inserts a
       `"Mines bet"` transaction, persists the round row
       (`status: "active"`), returns `sanitize(...)`.
   - **`reveal`** — `POST { action: "reveal", round_id, tile }`:
     - Loads the round by id + `user_id`, rejects if missing or already
       `complete`.
     - Calls `revealTile`; on error (bad tile) returns 400.
     - If the round is now `complete` (hit mine or cleared): credits balance
       with `payout` (0 on a mine), inserts a `"Mines: <outcome>"` transaction,
       updates the round row.
     - If still active: just persists the updated `revealed` list, no balance
       change.
     - Returns `sanitize(...)`.
   - **`cashout`** — `POST { action: "cashout", round_id }`:
     - Loads the round, rejects if missing, already complete, or 0 reveals.
     - Calls `cashOut`, credits balance with `payout`, inserts a
       `"Mines cash out"` transaction, updates the round row, returns
       `sanitize(...)`.

   All three follow Blackjack's pattern of firing the round-state write and
   the balance/transaction writes together via `Promise.all`.

## Data model

New migration, following `011_blackjack_rounds.sql` / `012_blackjack_one_active_round.sql`:

```sql
create table public.mines_rounds (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mines_rounds_active_idx
  on public.mines_rounds (casino_id, user_id, status);

create unique index mines_rounds_one_active_idx
  on public.mines_rounds (casino_id, user_id)
  where status <> 'complete';

alter table public.mines_rounds enable row level security;
-- RLS on, no policies — only the edge function's service-role key touches this table.
```

Plus a `game_types` insert:
`('mines', 'Mines', 'Find gems, avoid the mines', 100, 50000)` — same bet
range as Dice.

## Frontend

### `src/types/index.ts`
```ts
export type MinesOutcome = "cashed_out" | "hit_mine" | "cleared";
export interface MinesState {
  roundId: string;
  status: "active" | "complete";
  minesCount: number;
  bet: number;
  revealed: number[];
  mines: number[] | null; // null while active, populated once complete
  outcome?: MinesOutcome;
  multiplier: number;      // current multiplier at `revealed.length` picks
  nextMultiplier: number | null; // multiplier if the next reveal is safe, null if complete
  payout: number | null;   // set once complete
  balance: number;
}
```

### `src/hooks/useMines.ts`
Same shape as `useBlackjack.ts`: `start(bet, minesCount)`, `reveal(tile)`,
`cashOut()`, `reset()`; wraps `supabase.functions.invoke("mines", ...)`,
tracks `loading`/`error`/last `MinesState`, unwraps the `{ error }` body on
non-2xx responses (identical helper to the other three hooks).

### `src/components/games/Mines.tsx`
Two-panel layout inside the existing game modal (`Modal` size `xl`), dark
theme consistent with Dice/Roulette:

- **Left panel** — controls:
  - Bet Amount input with `½`/`2×` buttons — disabled once a round is active.
  - Mines count dropdown (1–24) — disabled once a round is active.
  - Primary button: **"Bet"** with no active round; **"Cash Out"** (showing
    live payout, e.g. `Cash Out 245 chips`) once active and `revealed.length ≥ 1`;
    disabled (still "Cash Out") with 0 reveals since cash-out isn't allowed yet.
  - Below the button: current multiplier and "next tile" multiplier preview
    while active, so the player sees the payout curve.
- **Right panel** — 5×5 tile grid:
  - Hidden tile: dark square, clickable while round is active and tile is
    unrevealed.
  - Revealed safe tile: 💎 on a green-tinted tile.
  - Revealed mine tile: 💣 on a red-tinted tile.
  - On round end, all remaining hidden tiles fade in to their true content
    (gem or mine) over ~300ms, per the reference screenshot.
- Sounds via the existing shared `src/lib/sound.ts`: `playTone` for a tile
  reveal click, `playWinChime` on cash-out/clear. A new low descending
  `playTone` call (or a small helper) for the mine-hit sound — reuse the
  module rather than duplicating Dice's inline `AudioContext` code.
- Win feedback reuses Dice's cash-particle burst treatment on cash-out/clear;
  a brief red flash + shake on hitting a mine. Respects
  `prefers-reduced-motion` (existing `DiceStyles`-style scoped `<style>` block
  with a reduced-motion override).
- Local balance state seeded from the `balance` prop, updated from each
  `MinesState.balance`, same pattern as `Dice.tsx`/`Roulette.tsx`.

### Integration (`src/pages/CasinoDashboard.tsx`)
- Add `"mines"` to `PLAYABLE_GAME_IDS` and `MANAGED_GAME_IDS`.
- Add `mines: "/games/mines.svg"` to `SETTINGS_GAME_ART`.
- Import `Mines` and render it in the game modal when
  `activeGame.game_type_id === "mines"`, passing `casinoId`, `balance`,
  `minBet`/`maxBet` from `gameTypeMap["mines"]`, and `onExit`.

### `public/games/mines.svg`
New flat-icon tile art for the Settings tab, same style/size as
`dice.svg`/`roulette.svg` (100×100 viewBox, solid background + simple shapes —
a small tile grid with one gem and one mine icon).

## New / changed files

**New**
- `supabase/migrations/029_mines.sql`
- `supabase/functions/mines/index.ts`
- `supabase/functions/mines/engine.ts`
- `supabase/functions/mines/engine.test.ts`
- `src/components/games/Mines.tsx`
- `src/hooks/useMines.ts`
- `public/games/mines.svg`

**Changed**
- `src/pages/CasinoDashboard.tsx` — add Mines to `PLAYABLE_GAME_IDS`,
  `MANAGED_GAME_IDS`, `SETTINGS_GAME_ART`, and the game modal branch.
- `src/types/index.ts` — `MinesOutcome`, `MinesState`.

## Testing

- **Engine unit tests (Vitest, TDD)**:
  - `multiplierForPicks` against known values (e.g. 3 mines, 0 picks →
    `~0.98x`; 3 mines, 1 pick → fair odds `25/22` × 0.98 ≈ `1.114x`; sanity
    check that multiplier strictly increases with picks and with `minesCount`).
  - `placeMines` always returns exactly `minesCount` unique indices in
    `[0, 24]`.
  - `revealTile`: safe reveal appends to `revealed` and stays active; mine
    reveal completes with `outcome: "hit_mine"`, `payout: 0`; revealing the
    last safe tile completes with `outcome: "cleared"` and full payout;
    re-revealing an already-revealed tile throws; tile out of `[0,24]` throws.
  - `cashOut`: throws with 0 reveals; correct payout with N reveals; throws if
    round already complete.
  - `sanitize`: `mines` is `null`/absent while active, populated once complete.
- **Manual/integration**: as the test account, start a round, reveal a few
  tiles, verify balance/transactions after both a mine hit and a cash-out;
  verify only one active round can exist per casino at a time; verify the
  edge function rejects invalid `mines_count`, invalid tile indices, and
  double-reveals.

## Security notes

- Mine placement and all payout math run server-side; the client only ever
  sees revealed tiles until the round completes, so devtools inspection can't
  leak mine positions mid-round.
- Edge function derives the player from the JWT, never trusts a
  client-supplied user id, and re-validates round ownership (`user_id`) on
  every `reveal`/`cashout` call.
- The one-active-round unique index prevents a double-`start` race from
  creating two concurrent rounds (and double-deducting the bet), same
  protection as Blackjack.
