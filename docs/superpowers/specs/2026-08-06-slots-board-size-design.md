# Slots Configurable Board Size — Design

## Problem

The slot machine (`src/components/games/Slots.tsx` + `supabase/functions/slots/`)
has a hardcoded 5-column × 3-row board. Admins want to configure a slots
instance's board size, matching the existing per-instance settings pattern
(Reward Mode, House Edge). Requested sizes:

- **3x3** (rows x cols) — smallest
- **3x4**
- **5x3** — today's board, stays the default
- **3x6**
- **4x6** — largest

The two smallest boards (3x3, 3x4) must be locked to single-row reward mode.
The largest boards get a choice — except 4x6, resolved below.

## Scope

Per slot-machine **instance**, same as Reward Mode and House Edge today —
admin picks board size when creating/editing a `casino_games` row in
`GameSettingsModal`; all players of that instance see the same board. Not
a player-facing / live-switchable setting.

## Data model

New key in `SlotsInstanceSettings` (`src/types/index.ts`):

```ts
export interface SlotsInstanceSettings {
  rewardMode?: "single_row" | "full_board";
  houseEdge?: 0 | 0.01 | 0.02 | 0.03 | 0.04 | 0.05;
  design?: string;
  boardSize?: "3x3" | "3x4" | "5x3" | "3x6" | "4x6";
}
```

No migration needed — `casino_games.settings` is already free-form jsonb.
Absent `boardSize` (all existing rows) defaults to `"5x3"`, fully backward
compatible with today's behavior and payout tables (unchanged).

## Reward mode gating by board size

| Board size | Allowed reward modes |
|---|---|
| 3x3 | `single_row` only |
| 3x4 | `single_row` only |
| 5x3 (default) | `single_row` or `full_board` (unchanged) |
| 3x6 | `single_row` or `full_board` |
| 4x6 | `full_board` only |

4x6 is full-board-only because single-row's payline concept requires a
well-defined "middle row," which only exists on 3-row boards. Since 4x6 has
4 rows, there is no unambiguous payline — rather than invent an arbitrary
row (e.g. "2nd from top") or add a separate row-picker setting, 4x6 simply
doesn't offer single-row mode. Single-row mode is therefore only ever
evaluated on 3-row boards (3x3, 3x4, 5x3, 3x6), so its payline is always
unambiguously the middle row (row index 1 of 0/1/2) — no board-size-specific
row logic needed anywhere in the engine or frontend.

## Engine changes (`supabase/functions/slots/engine.ts`)

### Board-size-generic reel representation

Today `SlotReel` is `{ top, mid, bottom }` (fixed 3 named fields) and
`REEL_COUNT = 5` is a module constant. Both become parameters of the
resolved board size:

```ts
export type BoardSize = "3x3" | "3x4" | "5x3" | "3x6" | "4x6";
export const BOARD_DIMENSIONS: Record<BoardSize, { rows: number; cols: number }> = {
  "3x3": { rows: 3, cols: 3 },
  "3x4": { rows: 3, cols: 4 },
  "5x3": { rows: 3, cols: 5 },
  "3x6": { rows: 3, cols: 6 },
  "4x6": { rows: 4, cols: 6 },
};
export type Reel = SymbolId[]; // length = rows, index 0 = top
```

`spin(rng, boardSize)` draws `rows * cols` independent weighted symbols
(same `pickSymbol` weighting, unchanged), building `cols` reels of length
`rows`. The existing `SYMBOLS` weight table (dot .35, square .25, diamond
.2, star .12, seven .08) is unchanged and reused for every board size —
only the win thresholds and pay tables below are new per size.

`evaluateWin` (single-row) reads row index `Math.floor(rows / 2)` — always
1 for the 3-row boards it's ever called on — across all `cols` reels.

`evaluateFullBoardWin` flattens all `rows * cols` cells, counts per symbol,
takes the max, and collects **every** symbol tied at that max into `wins`
(already array-shaped in today's code for the 5x3/15-cell case, where at
most a 2-way tie is possible; 18- and 24-cell boards can produce 3-way
ties, which the same array-based code handles without special-casing —
verified by exact enumeration, see Math below).

### Per-board-size pay tables and thresholds

Derived by exact enumeration (multinomial composition counting over the 5
symbol weights — not simulation), same methodology the existing full-board
mode's design used. Script and full working are in this session's
scratchpad; figures below are final.

