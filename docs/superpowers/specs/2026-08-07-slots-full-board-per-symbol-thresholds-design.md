# Slots Full-Board Per-Symbol Win Thresholds — Design

## Problem

Today, full-board mode (`supabase/functions/slots/engine.ts`'s `FULL_BOARD_TABLES`)
uses one shared `minCount` for every symbol on a given board size — dot (35%
weight, most common) and seven (8% weight, rarest) both need the exact same
number of matching cells to win. Only the *payout* scales with rarity, not
the *win condition*.

Requested change: rarer symbols should need fewer matching cells to win;
common symbols should need more. But the overall probability of winning with
many common-symbol matches must still exceed the probability of winning with
few rare-symbol matches — i.e. despite needing more matches, the common
symbol must still win more often in practice.

Single-row (payline) mode is unaffected by this change — see Scope.

## Scope

- **Full-board mode only.** Single-row payline mode (`SINGLE_ROW_TABLES`,
  `evaluateWin`, `payoutFor`) is untouched — decided during design
  discussion, since the two modes are independent code paths with
  independent pay tables today.
- Applies to all three board sizes that support full-board mode: 5x3 (15
  cells), 3x6 (18 cells), 4x6 (24 cells).
- `SYMBOL_WEIGHTS` (the draw probabilities) are unchanged, per the original
  request — only the win *thresholds* and pay tables move.

## Win-evaluation mechanics

Today: find the highest per-symbol cell count on the board; if it's
`>= minCount`, every symbol tied at that max count wins (shared `count`,
shared tier).

New: each symbol has its own threshold. **Every symbol whose own count
reaches its own threshold pays independently, at its own tier** — decided
during design discussion as the cleanest generalization of today's "every
tied symbol pays" rule, extended from "tied at the max" to "each clears its
own bar." If two different symbols both qualify in the same spin (e.g. dot
reaches its threshold *and* seven separately reaches its own lower
threshold), both pay and their payouts stack — there is no single "winner,"
no priority ordering to design, and no tie-break rule needed.

This means `evaluateFullBoardWin` no longer computes a single "max count" —
it checks each symbol's count against that symbol's own threshold and
collects every symbol that clears its own bar.

## Threshold methodology

Two constraints, both hard requirements:

