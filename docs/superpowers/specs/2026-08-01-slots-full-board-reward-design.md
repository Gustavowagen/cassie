# Slots Full Board Reward Mode — Design

## Problem

The slot machine (`src/components/games/Slots.tsx` + `supabase/functions/slots/`)
only ever pays out based on the middle row (the payline): 3+ of the same
symbol among the 5 `mid` cells. Admins want a second reward mode where a win
is instead based on how many of the same symbol appear anywhere across all
3 rows (15 cells), with the house edge kept roughly the same as today.

## Scope

Per slot-machine **instance**, not global. This app already supports
multiple named instances of the same game type per casino (`casino_games`,
one row per instance, edited via `GameSettingsModal`), so an admin can run
one slots instance in "Single row reward" and another in "Full board
reward" side by side. The setting is stored on the instance, matching how
`custom_name` already works.

## Data model

New column, defaulting existing rows to today's behavior:

```sql
alter table public.casino_games
  add column if not exists settings jsonb not null default '{}'::jsonb;
```

`CasinoGame` (`src/types/index.ts`) gains `settings: Record<string, unknown>`.
For a slots instance, the shape is:

```ts
interface SlotsInstanceSettings {
  rewardMode?: "single_row" | "full_board";
}
```

Absent/missing `rewardMode` (all existing rows, and any other game type)
means `"single_row"` — fully backward compatible, no backfill needed.

## Reward math

`spin()` already draws all 15 cells (top/mid/bottom × 5 reels) independently
— no change there. What changes is how a win is *evaluated* and *paid*.

### Why the existing threshold (3) can't be reused

With 15 iid draws across 5 weighted symbols, some symbol has count ≥ 3 on
**100% of spins** (pigeonhole: 15/5 = 3 average, and the max is essentially
always at or above that). Reusing "3+" as the win threshold would mean
winning every single spin, which breaks both the RTP and the game feel. This
was confirmed by exact multinomial enumeration (all 3,876 compositions of 15
into 5 parts), not simulation.

### Win threshold and tiers

Using that same exact enumeration over the existing symbol weights (dot .35,
square .25, diamond .2, star .12, seven .08):

- **Win threshold: count ≥ 7** (of the 15 cells). Hit frequency 31.97%
  (single-row today: 41.5%). Lower thresholds (e.g. 6) hit ~62% of spins,
  which felt too frequent for what's meant to be the "big" mode; 7 keeps
  wins meaningfully rarer than single-row while staying reachable for every
  symbol, including `seven`.
- Three payout tiers, mirroring the existing 3/4/5 structure:
  - **7–8 cells** → "WIN"
  - **9–10 cells** → "BIG WIN"
  - **11–15 cells** → "MEGA WIN"

### Tie-break rule

Unlike single-row (where two symbols both reaching 3+ is mathematically
impossible — 2×3 > 5), with 15 cells two symbols can land on the same max
count. **The rarer symbol wins** (dot → square → diamond → star → seven,
later wins ties). This rule is baked directly into the enumeration used to
derive the payout table below, not an unaccounted-for edge case.

### Payout table

Solved so total RTP lands close to single-row's exact RTP (0.98202817,
computed the same way `engine.test.ts` already pins it: `Σ P(symbol, tier) ×
pay(symbol, tier)`). Result: RTP 0.98168 (house edge 1.832%, vs. single-row's
1.797%) — within the same 97–99% band `engine.test.ts` already asserts.

| Symbol | 7–8 (WIN) | 9–10 (BIG) | 11–15 (MEGA) |
|---|---|---|---|
| dot | 1.46x | 7.31x | 58.46x |
| square | 2.19x | 10.23x | 80.38x |
| diamond | 2.92x | 14.61x | 116.92x |
| star | 4.38x | 21.92x | 189.99x |
| seven | 7.31x | 36.54x | 379.98x |

## Engine changes (`supabase/functions/slots/engine.ts`)

- New `FULL_BOARD_SYMBOLS: FullBoardSymbolDef[]` holding the table above,
  alongside the existing `SYMBOLS` (untouched).
- New `FullBoardWin` type — kept **separate** from the existing `Win` type
  rather than unifying, so single-row code and its tests are untouched:
  ```ts
  export interface FullBoardWin {
    symbol: SymbolId;
    count: number; // 7..15
    positions: { reel: number; row: "top" | "mid" | "bottom" }[];
  }
  ```
- New `evaluateFullBoardWin(reels: Reel[]): FullBoardWin | null` — flattens
  all 15 cells, counts per symbol, picks the max (tie → rarer symbol per the
  rule above), returns `null` if the max count < 7.
- New `payoutForFullBoard(win: FullBoardWin | null, bet: number): number` —
  looks up `FULL_BOARD_SYMBOLS`, buckets `count` into the 7–8/9–10/11–15
  tier, same `roundMoney` rounding as today.
- A comment documenting the derivation (pigeonhole argument, enumeration
  method, tie-break rule, solved scale factor), matching the existing
  comment style above `SYMBOLS`.

## Edge function (`supabase/functions/slots/index.ts`)