Each table's associated `BASELINE_RTP_*` constant is set to that table's
own *exact* computed RTP (at `houseEdge` unspecified / scale=1), so the
existing `edgeScale(baselineRtp, houseEdge) = (1 - houseEdge) / baselineRtp`
formula stays exactly self-consistent per board size: whatever house edge
(0–5%) the admin picks is *exactly* the realized long-run RTP for that
instance, regardless of the raw table's own baseline. This is the same
mechanism already used for 5x3, just with one baseline constant per
board-size/reward-mode combination instead of two constants shared by all
sizes.

**Single-row** (win = N+ of one symbol on the middle row of `cols` reels).
Threshold chosen to avoid same-row ties (`2 x threshold > cols`), matching
today's 5x3 design (2*3=6>5):

| Board | cols | Threshold | Tiers (WIN / BIG WIN / MEGA WIN) | Hit freq | `BASELINE_RTP` |
|---|---|---|---|---|---|
| 3x3 | 3 | 2 | 2-match / — / 3-match | 60.0% | 0.904966500000 |
| 3x4 | 4 | 3 | 3-match / — / 4-match | 21.3% | 0.992062930000 |
| 5x3 (unchanged) | 5 | 3 | 3 / 4 / 5-match | 41.5% | 0.9619252895 |
| 3x6 | 6 | 3 | 3-match / 4-5-match / 6-match | 63.0% | 0.961146984006 |

3x3 and 3x4 only reach 2 win tiers (their max possible match count is too
low for 3), so their WIN banner only ever shows the WIN or MEGA WIN
treatment (BIG WIN's CSS tier is simply unused for these two sizes — no
new CSS needed, `winTier()` just never returns the middle tier for them).

Pay tables (dot / square / diamond / star / seven, in multiplier-of-bet,
per tier):

```
3x3: dot [0.5, 5.5]      square [1, 7.5]      diamond [1, 9.5]
     star [1.5, 11.5]    seven [2, 15]

3x4: dot [2.5, 18.5]     square [3, 24.5]     diamond [4, 30.5]
     star [4.5, 36.5]    seven [6, 48.5]

3x6: dot [1, 2, 7.5]     square [1, 2.5, 10]  diamond [1.5, 3, 12.5]
     star [2, 3.5, 15]   seven [2.5, 5, 20]
```

5x3's existing table (`SYMBOLS`) is unchanged.

**Full-board** (win = N+ of one symbol anywhere on the board; ties pay all
tied symbols):

| Board | cells | Threshold | Tiers | Hit freq | `BASELINE_RTP` |
|---|---|---|---|---|---|
| 5x3 (unchanged) | 15 | 7 | 7-8 / 9-10 / 11-15 | 32.0% | 0.984280455592317 |
| 3x6 | 18 | 8 | 8-9 / 10-11 / 12-18 | 34.4% | 0.942909367367 |
| 4x6 | 24 | 10 | 10-12 / 13-16 / 17-24 | 37.8% | 0.972684972884 |

Pay tables:

```
3x6 (18 cells): dot [1.5, 5, 18.5]     square [2.5, 8, 27.5]
                diamond [3.5, 10.5, 36.5]  star [5, 15.5, 55]
                seven [8.5, 26, 92]

4x6 (24 cells): dot [2, 5.5, 19]       square [2.5, 8, 29]
                diamond [3.5, 11, 38.5]  star [5.5, 16.5, 57.5]
                seven [9, 27.5, 96]
```

5x3's existing table (`FULL_BOARD_SYMBOLS`) is unchanged.

### Why hit frequency isn't identical across sizes

Exact enumeration shows hit frequency can't be tuned to an arbitrary target
independent of board geometry — e.g. for a 3-column single-row board, the
only two non-trivial win thresholds (2-match, 3-match) hit 60.0% or 6.9%
of spins with no value in between, since there are only 3 possible symbol
counts on 3 iid draws. Thresholds above were chosen as the closest
achievable fit to today's 41.5%/32.0% feel at each geometry; actual payback
percentage (the part that matters for house economics) is independently
locked to the admin's house-edge selection regardless, via the
per-size `BASELINE_RTP` constants above.

## Frontend changes (`src/components/games/Slots.tsx`)