1. **Non-increasing thresholds by rarity**: a rarer symbol's threshold is
   never higher than the next-more-common symbol's (`T_dot >= T_square >=
   T_diamond >= T_star >= T_seven`).
2. **Strictly decreasing win probability by rarity**: `P(dot wins) >
   P(square wins) > P(diamond wins) > P(star wins) > P(seven wins)`, where
   each symbol's count is exactly `Binomial(cells, weight)` (marginally
   exact regardless of the other symbols, since each cell is an independent
   weighted draw).

Method (decided during design discussion — "greedy per-symbol, ties
allowed"): for each symbol from most to least common, in order, thresholds
were searched for the combination that keeps each board's **overall hit
frequency close to today's** (32.0% / 34.4% / 37.8% for 5x3 / 3x6 / 4x6)
while maximizing the threshold spread between the most- and least-common
symbol, subject to the two constraints above. This was necessary because
independent-per-symbol win evaluation (vs. today's "only the max-count
symbol wins") makes hit frequency a union over 5 events instead of a single
event — naively reusing today's shared thresholds would have pushed hit
frequency to 47–82%, un-tunable back down without touching thresholds
themselves. Search was exact (binomial tail probabilities + full
multinomial enumeration for hit frequency), not simulated; script and full
working are in this session's scratchpad.

On the smallest board (5x3, 15 cells), the achievable resolution is limited:
dot, square, and diamond all land on the same threshold (7, unchanged from
today's shared value) — only star and seven separate out below that.
Larger boards (3x6, 4x6) have enough cells to give every symbol a distinct
threshold. This is an inherent consequence of 15 cells not providing enough
combinatorial resolution to fit 5 distinct thresholds at a sane hit
frequency — not a shortcut.

## Tier structure

Each symbol keeps 3 pay tiers (WIN / BIG WIN / MEGA WIN, matching today's
`sl-win-tier-3/4/5` CSS hooks). Tier cutoffs are **probability-ratio based**,
not linear divisions of the remaining board space: tier 1 starts at the
smallest count where the symbol's remaining tail probability drops to ~30%
of its tail at the threshold, and tier 2 starts where it drops to ~30% of
tier 1's tail. (An earlier draft divided the count range `[threshold, N]`
into three linear thirds; that produced practically unreachable tiers for
rare symbols, since a rare symbol's count essentially never exceeds its
threshold by more than a few cells even though the board has many more
cells left — the probability-ratio approach fixes this by sizing each
symbol's tiers to its own actual distribution.)

## Pay tables

Payout multipliers were solved so each symbol contributes roughly equal
expected value to the table's total RTP (5-way split of a 0.95 raw target),
using a fixed within-symbol tier-pay ratio (tier 1 = 3x tier 0, tier 2 =
10.5x tier 0 — the same ratio pattern already present in today's 5x3 table),
then rounded to the nearest 0.5. `baselineRtp` is then set to the *exact*
computed RTP of the rounded table (same self-consistent pattern as
`BASELINE_RTP` today) — its absolute value doesn't need to hit any
particular target, since `edgeScale(baselineRtp, houseEdge) = (1 -
houseEdge) / baselineRtp` normalizes it out regardless.

All figures below are from exact binomial/multinomial enumeration (not
simulation); script and full working are in this session's scratchpad.

### 5x3 (15 cells) — hit frequency ≈ 32.9% (today: 32.0%)

| Symbol | Threshold | Tier 0 | Tier 1 | Tier 2 | Pay (tier0/1/2) |
|---|---|---|---|---|---|
| dot | 7 | 7-8 | 9 | 10-15 | 0.5x / 1.5x / 4.5x |
| square | 7 | 7-8 | 9 | 10-15 | 2.5x / 8x / 28x |
| diamond | 7 | 7 | 8 | 9-15 | 6x / 17.5x / 61.5x |
| star | 6 | 6 | 7 | 8-15 | 22x / 66.5x / 233.5x |
| seven | 5 | 5 | 6 | 7-15 | 27.5x / 82.5x / 288x |

`baselineRtp = 0.953370178231`

### 3x6 (18 cells) — hit frequency ≈ 35.1% (today: 34.4%)

| Symbol | Threshold | Tier 0 | Tier 1 | Tier 2 | Pay (tier0/1/2) |
|---|---|---|---|---|---|
| dot | 9 | 9-10 | 11 | 12-18 | 1x / 2.5x / 9x |
| square | 7 | 7-8 | 9 | 10-18 | 1x / 2.5x / 9x |
| diamond | 7 | 7-8 | 9 | 10-18 | 3x / 8.5x / 30x |
| star | 6 | 6 | 7 | 8-18 | 7x / 21.5x / 74.5x |
| seven | 5 | 5 | 6 | 7-18 | 10.5x / 31.5x / 110.5x |

`baselineRtp = 0.990009227769`

### 4x6 (24 cells) — hit frequency ≈ 36.4% (today: 37.8%)

| Symbol | Threshold | Tier 0 | Tier 1 | Tier 2 | Pay (tier0/1/2) |
|---|---|---|---|---|---|
| dot | 11 | 11-12 | 13-14 | 15-24 | 0.5x / 2x / 6.5x |
| square | 9 | 9-10 | 11-12 | 13-24 | 1x / 3x / 11x |
| diamond | 9 | 9-10 | 11 | 12-24 | 3.5x / 11x / 39x |
| star | 7 | 7 | 8 | 9-24 | 5x / 14.5x / 50.5x |
| seven | 6 | 6 | 7 | 8-24 | 11x / 33x / 116.5x |

`baselineRtp = 0.924315378511`

Note: `dot` and `square` land on identical pay (3x6: 1x/2.5x/9x) since their
per-tier win probabilities came out almost equal at the chosen thresholds —
an accepted artifact of the search optimizing for hit-frequency match and
threshold spread, not perfectly monotonic pay, same spirit as the existing
"rarer pays more" being a general tendency rather than a strict invariant
(see the 2026-08-06 board-size design doc's note on 3x3's tier-0 tie).

## Engine changes (`supabase/functions/slots/engine.ts`)

- `FULL_BOARD_TABLES[boardSize]` config shape changes from one shared
  `minCount`/`tierIndex` to **per-symbol** threshold + tier boundaries:
  ```ts
  interface FullBoardSymbolConfig {
    id: SymbolId;
    threshold: number;
    tierIndex: (count: number) => number; // per-symbol cutoffs now
    pay: number[];
  }
  interface FullBoardConfig {
    symbols: FullBoardSymbolConfig[];
    baselineRtp: number;
  }
  ```
- `evaluateFullBoardWin(reels, boardSize)`: counts cells per symbol (as
  today), then for each symbol in the config, checks its count against its
  own threshold. Every symbol that qualifies is collected into `wins`, now
  carrying its own `count`:
  ```ts
  export interface FullBoardTieWin {
    symbol: SymbolId;
    count: number;
    positions: FullBoardPosition[];
  }
  export interface FullBoardWin {
    wins: FullBoardTieWin[]; // no more shared top-level `count`
  }
  ```
  Returns `null` when `wins` is empty (no symbol qualified), same as today.
  The `wins` array remains generically sized — up to 5 entries are possible
  in principle, though summed-threshold arithmetic makes more than 2-3
  simultaneous qualifiers vanishingly rare in practice; no special-casing of
  array length, matching today's existing generic-array approach.
- `payoutForFullBoard(win, bet, boardSize, houseEdge)`: sums each win
  entry's own-tier payout (via that symbol's own `tierIndex(entry.count)`
  and `pay` array) instead of applying one shared tier to every tied symbol.

## Edge function changes (`supabase/functions/slots/index.ts`)

- `describeSpin`'s full-board branch reads `count` off each entry in `wins`
  instead of a shared top-level `count` (e.g. `"Slots: 9x dot+3x seven (full
  board)"` when two symbols both qualify at different counts).