- Request body gains `casino_game_id: string`.
- Fetch that `casino_games` row (service client) alongside the existing
  membership/`game_types` lookup. Validate it belongs to `casino_id` and has
  `game_type_id === "slots"` — reject with 400 otherwise (defends against a
  stale/mismatched id from the client).
- Read `settings.rewardMode` from that row; default to `"single_row"` if
  absent or not one of the two known values.
- Branch: `"full_board"` → `evaluateFullBoardWin` / `payoutForFullBoard`;
  otherwise the existing `evaluateWin` / `payoutFor` path, unchanged.
- Response gains `rewardMode: "single_row" | "full_board"` so the frontend
  knows how to interpret `win.positions` without re-deriving it.
- `describeSpin` (transaction description) branches the same way for its
  message text.

## Types (`src/types/index.ts`)

- `CasinoGame.settings: Record<string, unknown>`.
- `SlotWin` (existing, `positions: number[]`) unchanged.
- New `FullBoardSlotWin { symbol: SlotSymbolId; count: number; positions: { reel: number; row: "top" | "mid" | "bottom" }[] }`.
- `SlotsResult.win: SlotWin | FullBoardSlotWin | null`, plus
  `SlotsResult.rewardMode: "single_row" | "full_board"`.

## Frontend (`src/components/games/Slots.tsx`)

- New props: `gameId: string` (the `casino_games.id`, sent to the edge
  function as `casino_game_id`) and `rewardMode: "single_row" | "full_board"`
  (read from the instance's `settings`, drives display only — the server is
  still authoritative on payout).
- `useSlots`/`spin()` includes `casino_game_id: gameId` in the request body.
- Cell lit-up check: single-row mode keeps today's `win.positions.includes(i)`
  against the mid cell only. Full-board mode builds a `Set` of `"reel:row"`
  keys from `win.positions` and checks membership independently for each of
  a reel's top/mid/bottom cells — so a full-board win can light up cells on
  any row.
- WIN / BIG WIN / MEGA WIN banner: today it's driven directly off
  `win.count` (3/4/5). Introduce a small `winTier(rewardMode, count): 3|4|5`
  helper that maps single-row's 3/4/5 to themselves and full-board's
  7–8/9–10/11–15 to 3/4/5 — reusing the existing `sl-win-tier-{3,4,5}` CSS
  classes (incl. the mega-win shake/font-size treatment) unchanged.
- Paytable sidebar: shows the single-row 3×/4×/5× table today. When
  `rewardMode === "full_board"`, shows the new tier table instead
  (`CLIENT_FULL_BOARD_SYMBOLS`, a local mirror of `FULL_BOARD_SYMBOLS`
  following the same "dependency-free copy for display only" pattern
  `CLIENT_SYMBOLS` already uses), with the tier header relabeled
  ("Paytable (7–8 · 9–10 · 11+)").

## Settings UI (`src/components/GameSettingsModal.tsx`)

- New optional section, rendered only when the modal is for a slots
  instance: "Reward Mode", two selectable cards —
  **"Single row reward"** ("Win by matching symbols on the middle row.") and
  **"Full board reward"** ("Win by matching symbols anywhere across all 3
  rows.") — defaulting to the instance's current `rewardMode` (or
  `"single_row"` when creating a new instance).
- `onSave` signature extends from `(name: string) => Promise<void>` to
  `(name: string, settings: Record<string, unknown>) => Promise<void>`.

## Wiring (`src/hooks/useGames.ts`, `src/pages/CasinoDashboard.tsx`)

- `createGame(casinoId, gameTypeId, customName, settings)` and
  `updateGame(id, customName, settings)` — both persist `settings` alongside
  the existing columns.
- `CasinoDashboard.tsx`'s `onCreate`/`onUpdate` callbacks pass the settings
  object through from the modal.
- Where `<Slots>` is rendered, add `gameId={activeGame.id}` and
  `rewardMode={(activeGame.settings as SlotsInstanceSettings)?.rewardMode ?? "single_row"}`.

## Out of scope

- No changes to any other game type's settings or `casino_games` usage.
- No change to `min_bet`/`max_bet`, which stay per-`game_type_id` (shared
  across instances) as they are today.
- No unification of `Win`/`FullBoardWin` position shapes — kept separate to
  avoid touching single-row's existing tested behavior.

## Testing

- `supabase/functions/slots/engine.test.ts`: new `describe` blocks for
  `evaluateFullBoardWin`, `payoutForFullBoard`, and a full-board RTP test
  (closed-form, independently recomputed — same pattern as the existing RTP
  test) asserting it lands in the 97–99% band.
- Manual verification via Playwright with the seeded test admin account:
  1. In a casino's Settings tab, add a new Slot Machine instance, set Reward
     Mode to "Full board reward", save.
  2. Open that instance, spin until a win lands on a non-mid row — confirm
     the correct cells light up and the WIN/BIG WIN/MEGA WIN banner and
     paytable match the full-board tiers.
  3. Confirm balance still deducts the bet instantly on spin and only
     credits any payout once the reel-drop animation finishes (existing
     behavior, must not regress).
  4. Edit the instance back to "Single row reward", confirm it plays exactly
     as before.
  5. Refresh the page — the reward mode persists (confirms the DB write, not
     just local state).