- New prop `boardSize: BoardSize` (read from instance settings, defaults
  `"5x3"`), passed alongside existing `rewardMode`, `houseEdge`, `gameId`.
- Reel state becomes `Reel[]` sized to `cols`, each `Reel` an array of
  `rows` symbols, replacing the `{top,mid,bottom}` literal rendering
  (`Array.from({ length: rows }, ...)` mapped per reel instead of 3
  explicit `<div className="sl-cell">`s).
- CSS: `.sl-reels` grid-template-columns becomes `repeat(${cols}, var(--cell))`
  (inline style or a CSS custom property set from `cols`), `.sl-reel`
  height becomes `calc(${rows} * var(--cell))`, filler-strip length and
  drop-distance (`-15 * var(--cell)` today) become `-(fillerCount + rows) *
  var(--cell)` derived from actual filler count. The per-reel stagger-delay
  rules (`nth-child(1..5)` today) extend to `nth-child(1..6)` to cover the
  6-column boards; boards with fewer columns simply don't use the unused
  rules.
- `CLIENT_SYMBOLS` / `CLIENT_FULL_BOARD_SYMBOLS` (display-only paytable
  mirrors) become lookup maps keyed by `boardSize`, holding the tables
  above; `winTier()` takes `boardSize` (or its resolved tier-count) to map
  raw counts to the 3 shared CSS tier classes correctly per size.
- Modal outer sizing keeps `width: min(96vw, 1360px)` unchanged (board
  size doesn't need a bigger modal footprint, just a different internal
  grid); `--cell: clamp(64px, 6.5vw, 108px)` unchanged — it already scales
  continuously and naturally produces a smaller on-screen board for 3x3 and
  a denser one for 4x6 without any extra work, matching the
  fill-sizing rules in CLAUDE.md.

## Admin UI (`src/components/GameSettingsModal.tsx`)

New "Board Size" section (slots-only, alongside Reward Mode/House Edge),
5-button grid: 3x3, 3x4, 5x3 (labeled "Classic" or similar, default),
3x6, 4x6. Selecting 3x3 or 3x4 auto-forces Reward Mode to `single_row` and
disables its buttons with an inline note; selecting 4x6 auto-forces
`full_board` the same way; selecting 5x3 or 3x6 re-enables free choice
(preserving whichever mode was last selected, defaulting to `single_row`).

## Edge function (`supabase/functions/slots/index.ts`)

- New `resolveBoardSize(settings)` alongside `resolveRewardMode` /
  `resolveHouseEdge`: reads `settings.boardSize`, defaults to `"5x3"` if
  absent or not one of the 5 known values.
- If the resolved `(boardSize, rewardMode)` pair is invalid per the gating
  table above (e.g. a stale/tampered `full_board` setting stored against a
  3x3 instance), the server coerces `rewardMode` to the size's allowed
  mode server-side rather than trusting the stored value — the gating is
  enforced authoritatively here, not just in the admin UI.
- `spin()` call site passes the resolved `boardSize` through; payout
  functions look up the matching pay table and `BASELINE_RTP` constant for
  that `(boardSize, rewardMode)` pair instead of the single hardcoded
  table used today.
- Response gains `boardSize` so the frontend can size its grid without
  re-deriving it from settings.

## Out of scope

- No player-facing / live board-size switching.
- No changes to `min_bet`/`max_bet` handling.
- No new board sizes beyond the 5 listed (no generic NxM support).
- No unification of single-row and full-board win-evaluation code paths.

## Testing

- `supabase/functions/slots/engine.test.ts`: new RTP-pinning test per new
  `(boardSize, rewardMode)` pair (5 new cases: 3x3, 3x4, 3x6-single,
  3x6-full, 4x6-full), asserting the exact `BASELINE_RTP` constants above,
  plus a hit-frequency assertion per case. Existing 5x3 tests unchanged.
- New test asserting the gating table is enforced server-side (posting a
  disallowed `boardSize`/`rewardMode` combination still resolves to the
  size's allowed mode).
- Manual Playwright verification with the seeded test admin account across
  all 5 board sizes: instance creation with each size, reward-mode
  lock/unlock behavior in the settings modal, correct grid dimensions and
  cell lighting on a win, balance-deduction timing unaffected, paytable
  sidebar matches the tier/count structure for that size, and 375px/1920px
  sanity checks per the fill-sizing rules in CLAUDE.md.