- No other changes — `evaluateFullBoardWin`/`payoutForFullBoard` call sites
  are unaffected by the internal shape change (still pass reels/bet/boardSize/houseEdge,
  get back a win object and a number).

## Frontend changes

### Types (`src/types/index.ts`)

`FullBoardSlotWin` mirrors the engine's new shape:
```ts
export interface FullBoardSlotWin {
  wins: { symbol: SlotSymbolId; count: number; positions: { reel: number; row: number }[] }[];
}
```

### `src/components/games/Slots.tsx`

- `FULL_BOARD_PAYTABLES`: mirrors the new per-symbol threshold/tier shape
  (client-side display copy, same pattern as today — server is still
  authoritative and recomputes the real outcome).
- `winTier(boardSize, rewardMode, win)`: for full-board, computes each
  qualifying entry's own tier via its own symbol's `tierIndex`, then returns
  the **highest** tier reached across all entries — that's what drives the
  WIN/BIG WIN/MEGA WIN banner treatment. (Single-row is unchanged — still
  one symbol, one count, one tier.)
- Payout amount shown is the sum already computed server-side
  (`payoutForFullBoard`) — no client-side re-summing needed, same as today.
- `fullBoardLit` (cell highlighting): unions the `positions` from every
  entry in `wins`, so all qualifying symbols' cells light up together when
  more than one symbol wins in the same spin.
- **Paytable panel**: today's single shared header line (e.g. "Paytable
  (7-8 · 9-10 · 11+)") no longer applies uniformly. Each symbol's row in the
  paytable gains its own count-range label alongside its existing pay
  multipliers (e.g. `🔴 7-8 · 9 · 10+  →  0.5x · 1.5x · 4.5x`), reusing each
  symbol's own threshold/tier data from the updated `FULL_BOARD_PAYTABLES` —
  no separately maintained label strings to drift out of sync.
- `buildSlotsInfo`'s full-board branch: rule text changes from one shared
  `"${minCount}+ matching cells anywhere ... wins"` line to a per-symbol
  breakdown (e.g. one rules bullet per symbol stating its own threshold), so
  the info panel accurately reflects that thresholds now differ by symbol.

## Out of scope

- Single-row payline mode — thresholds and pay tables unchanged.
- `SYMBOL_WEIGHTS` (draw probabilities) — unchanged, per the original
  request.
- No changes to house-edge menu, board-size menu, or reward-mode gating.
- No changes to bet limits, balance-deduction timing, or reel-drop
  animation timing.

## Testing

- `supabase/functions/slots/engine.test.ts`: replace existing full-board
  pinned-payout tests with per-symbol-threshold cases for 5x3/3x6/4x6:
  - Each symbol's exact threshold triggers a win at tier 0; one below does
    not.
  - A spin where two different symbols each independently clear their own
    threshold produces a `wins` array with both entries, and
    `payoutForFullBoard` sums both entries' own-tier payouts.
  - `baselineRtp` pinned to the exact values above for each board size.
  - Hit-frequency assertion per board size (~32.9% / 35.1% / 36.4%, matching
    the values derived above), computed the same exact-enumeration way as
    the existing single-row tests.
- Manual Playwright verification with the seeded test admin account:
  full-board mode on all three eligible board sizes — paytable panel shows
  correct per-symbol count labels, win banner tier matches the qualifying
  symbol reaching the highest tier, cell highlighting covers every
  qualifying symbol when more than one wins in the same spin, balance
  deduction timing unaffected, 375px/1920px sanity checks per CLAUDE.md's
  fill-sizing rules.
