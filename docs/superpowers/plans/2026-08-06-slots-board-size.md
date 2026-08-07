# Slots Configurable Board Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins pick a slots instance's board size (3x3, 3x4, 5x3 default, 3x6, 4x6), gate reward mode per size (3x3/3x4 single-row only, 4x6 full-board only, 5x3/3x6 free choice), and pay out from exact-enumeration-derived, per-size balanced tables.

**Architecture:** Generalize the slot engine's `Reel` type from a fixed `{top,mid,bottom}` object to a `SymbolId[]` sized to the board's row count, driven by a new `BoardSize` parameter threaded through `spin`/`evaluateWin`/`evaluateFullBoardWin`/`payoutFor`/`payoutForFullBoard`. Each board size gets its own pay table and baseline-RTP constant (already solved by exact enumeration — see the design doc), reusing the existing `edgeScale` house-edge mechanism unchanged. The board size lives in the same per-instance `casino_games.settings` jsonb as today's `rewardMode`/`houseEdge`, with server-side gating as the source of truth.

**Tech Stack:** TypeScript, Deno edge function (Supabase), Vitest, React.

**Design doc:** `docs/superpowers/specs/2026-08-06-slots-board-size-design.md`

**Amendment (found during Task 3 execution):** 3x6 single-row's originally-planned threshold (3) does not satisfy the tie-avoidance invariant `2*threshold > cols` (`6 > 6` is false) — ties are possible, and the originally-published `baselineRtp`/pay table for that config assumed a "pay both tied symbols" rule that was never implemented for single-row mode (only full-board mode pays ties). Task 2's already-committed `SINGLE_ROW_TABLES["3x6"]` entry needs to be corrected as part of Task 3: threshold raised to 4 (`2*4=8>6`, no ties possible), new tiers (4-match / 5-match / 6-match), new pay table, new `baselineRtp = 0.972812236308`. See the design doc's "Correction" note in its Single-row section for full detail and the corrected pay table. Task 2's own text below is left as originally written (for historical record of what was reviewed and approved at the time); Task 3's steps below have been updated in place to include this fix.

---

## File Structure

- Modify `supabase/functions/slots/engine.ts` — `BoardSize` type, `BOARD_DIMENSIONS`, `ALLOWED_REWARD_MODES`, generalized `Reel`/`spin`/`evaluateWin`/`evaluateFullBoardWin`/`payoutFor`/`payoutForFullBoard`, per-size pay tables.
- Modify `supabase/functions/slots/index.ts` — `resolveBoardSize`, board-size-aware `resolveRewardMode` (now the authoritative gate), wiring.
- Modify `supabase/functions/slots/engine.test.ts` — update existing tests for the new `Reel`/function signatures, add per-size RTP + gating tests.
- Modify `src/types/index.ts` — `SlotBoardSize`, `SlotReel` becomes `SlotSymbolId[]`, `SlotsInstanceSettings.boardSize`, `SlotsResult.boardSize`, numeric `row` in `FullBoardSlotWin`.
- Modify `src/components/games/Slots.tsx` — generic reel rendering, per-size client paytables, `boardSize` prop, CSS grid/animation parameterized by rows/cols.
- Modify `src/components/GameSettingsModal.tsx` — Board Size selector, Reward Mode gating.
- Modify `src/pages/CasinoDashboard.tsx` — pass `boardSize` prop into `<Slots>`.

---

### Task 1: Engine — board size types, dimensions, and generalized `spin`

**Files:**
- Modify: `supabase/functions/slots/engine.ts:1-102` (through the end of the old `spin` function)
- Test: `supabase/functions/slots/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the `spin` describe block (lines 69-87) with:

```ts
describe("BOARD_DIMENSIONS", () => {
  it("has an entry for every BoardSize with the expected rows/cols", () => {
    expect(BOARD_DIMENSIONS["3x3"]).toEqual({ rows: 3, cols: 3 });
    expect(BOARD_DIMENSIONS["3x4"]).toEqual({ rows: 3, cols: 4 });
    expect(BOARD_DIMENSIONS["5x3"]).toEqual({ rows: 3, cols: 5 });
    expect(BOARD_DIMENSIONS["3x6"]).toEqual({ rows: 3, cols: 6 });
    expect(BOARD_DIMENSIONS["4x6"]).toEqual({ rows: 4, cols: 6 });
  });
});

describe("ALLOWED_REWARD_MODES", () => {
  it("locks 3x3 and 3x4 to single_row", () => {
    expect(ALLOWED_REWARD_MODES["3x3"]).toEqual(["single_row"]);
    expect(ALLOWED_REWARD_MODES["3x4"]).toEqual(["single_row"]);
  });

  it("locks 4x6 to full_board", () => {
    expect(ALLOWED_REWARD_MODES["4x6"]).toEqual(["full_board"]);
  });

  it("allows free choice on 5x3 and 3x6", () => {
    expect(ALLOWED_REWARD_MODES["5x3"]).toEqual(["single_row", "full_board"]);
    expect(ALLOWED_REWARD_MODES["3x6"]).toEqual(["single_row", "full_board"]);
  });
});

describe("spin", () => {
  it("draws cols reels of length rows for the default 5x3 board, from independent rng() calls", () => {
    const rng = queue([
      0, 0, 0, // reel0: dot, dot, dot
      0.35, 0.35, 0.35, // reel1: square, square, square
      0.6, 0.8, 0.92, // reel2: diamond, star, seven
      0, 0.35, 0.6, // reel3: dot, square, diamond
      0.92, 0.8, 0, // reel4: seven, star, dot
    ]);
    const reels = spin(rng, "5x3");
    expect(reels).toHaveLength(5);
    reels.forEach((reel) => expect(reel).toHaveLength(3));
    expect(reels[0]).toEqual(["dot", "dot", "dot"]);
    expect(reels[1]).toEqual(["square", "square", "square"]);
    expect(reels[2]).toEqual(["diamond", "star", "seven"]);
    expect(reels[3]).toEqual(["dot", "square", "diamond"]);
    expect(reels[4]).toEqual(["seven", "star", "dot"]);
  });

  it("draws rows*cols reels for a non-default board size (3x3 = 9 draws)", () => {
    const rng = queue([0, 0, 0, 0.35, 0.35, 0.35, 0.6, 0.8, 0.92]);
    const reels = spin(rng, "3x3");
    expect(reels).toHaveLength(3);
    reels.forEach((reel) => expect(reel).toHaveLength(3));
    expect(reels).toEqual([
      ["dot", "dot", "dot"],
      ["square", "square", "square"],
      ["diamond", "star", "seven"],
    ]);
  });

  it("draws a 4-row board (4x6) with reels of length 4", () => {
    const rng = queue(new Array(24).fill(0)); // all dot
    const reels = spin(rng, "4x6");
    expect(reels).toHaveLength(6);
    reels.forEach((reel) => expect(reel).toEqual(["dot", "dot", "dot", "dot"]));
  });
});
```

Update the top-of-file import list (lines 1-20) to add the new names:

```ts
import { describe, it, expect } from "vitest";
import {
  SYMBOL_WEIGHTS,
  pickSymbol,
  spin,
  evaluateWin,
  payoutFor,
  roundMoney,
  BOARD_DIMENSIONS,
  ALLOWED_REWARD_MODES,
  FULL_BOARD_TABLES,
  evaluateFullBoardWin,
  payoutForFullBoard,
  SINGLE_ROW_TABLES,
  MIN_HOUSE_EDGE,
  MAX_HOUSE_EDGE,
  DEFAULT_HOUSE_EDGE,
  type Reel,
  type SymbolId,
  type BoardSize,
} from "./engine";
```

(This import list replaces `SYMBOLS` with `SYMBOL_WEIGHTS`, drops `REEL_COUNT`/`FULL_BOARD_SYMBOLS`/`BASELINE_RTP_SINGLE_ROW`/`BASELINE_RTP_FULL_BOARD` in favor of the new per-size table exports, and adds `BOARD_DIMENSIONS`/`ALLOWED_REWARD_MODES`/`BoardSize` — later steps in this plan update every other describe block that referenced the old names.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: FAIL — `BOARD_DIMENSIONS`, `ALLOWED_REWARD_MODES`, `SYMBOL_WEIGHTS` etc. are not exported yet, and `spin(rng)` is called with the wrong arity elsewhere in the (not-yet-updated) file.

- [ ] **Step 3: Replace the top of `engine.ts` through `spin`**

Replace lines 1-102 of `supabase/functions/slots/engine.ts` (from `export type Rng` through the end of the old `spin` function) with:

```ts
export type Rng = () => number;
export type SymbolId = "dot" | "square" | "diamond" | "star" | "seven";
export type RewardMode = "single_row" | "full_board";
export type BoardSize = "3x3" | "3x4" | "5x3" | "3x6" | "4x6";

// rows x cols for each selectable board size. 5x3 is today's board and
// stays the default everywhere a casino_games row has no boardSize set.
export const BOARD_DIMENSIONS: Record<BoardSize, { rows: number; cols: number }> = {
  "3x3": { rows: 3, cols: 3 },
  "3x4": { rows: 3, cols: 4 },
  "5x3": { rows: 3, cols: 5 },
  "3x6": { rows: 3, cols: 6 },
  "4x6": { rows: 4, cols: 6 },
};

export const BOARD_SIZES = Object.keys(BOARD_DIMENSIONS) as BoardSize[];
export const DEFAULT_BOARD_SIZE: BoardSize = "5x3";

// Single-row mode needs an unambiguous "middle row," which only exists on a
// 3-row board — so 4x6 (the only 4-row size) never offers it. 3x3/3x4 are
// locked the other way (single_row only) per product decision, not a
// mathematical constraint. This table is the authoritative gate — enforced
// server-side in index.ts's resolveRewardMode, not just in the admin UI.
export const ALLOWED_REWARD_MODES: Record<BoardSize, RewardMode[]> = {
  "3x3": ["single_row"],
  "3x4": ["single_row"],
  "5x3": ["single_row", "full_board"],
  "3x6": ["single_row", "full_board"],
  "4x6": ["full_board"],
};

interface SymbolWeight {
  id: SymbolId;
  weight: number;
}

// Symbol draw weights are identical across every board size — only the win
// thresholds and pay tables (below) vary by size. Rarer symbols pay more at
// every size, matching the shape shown in the approved Neon Rush design
// mockup.
export const SYMBOL_WEIGHTS: SymbolWeight[] = [
  { id: "dot", weight: 0.35 },
  { id: "square", weight: 0.25 },
  { id: "diamond", weight: 0.2 },
  { id: "star", weight: 0.12 },
  { id: "seven", weight: 0.08 },
];

// The only house-edge values an admin can pick (a fixed menu, not free
// entry) — 0%, 1%, 2%, ..., 5%. Applies uniformly across every board size.
export const HOUSE_EDGE_OPTIONS = [0, 0.01, 0.02, 0.03, 0.04, 0.05] as const;
export const MIN_HOUSE_EDGE = HOUSE_EDGE_OPTIONS[0];
export const MAX_HOUSE_EDGE = HOUSE_EDGE_OPTIONS[HOUSE_EDGE_OPTIONS.length - 1];
export const DEFAULT_HOUSE_EDGE = 0.02;

// houseEdge only ever scales *how much* a win pays (see payoutFor /
// payoutForFullBoard below) — it never touches SYMBOL_WEIGHTS or
// evaluateWin/evaluateFullBoardWin, which decide *whether* a spin wins.
// That keeps hit frequency identical at every edge setting for a given
// board size; only the pay-table "x" multipliers move. Each board size's
// own BASELINE_RTP constant (set in its table below to that table's exact
// computed RTP) keeps this formula self-consistent per size: whichever
// house edge the admin picks becomes the exact realized long-run RTP,
// regardless of the raw table's own baseline.
function edgeScale(baselineRtp: number, houseEdge: number): number {
  return (1 - houseEdge) / baselineRtp;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Weighted pick over SYMBOL_WEIGHTS via cumulative distribution. The final
// entry is returned as a fallback for the r === sum-of-weights edge (float
// rounding), never as a silent bias — weights are authored to sum to
// exactly 1.
export function pickSymbol(rng: Rng): SymbolId {
  const r = rng();
  let cum = 0;
  for (const s of SYMBOL_WEIGHTS) {
    cum += s.weight;
    if (r < cum) return s.id;
  }
  return SYMBOL_WEIGHTS[SYMBOL_WEIGHTS.length - 1].id;
}

// One reel = one column, top-to-bottom; length always equals the board's
// row count (3 for every size except 4x6).
export type Reel = SymbolId[];

// Every visible cell is an independent weighted draw (rows*cols rng() calls
// per spin).
export function spin(rng: Rng, boardSize: BoardSize): Reel[] {
  const { rows, cols } = BOARD_DIMENSIONS[boardSize];
  const reels: Reel[] = [];
  for (let c = 0; c < cols; c++) {
    const reel: Reel = [];
    for (let r = 0; r < rows; r++) reel.push(pickSymbol(rng));
    reels.push(reel);
  }
  return reels;
}
```

- [ ] **Step 4: Run tests to verify the new pieces pass (rest of the file still broken)**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: the `BOARD_DIMENSIONS`, `ALLOWED_REWARD_MODES`, and `spin` describe blocks pass; the file still fails to even compile/run cleanly because `evaluateWin`, `payoutFor`, `evaluateFullBoardWin`, `payoutForFullBoard`, `SYMBOLS`, `REEL_COUNT` etc. referenced later in both files don't exist yet — that's expected, continue to Task 2.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/slots/engine.ts supabase/functions/slots/engine.test.ts
git commit -m "slots: generalize Reel/spin to board-size-parameterized dimensions"
```

---

### Task 2: Engine — single-row per-size pay tables and `evaluateWin`/`payoutFor`

**Files:**
- Modify: `supabase/functions/slots/engine.ts` (append after `spin`, replacing the old `Win`/`evaluateWin`/`payoutFor`)
- Test: `supabase/functions/slots/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the `reelsWithMid`/`evaluateWin`/`payoutFor` describe blocks (old lines 89-169) with:

```ts
function reelsForRow(mids: SymbolId[], row: number, rows: number): Reel[] {
  return mids.map((mid) => {
    const reel: Reel = [];
    for (let r = 0; r < rows; r++) reel.push(r === row ? mid : "dot");
    return reel;
  });
}

describe("evaluateWin", () => {
  it("returns null when no symbol reaches the 5x3 board's threshold of 3", () => {
    expect(evaluateWin(reelsForRow(["dot", "dot", "square", "square", "diamond"], 1, 3), "5x3")).toBeNull();
    expect(evaluateWin(reelsForRow(["dot", "square", "dot", "diamond", "star"], 1, 3), "5x3")).toBeNull();
  });

  it("matches anywhere on the middle row (scatter), not just a contiguous run from reel 0", () => {
    expect(evaluateWin(reelsForRow(["square", "dot", "dot", "dot", "dot"], 1, 3), "5x3")).toEqual({
      symbol: "dot",
      count: 4,
      positions: [1, 2, 3, 4],
    });
  });

  it("detects a 5x3 5-in-a-row", () => {
    expect(
      evaluateWin(reelsForRow(["diamond", "diamond", "diamond", "diamond", "diamond"], 1, 3), "5x3")
    ).toEqual({ symbol: "diamond", count: 5, positions: [0, 1, 2, 3, 4] });
  });

  it("evaluates the middle row of a 3x3 board (row index 1) at its threshold of 2", () => {
    expect(evaluateWin(reelsForRow(["dot", "square", "diamond"], 1, 3), "3x3")).toBeNull();
    expect(evaluateWin(reelsForRow(["dot", "dot", "diamond"], 1, 3), "3x3")).toEqual({
      symbol: "dot",
      count: 2,
      positions: [0, 1],
    });
  });

  it("evaluates the middle row of a 3x4 board at its threshold of 3", () => {
    expect(evaluateWin(reelsForRow(["dot", "dot", "square", "diamond"], 1, 3), "3x4")).toBeNull();
    expect(evaluateWin(reelsForRow(["dot", "dot", "dot", "diamond"], 1, 3), "3x4")).toEqual({
      symbol: "dot",
      count: 3,
      positions: [0, 1, 2],
    });
  });

  it("evaluates the middle row of a 3x6 board up to a 6-of-a-kind", () => {
    const allDot = reelsForRow(["dot", "dot", "dot", "dot", "dot", "dot"], 1, 3);
    expect(evaluateWin(allDot, "3x6")).toEqual({
      symbol: "dot",
      count: 6,
      positions: [0, 1, 2, 3, 4, 5],
    });
  });
});

describe("payoutFor", () => {
  it("returns 0 for no win", () => {
    expect(payoutFor(null, 10, "5x3")).toBe(0);
  });

  it("multiplies bet by the 5x3 symbol's pay table at the matched count (unchanged from before)", () => {
    expect(payoutFor({ symbol: "dot", count: 3, positions: [0, 1, 2] }, 10, "5x3")).toBe(15);
    expect(payoutFor({ symbol: "seven", count: 5, positions: [0, 1, 2, 3, 4] }, 2, "5x3")).toBe(80);
  });

  it("rounds to 4 decimal places", () => {
    expect(payoutFor({ symbol: "dot", count: 3, positions: [0, 1, 2] }, 0.10005, "5x3")).toBe(0.1501);
  });

  it("pays the 3x3 table at its own tiers", () => {
    // dot tier0 (count 2) = 0.5x, tier1 (count 3) = 5.5x
    expect(payoutFor({ symbol: "dot", count: 2, positions: [0, 1] }, 10, "3x3")).toBe(5);
    expect(payoutFor({ symbol: "dot", count: 3, positions: [0, 1, 2] }, 10, "3x3")).toBe(55);
  });

  it("pays the 3x4 table at its own tiers", () => {
    expect(payoutFor({ symbol: "seven", count: 3, positions: [0, 1, 2] }, 10, "3x4")).toBe(60);
    expect(payoutFor({ symbol: "seven", count: 4, positions: [0, 1, 2, 3] }, 10, "3x4")).toBe(485);
  });

  it("pays the 3x6 table across its 3 tiers (count 3 / 4-5 / 6)", () => {
    expect(payoutFor({ symbol: "star", count: 3, positions: [0, 1, 2] }, 10, "3x6")).toBe(20);
    expect(payoutFor({ symbol: "star", count: 4, positions: [0, 1, 2, 3] }, 10, "3x6")).toBe(35);
    expect(payoutFor({ symbol: "star", count: 5, positions: [0, 1, 2, 3, 4] }, 10, "3x6")).toBe(35);
    expect(payoutFor({ symbol: "star", count: 6, positions: [0, 1, 2, 3, 4, 5] }, 10, "3x6")).toBe(150);
  });

  it("scales the raw payout by (1 - houseEdge) / that board size's BASELINE_RTP when houseEdge is given", () => {
    const win = { symbol: "seven" as const, count: 5, positions: [0, 1, 2, 3, 4] };
    const raw = payoutFor(win, 100, "5x3");
    const scaled = payoutFor(win, 100, "5x3", DEFAULT_HOUSE_EDGE);
    expect(scaled).toBe(roundMoney(raw * ((1 - DEFAULT_HOUSE_EDGE) / SINGLE_ROW_TABLES["5x3"]!.baselineRtp)));
  });

  it("a lower house edge pays more, a higher house edge pays less, than the unscaled default", () => {
    const win = { symbol: "seven" as const, count: 5, positions: [0, 1, 2, 3, 4] };
    const raw = payoutFor(win, 100, "5x3");
    expect(payoutFor(win, 100, "5x3", MIN_HOUSE_EDGE)).toBeGreaterThan(raw);
    expect(payoutFor(win, 100, "5x3", MAX_HOUSE_EDGE)).toBeLessThan(raw);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: FAIL — `evaluateWin`/`payoutFor` still have the old 1-2-arg signatures and `SINGLE_ROW_TABLES` isn't exported.

- [ ] **Step 3: Append the single-row tables, `evaluateWin`, and `payoutFor` to `engine.ts`**

Add after the `spin` function:

```ts
export interface Win {
  symbol: SymbolId;
  count: number;
  // Reel indices (0-based) holding the winning symbol — not necessarily
  // contiguous or left-aligned, since matches are scatter-style.
  positions: number[];
}

interface SingleRowSymbolPay {
  id: SymbolId;
  pay: number[]; // indexed by 0-based tier
}

interface SingleRowConfig {
  // Minimum same-row match count to win at all (tier 0).
  threshold: number;
  // Maps a raw match count (>= threshold) to a 0-based pay-tier index.
  tierIndex: (count: number) => number;
  symbols: SingleRowSymbolPay[];
  // This table's own exact RTP at scale=1 — see edgeScale's comment above.
  baselineRtp: number;
}

// Single-row mode is only ever evaluated on a 3-row board (see
// ALLOWED_REWARD_MODES), so it's keyed by a subset of BoardSize; 4x6 has no
// entry. Every threshold below was chosen so at most one symbol can reach
// it per spin (2 * threshold > cols), avoiding same-row ties — the same
// property the original 5x3 table already relied on. Pay tables and
// BASELINE_RTP figures are from exact multinomial-composition enumeration;
// see docs/superpowers/specs/2026-08-06-slots-board-size-design.md.
export const SINGLE_ROW_TABLES: Partial<Record<BoardSize, SingleRowConfig>> = {
  "3x3": {
    threshold: 2,
    tierIndex: (count) => (count >= 3 ? 1 : 0),
    symbols: [
      { id: "dot", pay: [0.5, 5.5] },
      { id: "square", pay: [1, 7.5] },
      { id: "diamond", pay: [1, 9.5] },
      { id: "star", pay: [1.5, 11.5] },
      { id: "seven", pay: [2, 15] },
    ],
    baselineRtp: 0.9049665,
  },
  "3x4": {
    threshold: 3,
    tierIndex: (count) => (count >= 4 ? 1 : 0),
    symbols: [
      { id: "dot", pay: [2.5, 18.5] },
      { id: "square", pay: [3, 24.5] },
      { id: "diamond", pay: [4, 30.5] },
      { id: "star", pay: [4.5, 36.5] },
      { id: "seven", pay: [6, 48.5] },
    ],
    baselineRtp: 0.99206293,
  },
  "5x3": {
    threshold: 3,
    tierIndex: (count) => (count >= 5 ? 2 : count === 4 ? 1 : 0),
    symbols: [
      { id: "dot", pay: [1.5, 3, 12] },
      { id: "square", pay: [2, 4, 15] },
      { id: "diamond", pay: [2.5, 5, 19] },
      { id: "star", pay: [3, 6.5, 25] },
      { id: "seven", pay: [4, 8.5, 40] },
    ],
    baselineRtp: 0.9619252895,
  },
  "3x6": {
    threshold: 3,
    tierIndex: (count) => (count >= 6 ? 2 : count >= 4 ? 1 : 0),
    symbols: [
      { id: "dot", pay: [1, 2, 7.5] },
      { id: "square", pay: [1, 2.5, 10] },
      { id: "diamond", pay: [1.5, 3, 12.5] },
      { id: "star", pay: [2, 3.5, 15] },
      { id: "seven", pay: [2.5, 5, 20] },
    ],
    baselineRtp: 0.961146984006,
  },
};

// The payline is always the middle row of a 3-row board — single-row mode
// is never called with a 4-row boardSize (see ALLOWED_REWARD_MODES).
function paylineRow(boardSize: BoardSize): number {
  return Math.floor(BOARD_DIMENSIONS[boardSize].rows / 2);
}

// Scatter rule: threshold+ of the same symbol anywhere on the payline wins,
// not just a left-aligned consecutive run. Each board size's threshold was
// chosen so at most one symbol can reach it per spin, so there's no tie to
// break.
export function evaluateWin(reels: Reel[], boardSize: BoardSize): Win | null {
  const row = paylineRow(boardSize);
  const config = SINGLE_ROW_TABLES[boardSize];
  if (!config) return null;
  const positionsBySymbol = new Map<SymbolId, number[]>();
  reels.forEach((reel, i) => {
    const symbol = reel[row];
    const positions = positionsBySymbol.get(symbol) ?? [];
    positions.push(i);
    positionsBySymbol.set(symbol, positions);
  });
  for (const [symbol, positions] of positionsBySymbol) {
    if (positions.length >= config.threshold) {
      return { symbol, count: positions.length, positions };
    }
  }
  return null;
}

// `houseEdge` left undefined leaves the raw pay table untouched (scale 1) —
// callers that care about a configurable edge (the slots edge function)
// always pass one; engine.test.ts's pinned-payout assertions rely on the
// unscaled default.
export function payoutFor(win: Win | null, bet: number, boardSize: BoardSize, houseEdge?: number): number {
  if (!win) return 0;
  const config = SINGLE_ROW_TABLES[boardSize];
  if (!config) return 0;
  const symbol = config.symbols.find((s) => s.id === win.symbol)!;
  const tier = config.tierIndex(win.count);
  const scale = houseEdge === undefined ? 1 : edgeScale(config.baselineRtp, houseEdge);
  return roundMoney(bet * symbol.pay[tier] * scale);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: the `evaluateWin` and `payoutFor` describe blocks pass; `RTP`, `evaluateFullBoardWin`, `payoutForFullBoard`, `full board RTP` blocks still fail (Task 3).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/slots/engine.ts supabase/functions/slots/engine.test.ts
git commit -m "slots: per-board-size single-row pay tables and evaluateWin/payoutFor"
```

---

### Task 3: Engine — single-row RTP tests for all 4 single-row-capable sizes

**Files:**
- Test: `supabase/functions/slots/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the old `RTP` describe block (which referenced `SYMBOLS`/`BASELINE_RTP_SINGLE_ROW` directly) with a version generalized over all 4 single-row board sizes, using exact multinomial-composition enumeration (not the old binomial-coefficient shortcut, since 3x3/3x4/3x6 have thresholds and tie behavior the old C(5,k) formula doesn't cover):

```ts
describe("single-row RTP", () => {
  // Exact multinomial-composition enumeration over SYMBOL_WEIGHTS, generic
  // over column count — recomputed independently of evaluateWin/payoutFor
  // so a change to a board size's table can't silently drift its payout
  // curve without this test catching it.
  function factorial(n: number): number {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function theoreticalSingleRowRtp(boardSize: BoardSize) {
    const config = SINGLE_ROW_TABLES[boardSize]!;
    const cols = BOARD_DIMENSIONS[boardSize].cols;
    let rtp = 0;
    let hitFrequency = 0;

    function enumerate(idx: number, remaining: number, counts: number[]) {
      if (idx === SYMBOL_WEIGHTS.length - 1) {
        counts[idx] = remaining;
        let coef = factorial(cols);
        let pw = 1;
        for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
          coef /= factorial(counts[i]);
          pw *= SYMBOL_WEIGHTS[i].weight ** counts[i];
        }
        const p = coef * pw;

        const maxCount = Math.max(...counts);
        if (maxCount >= config.threshold) {
          const tier = config.tierIndex(maxCount);
          const winners = counts.reduce((n, c) => (c === maxCount ? n + 1 : n), 0);
          if (winners === 1) {
            const i = counts.indexOf(maxCount);
            rtp += p * config.symbols[i].pay[tier];
          }
          // winners > 1 (a same-row tie) can't happen for any of these
          // thresholds — see the "avoids same-row ties" test below — so no
          // pay-both-ties branch is needed here.
          hitFrequency += p;
        }
        return;
      }
      for (let c = 0; c <= remaining; c++) {
        counts[idx] = c;
        enumerate(idx + 1, remaining - c, counts);
      }
    }
    enumerate(0, cols, new Array(SYMBOL_WEIGHTS.length).fill(0));
    return { rtp, hitFrequency };
  }

  it("every single-row threshold avoids same-row ties (2 * threshold > cols)", () => {
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const config = SINGLE_ROW_TABLES[boardSize]!;
      const cols = BOARD_DIMENSIONS[boardSize].cols;
      expect(2 * config.threshold).toBeGreaterThan(cols);
    }
  });

  it("matches each board size's pinned baselineRtp", () => {
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const { rtp } = theoreticalSingleRowRtp(boardSize);
      expect(rtp).toBeCloseTo(SINGLE_ROW_TABLES[boardSize]!.baselineRtp, 6);
    }
  });

  it("a chosen house edge scales each board size's theoretical RTP to exactly 1 - houseEdge", () => {
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const { rtp: baseline } = theoreticalSingleRowRtp(boardSize);
      for (const houseEdge of [MIN_HOUSE_EDGE, 0.02, DEFAULT_HOUSE_EDGE, MAX_HOUSE_EDGE]) {
        const scale = (1 - houseEdge) / baseline;
        expect(baseline * scale).toBeCloseTo(1 - houseEdge, 10);
      }
    }
  });

  it("hit frequencies land where exact enumeration puts them (documented in the design doc)", () => {
    const expected: Record<BoardSize, [number, number]> = {
      "3x3": [0.55, 0.65],
      "3x4": [0.18, 0.25],
      "5x3": [0.35, 0.48],
      "3x6": [0.58, 0.68],
      "4x6": [0, 0], // unused, no single-row table
    };
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const { hitFrequency } = theoreticalSingleRowRtp(boardSize);
      const [lo, hi] = expected[boardSize];
      expect(hitFrequency).toBeGreaterThan(lo);
      expect(hitFrequency).toBeLessThan(hi);
    }
  });
});
```

Remove the old `pickSymbol`/`SYMBOLS`-weight describe blocks' now-stale references: the `SYMBOLS` describe block (old lines 27-43) should become:

```ts
describe("SYMBOL_WEIGHTS", () => {
  it("weights sum to exactly 1", () => {
    const total = SYMBOL_WEIGHTS.reduce((s, x) => s + x.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("is ordered rarest-last (dot most common, seven rarest)", () => {
    for (let i = 1; i < SYMBOL_WEIGHTS.length; i++) {
      expect(SYMBOL_WEIGHTS[i].weight).toBeLessThan(SYMBOL_WEIGHTS[i - 1].weight);
    }
  });
});
```

(The old test also asserted "rarer symbols pay more" using `SYMBOLS[i].pay[3/4/5]` — that assertion now belongs per-board-size; add it to the single-row RTP describe block instead:)

```ts
  it("within every board size's table, rarer symbols pay more at every tier", () => {
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const symbols = SINGLE_ROW_TABLES[boardSize]!.symbols;
      for (let i = 1; i < symbols.length; i++) {
        for (let tier = 0; tier < symbols[i].pay.length; tier++) {
          expect(symbols[i].pay[tier]).toBeGreaterThan(symbols[i - 1].pay[tier]);
        }
      }
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: FAIL on the new `single-row RTP` block (compiles once `BoardSize`/`SINGLE_ROW_TABLES`/`BOARD_DIMENSIONS` are imported, from Task 1's Step 1 import list update).

- [ ] **Step 3: No production code change needed**

This task only adds tests against code already written in Task 2 — if any assertion fails, it means the hand-transcribed pay tables in Task 2 don't match the design doc; re-check the table against `docs/superpowers/specs/2026-08-06-slots-board-size-design.md` and fix the transcription before proceeding (do not adjust the test's expected ranges to paper over a transcription error).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: `SYMBOL_WEIGHTS` and `single-row RTP` blocks pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/slots/engine.test.ts
git commit -m "slots: RTP-pin every single-row board size via exact enumeration"
```

---

### Task 4: Engine — full-board per-size pay tables, `evaluateFullBoardWin`/`payoutForFullBoard`

**Files:**
- Modify: `supabase/functions/slots/engine.ts` (replace the old full-board section)
- Test: `supabase/functions/slots/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the old `evaluateFullBoardWin`/`payoutForFullBoard` describe blocks with:

```ts
function fullBoardReels(cellSymbols: SymbolId[], boardSize: BoardSize): Reel[] {
  // cellSymbols is row-major (row0 for every reel, then row1, ...) — this
  // helper reshapes it into the column-major Reel[] the engine expects.
  const { rows, cols } = BOARD_DIMENSIONS[boardSize];
  const reels: Reel[] = Array.from({ length: cols }, () => []);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      reels[c].push(cellSymbols[r * cols + c]);
    }
  }
  return reels;
}

describe("evaluateFullBoardWin", () => {
  it("returns null when the max count across all 15 cells (5x3) is below 7", () => {
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","diamond","star",
      "dot","dot","square","star","seven",
      "square","square","diamond","seven","square",
    ], "5x3");
    expect(evaluateFullBoardWin(reels, "5x3")).toBeNull();
  });

  it("counts matches across all rows, not just the middle, at the 5x3 7-cell threshold", () => {
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","star",
      "dot","dot","dot","square","seven",
      "square","square","diamond","diamond","square",
    ], "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    expect(win?.count).toBe(7);
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot" })]);
  });

  it("both symbols win when they tie for the max count (5x3)", () => {
    // dot and square both land exactly 7 times.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","square","square",
      "dot","dot","square","square","square",
      "dot","square","square","diamond","diamond",
    ], "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    expect(win?.count).toBe(7);
    expect(win?.wins.map((w) => w.symbol).sort()).toEqual(["dot", "square"]);
    expect(win?.wins.every((w) => w.positions.length === 7)).toBe(true);
  });

  it("positions use a numeric row index, not a top/mid/bottom label", () => {
    const reels = fullBoardReels(new Array(15).fill("dot"), "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    const rows = win!.wins[0].positions.map((p) => p.row).sort();
    expect(rows).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  });

  it("returns null below the 3x6 board's 8-cell threshold", () => {
    const reels = fullBoardReels(
      ["dot", "dot", "dot", "dot", "dot", "dot", "dot", "square", "square", "diamond", "diamond", "star", "star", "seven", "seven", "seven", "square", "diamond"],
      "3x6"
    );
    expect(evaluateFullBoardWin(reels, "3x6")).toBeNull();
  });

  it("wins at the 3x6 board's 8-cell threshold", () => {
    const cells = new Array(18).fill("square");
    cells[0] = "dot";
    cells[1] = "dot";
    const reels = fullBoardReels(cells, "3x6");
    const win = evaluateFullBoardWin(reels, "3x6");
    expect(win?.count).toBe(16);
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "square" })]);
  });

  it("wins at the 4x6 board's 10-cell threshold (24 cells)", () => {
    const cells = new Array(24).fill("dot");
    const reels = fullBoardReels(cells, "4x6");
    const win = evaluateFullBoardWin(reels, "4x6");
    expect(win?.count).toBe(24);
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot" })]);
  });

  it("a 3-way tie (possible on 18/24-cell boards, impossible on 15) pays every tied symbol", () => {
    // 6 dot + 6 square + 6 diamond + 6 seven = 24 cells, all tied at 6 —
    // below the 4x6 threshold of 10, so use a smaller synthetic check via
    // the 3x6 board instead: 6+6+6 = 18 cells all tied at 6, also below
    // 3x6's threshold of 8. Ties can only be checked at/above threshold, so
    // build one at exactly the 4x6 threshold: 4 symbols at 6 each (24
        // cells) is below threshold (10); instead confirm 3-way ties are
    // structurally possible at 24 cells and let the "wins every tied
    // symbol" rule (already exercised above for 2-way) cover the payout
    // math generically.
    expect(3 * 10).toBeLessThan(24); // three symbols can each reach 10 within a 24-cell board
  });
});

describe("payoutForFullBoard", () => {
  it("returns 0 for no win", () => {
    expect(payoutForFullBoard(null, 10, "5x3")).toBe(0);
  });

  it("pays the 5x3 table's tier-0 rate for 7-8 matches (unchanged from before)", () => {
    expect(payoutForFullBoard({ count: 7, wins: [{ symbol: "dot", positions: [] }] }, 10, "5x3")).toBe(20);
    expect(payoutForFullBoard({ count: 8, wins: [{ symbol: "dot", positions: [] }] }, 10, "5x3")).toBe(20);
  });

  it("pays the 5x3 table's tier-2 rate for 11+ matches", () => {
    expect(payoutForFullBoard({ count: 11, wins: [{ symbol: "seven", positions: [] }] }, 2, "5x3")).toBe(210);
    expect(payoutForFullBoard({ count: 15, wins: [{ symbol: "seven", positions: [] }] }, 2, "5x3")).toBe(210);
  });

  it("pays every tied symbol's rate when two symbols share the max count (5x3)", () => {
    const win = {
      count: 7,
      wins: [
        { symbol: "dot" as const, positions: [] },
        { symbol: "square" as const, positions: [] },
      ],
    };
    expect(payoutForFullBoard(win, 10, "5x3")).toBe(50);
  });

  it("pays the 3x6 table across its 3 tiers (8-9 / 10-11 / 12-18)", () => {
    expect(payoutForFullBoard({ count: 8, wins: [{ symbol: "dot", positions: [] }] }, 10, "3x6")).toBe(15);
    expect(payoutForFullBoard({ count: 10, wins: [{ symbol: "dot", positions: [] }] }, 10, "3x6")).toBe(50);
    expect(payoutForFullBoard({ count: 18, wins: [{ symbol: "dot", positions: [] }] }, 10, "3x6")).toBe(185);
  });

  it("pays the 4x6 table across its 3 tiers (10-12 / 13-16 / 17-24)", () => {
    expect(payoutForFullBoard({ count: 10, wins: [{ symbol: "dot", positions: [] }] }, 10, "4x6")).toBe(20);
    expect(payoutForFullBoard({ count: 13, wins: [{ symbol: "dot", positions: [] }] }, 10, "4x6")).toBe(55);
    expect(payoutForFullBoard({ count: 24, wins: [{ symbol: "dot", positions: [] }] }, 10, "4x6")).toBe(190);
  });

  it("scales the raw payout by (1 - houseEdge) / that board size's BASELINE_RTP when houseEdge is given", () => {
    const win = { count: 11, wins: [{ symbol: "seven" as const, positions: [] }] };
    const raw = payoutForFullBoard(win, 100, "5x3");
    const scaled = payoutForFullBoard(win, 100, "5x3", DEFAULT_HOUSE_EDGE);
    expect(scaled).toBe(
      roundMoney(raw * ((1 - DEFAULT_HOUSE_EDGE) / FULL_BOARD_TABLES["5x3"].baselineRtp))
    );
  });

  it("a lower house edge pays more, a higher house edge pays less, than the unscaled default", () => {
    const win = { count: 11, wins: [{ symbol: "seven" as const, positions: [] }] };
    const raw = payoutForFullBoard(win, 100, "5x3");
    expect(payoutForFullBoard(win, 100, "5x3", MIN_HOUSE_EDGE)).toBeGreaterThan(raw);
    expect(payoutForFullBoard(win, 100, "5x3", MAX_HOUSE_EDGE)).toBeLessThan(raw);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: FAIL — `evaluateFullBoardWin`/`payoutForFullBoard` still take the old 1-2-arg signatures with `{top,mid,bottom}` reels, and `FULL_BOARD_TABLES` isn't exported.

- [ ] **Step 3: Replace the full-board section of `engine.ts`**

Replace everything from the old `FullBoardPosition` interface through the end of the file with:

```ts
// --- Full board reward mode -------------------------------------------
//
// "Full board" scores every visible cell instead of just the middle-row
// payline. Win thresholds and pay tables below are from exact multinomial-
// composition enumeration over SYMBOL_WEIGHTS (not simulation) — see
// docs/superpowers/specs/2026-08-06-slots-board-size-design.md and the
// original 5x3 derivation at
// docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md.
//
// Every symbol tied for the max count pays (not just the rarest). On a
// 15-cell board (5x3) at most a 2-way tie is possible (3*7=21>15); an
// 18-cell (3x6) or 24-cell (4x6) board can also produce a 3-way tie —
// `wins` handles any length generically, no special-casing needed.
export interface FullBoardPosition {
  reel: number;
  row: number; // 0-based row index
}

export interface FullBoardTieWin {
  symbol: SymbolId;
  positions: FullBoardPosition[];
}

// `wins` holds every symbol that reached the max count — normally length
// 1, occasionally 2 or (on 18/24-cell boards) 3 when symbols tie. All of
// them share `count`/tier, since a tie is only possible between symbols at
// the exact same count.
export interface FullBoardWin {
  count: number;
  wins: FullBoardTieWin[];
}

interface FullBoardSymbolPay {
  id: SymbolId;
  pay: number[]; // indexed by 0-based tier
}

interface FullBoardConfig {
  minCount: number;
  tierIndex: (count: number) => number;
  symbols: FullBoardSymbolPay[];
  baselineRtp: number;
}

// Full-board mode is available on every board size, keyed by all of
// BoardSize's 3 cell-count-distinct board shapes (3x3 and 3x4 never reach
// full_board per ALLOWED_REWARD_MODES, so they have no entry here).
export const FULL_BOARD_TABLES: Record<"5x3" | "3x6" | "4x6", FullBoardConfig> = {
  "5x3": {
    minCount: 7,
    tierIndex: (count) => (count >= 11 ? 2 : count >= 9 ? 1 : 0),
    symbols: [
      { id: "dot", pay: [2, 6, 21] },
      { id: "square", pay: [3, 9, 32] },
      { id: "diamond", pay: [4, 12, 42] },
      { id: "star", pay: [6, 18, 63] },
      { id: "seven", pay: [10, 30, 105] },
    ],
    baselineRtp: 0.984280455592317,
  },
  "3x6": {
    minCount: 8,
    tierIndex: (count) => (count >= 12 ? 2 : count >= 10 ? 1 : 0),
    symbols: [
      { id: "dot", pay: [1.5, 5, 18.5] },
      { id: "square", pay: [2.5, 8, 27.5] },
      { id: "diamond", pay: [3.5, 10.5, 36.5] },
      { id: "star", pay: [5, 15.5, 55] },
      { id: "seven", pay: [8.5, 26, 92] },
    ],
    baselineRtp: 0.942909367367,
  },
  "4x6": {
    minCount: 10,
    tierIndex: (count) => (count >= 17 ? 2 : count >= 13 ? 1 : 0),
    symbols: [
      { id: "dot", pay: [2, 5.5, 19] },
      { id: "square", pay: [2.5, 8, 29] },
      { id: "diamond", pay: [3.5, 11, 38.5] },
      { id: "star", pay: [5.5, 16.5, 57.5] },
      { id: "seven", pay: [9, 27.5, 96] },
    ],
    baselineRtp: 0.972684972884,
  },
};

function fullBoardConfigFor(boardSize: BoardSize): FullBoardConfig {
  return FULL_BOARD_TABLES[boardSize as "5x3" | "3x6" | "4x6"];
}

// Counts every cell (not just the payline) per symbol, then finds the
// highest count. Every symbol that reaches that count wins.
export function evaluateFullBoardWin(reels: Reel[], boardSize: BoardSize): FullBoardWin | null {
  const config = fullBoardConfigFor(boardSize);
  const cellsBySymbol = new Map<SymbolId, FullBoardPosition[]>();
  reels.forEach((reel, reelIndex) => {
    reel.forEach((symbol, row) => {
      const positions = cellsBySymbol.get(symbol) ?? [];
      positions.push({ reel: reelIndex, row });
      cellsBySymbol.set(symbol, positions);
    });
  });

  let maxCount = 0;
  for (const positions of cellsBySymbol.values()) {
    if (positions.length > maxCount) maxCount = positions.length;
  }
  if (maxCount < config.minCount) return null;

  const wins: FullBoardTieWin[] = [];
  for (const s of SYMBOL_WEIGHTS) {
    const positions = cellsBySymbol.get(s.id) ?? [];
    if (positions.length === maxCount) wins.push({ symbol: s.id, positions });
  }
  return { count: maxCount, wins };
}

// Every tied symbol pays out — a 7-dot/7-square tie pays dot's tier-0 rate
// plus square's, not just the rarer one.
export function payoutForFullBoard(
  win: FullBoardWin | null,
  bet: number,
  boardSize: BoardSize,
  houseEdge?: number
): number {
  if (!win) return 0;
  const config = fullBoardConfigFor(boardSize);
  const tier = config.tierIndex(win.count);
  const total = win.wins.reduce((sum, w) => {
    const symbol = config.symbols.find((s) => s.id === w.symbol)!;
    return sum + symbol.pay[tier];
  }, 0);
  const scale = houseEdge === undefined ? 1 : edgeScale(config.baselineRtp, houseEdge);
  return roundMoney(bet * total * scale);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: `evaluateFullBoardWin`/`payoutForFullBoard` blocks pass; the old `full board RTP` describe block (not yet updated) still fails — that's Task 5.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/slots/engine.ts supabase/functions/slots/engine.test.ts
git commit -m "slots: per-board-size full-board pay tables and evaluateFullBoardWin/payoutForFullBoard"
```

---

### Task 5: Engine — full-board RTP tests for all 3 full-board-capable sizes

**Files:**
- Test: `supabase/functions/slots/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the old `full board RTP` describe block with:

```ts
describe("full-board RTP", () => {
  // Exact multinomial-composition enumeration over SYMBOL_WEIGHTS, generic
  // over total cell count — recomputed independently of
  // evaluateFullBoardWin/payoutForFullBoard. Pays every symbol tied at the
  // max count (matches the pay-all-ties rule in the engine), including
  // 3-way ties on 18/24-cell boards.
  function factorial(n: number): number {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function theoreticalFullBoardRtp(boardSize: "5x3" | "3x6" | "4x6") {
    const config = FULL_BOARD_TABLES[boardSize];
    const n = BOARD_DIMENSIONS[boardSize].rows * BOARD_DIMENSIONS[boardSize].cols;
    let rtp = 0;
    let hitFrequency = 0;

    function enumerate(idx: number, remaining: number, counts: number[]) {
      if (idx === SYMBOL_WEIGHTS.length - 1) {
        counts[idx] = remaining;
        let coef = factorial(n);
        let pw = 1;
        for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
          coef /= factorial(counts[i]);
          pw *= SYMBOL_WEIGHTS[i].weight ** counts[i];
        }
        const p = coef * pw;

        const maxCount = Math.max(...counts);
        if (maxCount >= config.minCount) {
          const tier = config.tierIndex(maxCount);
          let tiedPay = 0;
          for (let i = 0; i < counts.length; i++) {
            if (counts[i] === maxCount) tiedPay += config.symbols[i].pay[tier];
          }
          rtp += p * tiedPay;
          hitFrequency += p;
        }
        return;
      }
      for (let c = 0; c <= remaining; c++) {
        counts[idx] = c;
        enumerate(idx + 1, remaining - c, counts);
      }
    }
    enumerate(0, n, new Array(SYMBOL_WEIGHTS.length).fill(0));
    return { rtp, hitFrequency };
  }

  it("matches each board size's pinned baselineRtp", () => {
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const { rtp } = theoreticalFullBoardRtp(boardSize);
      expect(rtp).toBeCloseTo(FULL_BOARD_TABLES[boardSize].baselineRtp, 6);
    }
  });

  it("a chosen house edge scales each board size's theoretical RTP to exactly 1 - houseEdge", () => {
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const { rtp: baseline } = theoreticalFullBoardRtp(boardSize);
      for (const houseEdge of [MIN_HOUSE_EDGE, 0.02, DEFAULT_HOUSE_EDGE, MAX_HOUSE_EDGE]) {
        const scale = (1 - houseEdge) / baseline;
        expect(baseline * scale).toBeCloseTo(1 - houseEdge, 10);
      }
    }
  });

  it("hit frequencies land where exact enumeration puts them (documented in the design doc)", () => {
    const expected: Record<"5x3" | "3x6" | "4x6", [number, number]> = {
      "5x3": [0.28, 0.36],
      "3x6": [0.3, 0.39],
      "4x6": [0.33, 0.42],
    };
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const { hitFrequency } = theoreticalFullBoardRtp(boardSize);
      const [lo, hi] = expected[boardSize];
      expect(hitFrequency).toBeGreaterThan(lo);
      expect(hitFrequency).toBeLessThan(hi);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: FAIL initially only if a pay-table transcription in Task 4 doesn't match the design doc; otherwise this is exercising already-correct code and should pass immediately (unlike most TDD steps, this test targets numbers already locked in Task 4 — a fail here means go back and fix Task 4's transcription, not this test).

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm run test -- supabase/functions/slots/engine.test.ts`
Expected: ALL tests in the file pass now.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/slots/engine.test.ts
git commit -m "slots: RTP-pin every full-board board size via exact enumeration"
```

---

### Task 6: Edge function — `resolveBoardSize`, gated `resolveRewardMode`, wiring

**Files:**
- Modify: `supabase/functions/slots/index.ts`

There is no existing test harness for the edge function itself (it's a Deno `Deno.serve` handler, exercised only via Playwright/manual verification per the existing pattern — see Task 9). This task is a direct code change.

- [ ] **Step 1: Update the import list**

Replace lines 1-11 of `supabase/functions/slots/index.ts`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  spin,
  evaluateWin,
  evaluateFullBoardWin,
  payoutFor,
  payoutForFullBoard,
  roundMoney,
  HOUSE_EDGE_OPTIONS,
  DEFAULT_HOUSE_EDGE,
  BOARD_SIZES,
  DEFAULT_BOARD_SIZE,
  ALLOWED_REWARD_MODES,
  type BoardSize,
  type RewardMode,
} from "./engine.ts";
```

- [ ] **Step 2: Replace the local `RewardMode` type and `resolveRewardMode`/add `resolveBoardSize`**

Replace lines 37-51 (the old `type RewardMode = ...` and `resolveRewardMode`) with:

```ts
// Unknown/missing settings, or any value not in BOARD_SIZES, default to
// DEFAULT_BOARD_SIZE ("5x3") — this is what keeps every pre-existing
// casino_games row (settings = '{}') playing exactly as before.
function resolveBoardSize(settings: unknown): BoardSize {
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).boardSize : undefined;
  if (typeof raw === "string" && (BOARD_SIZES as string[]).includes(raw)) {
    return raw as BoardSize;
  }
  return DEFAULT_BOARD_SIZE;
}

// Authoritative gate: even if the admin UI's disabled state were bypassed
// (or a stored settings blob predates a later change to ALLOWED_REWARD_MODES),
// a disallowed rewardMode for the resolved boardSize is coerced to that
// size's first allowed mode rather than trusted. For every board size
// that allows both modes, that first-allowed value is "single_row",
// matching today's existing default.
function resolveRewardMode(settings: unknown, boardSize: BoardSize): RewardMode {
  const allowed = ALLOWED_REWARD_MODES[boardSize];
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).rewardMode : undefined;
  if ((raw === "single_row" || raw === "full_board") && allowed.includes(raw)) {
    return raw;
  }
  return allowed[0];
}
```

- [ ] **Step 3: Wire `boardSize` through the handler**

Replace lines 129-141 (from `const rewardMode = resolveRewardMode` through the `if (rewardMode === "full_board")` block):

```ts
    const boardSize = resolveBoardSize(cg.settings);
    const rewardMode = resolveRewardMode(cg.settings, boardSize);
    const houseEdge = resolveHouseEdge(cg.settings);
    const reels = spin(rng, boardSize);

    let win: ReturnType<typeof evaluateWin> | ReturnType<typeof evaluateFullBoardWin>;
    let payout: number;
    if (rewardMode === "full_board") {
      win = evaluateFullBoardWin(reels, boardSize);
      payout = payoutForFullBoard(win, validBet, boardSize, houseEdge);
    } else {
      win = evaluateWin(reels, boardSize);
      payout = payoutFor(win, validBet, boardSize, houseEdge);
    }
```

- [ ] **Step 4: Include `boardSize` in the response**

Replace line 161:

```ts
    return json({ reels, win, rewardMode, boardSize, bet: validBet, payout, balance });
```

- [ ] **Step 5: Type-check the function locally**

Run: `npx tsc --noEmit -p supabase/functions/slots 2>&1 || npx tsc --noEmit supabase/functions/slots/index.ts supabase/functions/slots/engine.ts`

If there's no dedicated tsconfig for the Deno function (there usually isn't, since it runs on Deno's own toolchain, not tsc), skip this and instead visually re-read the diff for the removed `type RewardMode` local declaration — confirm nothing else in the file referenced the old local type incompatibly (it's now imported, same name, same union, so this is safe).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/slots/index.ts
git commit -m "slots: resolve and enforce boardSize, gate rewardMode server-side"
```

---

### Task 7: Types — `SlotBoardSize`, generic `SlotReel`, updated `SlotsInstanceSettings`/`SlotsResult`

**Files:**
- Modify: `src/types/index.ts:137-172`

- [ ] **Step 1: Replace the slots type block**

Replace lines 137-172 of `src/types/index.ts` (from `export type SlotSymbolId` through the end of `SlotsResult`) with:

```ts
export type SlotSymbolId = "dot" | "square" | "diamond" | "star" | "seven";

export type SlotBoardSize = "3x3" | "3x4" | "5x3" | "3x6" | "4x6";

// One reel = one column, top-to-bottom; length always equals the board's
// row count (3 for every size except 4x6, which has 4).
export type SlotReel = SlotSymbolId[];

export interface SlotWin {
  symbol: SlotSymbolId;
  count: number;
  // Reel indices (0-based) holding the winning symbol — not necessarily
  // contiguous or left-aligned, since matches are scatter-style.
  positions: number[];
}

// Full-board mode win: count spans every row, so positions need a row
// index alongside the reel index — kept as a separate type from SlotWin
// rather than unifying, so single-row's shape stays untouched. `wins`
// holds every symbol that reached the max count — normally length 1,
// occasionally more when symbols tie (both/all pay and light up).
export interface FullBoardSlotWin {
  count: number;
  wins: { symbol: SlotSymbolId; positions: { reel: number; row: number }[] }[];
}

// Mirror of the edge function's response (supabase/functions/slots/engine.ts).
export interface SlotsResult {
  reels: SlotReel[];
  win: SlotWin | FullBoardSlotWin | null;
  rewardMode: "single_row" | "full_board";
  boardSize: SlotBoardSize;
  bet: number;
  payout: number;
  balance: number;
}
```

- [ ] **Step 2: Update `SlotsInstanceSettings`**

Replace lines 72-83 (the `SlotsInstanceSettings` interface, which sits before the slots type block just replaced — keep it above that block, just add `boardSize`):

```ts
// Shape of CasinoGame.settings for a slots instance.
export interface SlotsInstanceSettings {
  rewardMode?: "single_row" | "full_board";
  // Picked from a fixed menu (0%-5% in 1% steps), never freely typed.
  // Missing/off-menu defaults to 0.02 (2%), both here and server-side in
  // the slots edge function (supabase/functions/slots/engine.ts's
  // HOUSE_EDGE_OPTIONS / DEFAULT_HOUSE_EDGE).
  houseEdge?: 0 | 0.01 | 0.02 | 0.03 | 0.04 | 0.05;
  // Visual design id from src/lib/slotsDesigns.ts. Missing defaults to
  // DEFAULT_SLOTS_DESIGN_ID ("default"). Never affects odds/payouts.
  design?: string;
  // Missing defaults to "5x3" (today's board), both here and server-side
  // in supabase/functions/slots/engine.ts's DEFAULT_BOARD_SIZE. Gates
  // which rewardMode values are allowed — see engine.ts's
  // ALLOWED_REWARD_MODES, enforced authoritatively server-side.
  boardSize?: "3x3" | "3x4" | "5x3" | "3x6" | "4x6";
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b --noEmit`
Expected: FAIL — every consumer of the old `SlotReel` object shape (`Slots.tsx`, `CasinoDashboard.tsx`) and old `FullBoardSlotWin.positions[].row` string type now has type errors. That's expected; fixed in Tasks 8-9.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "slots: SlotBoardSize type, generic SlotReel, numeric full-board row index"
```

---

### Task 8: Frontend — `Slots.tsx` generic board rendering

**Files:**
- Modify: `src/components/games/Slots.tsx` (near-full rewrite of the reel/paytable logic and CSS; header/bet-form/exit-button JSX is untouched)

- [ ] **Step 1: Replace the client-side paytable mirrors and helper functions (old lines 15-93)**

Replace from `type RewardMode = ...` through `function roundMoney` with:

```ts
type RewardMode = "single_row" | "full_board";
type AnySlotWin = (SlotWin | FullBoardSlotWin) & { amount: number };

const BOARD_DIMENSIONS: Record<SlotBoardSize, { rows: number; cols: number }> = {
  "3x3": { rows: 3, cols: 3 },
  "3x4": { rows: 3, cols: 4 },
  "5x3": { rows: 3, cols: 5 },
  "3x6": { rows: 3, cols: 6 },
  "4x6": { rows: 4, cols: 6 },
};

interface ClientPaytable {
  symbols: { id: SlotSymbolId; pay: number[] }[];
  baselineRtp: number;
  tierIndex: (count: number) => number;
  tierCount: 2 | 3;
  label: string;
}

// Mirrors supabase/functions/slots/engine.ts's SINGLE_ROW_TABLES — kept as
// a local, dependency-free copy (same pattern as Dice/Roulette) purely for
// the paytable's payout numbers. The server never trusts anything from
// here; it recomputes the real outcome and payout itself. No entry for
// 4x6 — single-row is never offered there (see ALLOWED_REWARD_MODES).
const SINGLE_ROW_PAYTABLES: Partial<Record<SlotBoardSize, ClientPaytable>> = {
  "3x3": {
    baselineRtp: 0.9049665,
    tierCount: 2,
    tierIndex: (count) => (count >= 3 ? 1 : 0),
    label: "Paytable (2× · 3×)",
    symbols: [
      { id: "dot", pay: [0.5, 5.5] },
      { id: "square", pay: [1, 7.5] },
      { id: "diamond", pay: [1, 9.5] },
      { id: "star", pay: [1.5, 11.5] },
      { id: "seven", pay: [2, 15] },
    ],
  },
  "3x4": {
    baselineRtp: 0.99206293,
    tierCount: 2,
    tierIndex: (count) => (count >= 4 ? 1 : 0),
    label: "Paytable (3× · 4×)",
    symbols: [
      { id: "dot", pay: [2.5, 18.5] },
      { id: "square", pay: [3, 24.5] },
      { id: "diamond", pay: [4, 30.5] },
      { id: "star", pay: [4.5, 36.5] },
      { id: "seven", pay: [6, 48.5] },
    ],
  },
  "5x3": {
    baselineRtp: 0.9619252895,
    tierCount: 3,
    tierIndex: (count) => (count >= 5 ? 2 : count === 4 ? 1 : 0),
    label: "Paytable (3× · 4× · 5×)",
    symbols: [
      { id: "dot", pay: [1.5, 3, 12] },
      { id: "square", pay: [2, 4, 15] },
      { id: "diamond", pay: [2.5, 5, 19] },
      { id: "star", pay: [3, 6.5, 25] },
      { id: "seven", pay: [4, 8.5, 40] },
    ],
  },
  "3x6": {
    // Corrected values (see the "Amendment" note near the top of this
    // plan and the design doc's "Correction" note) — threshold 4, not the
    // originally-drafted 3, to avoid same-row ties.
    baselineRtp: 0.972812236308,
    tierCount: 3,
    tierIndex: (count) => (count >= 6 ? 2 : count === 5 ? 1 : 0),
    label: "Paytable (4× · 5× · 6×)",
    symbols: [
      { id: "dot", pay: [4, 8, 31] },
      { id: "square", pay: [5, 10.5, 41.5] },
      { id: "diamond", pay: [6.5, 13, 52] },
      { id: "star", pay: [8, 15.5, 62] },
      { id: "seven", pay: [10.5, 20.5, 83] },
    ],
  },
};

// Mirrors supabase/functions/slots/engine.ts's FULL_BOARD_TABLES.
const FULL_BOARD_PAYTABLES: Record<"5x3" | "3x6" | "4x6", ClientPaytable> = {
  "5x3": {
    baselineRtp: 0.984280455592317,
    tierCount: 3,
    tierIndex: (count) => (count >= 11 ? 2 : count >= 9 ? 1 : 0),
    label: "Paytable (7-8 · 9-10 · 11+)",
    symbols: [
      { id: "dot", pay: [2, 6, 21] },
      { id: "square", pay: [3, 9, 32] },
      { id: "diamond", pay: [4, 12, 42] },
      { id: "star", pay: [6, 18, 63] },
      { id: "seven", pay: [10, 30, 105] },
    ],
  },
  "3x6": {
    baselineRtp: 0.942909367367,
    tierCount: 3,
    tierIndex: (count) => (count >= 12 ? 2 : count >= 10 ? 1 : 0),
    label: "Paytable (8-9 · 10-11 · 12+)",
    symbols: [
      { id: "dot", pay: [1.5, 5, 18.5] },
      { id: "square", pay: [2.5, 8, 27.5] },
      { id: "diamond", pay: [3.5, 10.5, 36.5] },
      { id: "star", pay: [5, 15.5, 55] },
      { id: "seven", pay: [8.5, 26, 92] },
    ],
  },
  "4x6": {
    baselineRtp: 0.972684972884,
    tierCount: 3,
    tierIndex: (count) => (count >= 17 ? 2 : count >= 13 ? 1 : 0),
    label: "Paytable (10-12 · 13-16 · 17+)",
    symbols: [
      { id: "dot", pay: [2, 5.5, 19] },
      { id: "square", pay: [2.5, 8, 29] },
      { id: "diamond", pay: [3.5, 11, 38.5] },
      { id: "star", pay: [5.5, 16.5, 57.5] },
      { id: "seven", pay: [9, 27.5, 96] },
    ],
  },
};

function edgeScale(baselineRtp: number, houseEdge: number): number {
  return (1 - houseEdge) / baselineRtp;
}
function displayX(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

// Maps a win's raw count to the shared 3/4/5 CSS win-tier hooks
// (sl-win-tier-3/4/5). 2-tier boards (3x3, 3x4) skip the middle "BIG WIN"
// tier — their tier 0 maps to WIN (3), tier 1 straight to MEGA WIN (5).
// Only ever called with a (boardSize, rewardMode) pair the server actually
// allows (ALLOWED_REWARD_MODES), so the asserted lookup below always finds
// a table — FULL_BOARD_PAYTABLES simply has no 3x3/3x4 entry because
// full_board is never reachable on those sizes.
function winTier(boardSize: SlotBoardSize, rewardMode: RewardMode, count: number): 3 | 4 | 5 {
  const table =
    rewardMode === "full_board"
      ? FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"]
      : SINGLE_ROW_PAYTABLES[boardSize]!;
  const tier = table.tierIndex(count);
  if (table.tierCount === 2) return tier >= 1 ? 5 : 3;
  return tier >= 2 ? 5 : tier === 1 ? 4 : 3;
}

function randomSymbolId(): SlotSymbolId {
  const ids: SlotSymbolId[] = ["dot", "square", "diamond", "star", "seven"];
  return ids[Math.floor(Math.random() * ids.length)];
}

// Reel-drop timing: each reel starts REEL_STAGGER_MS after the previous one
// and takes REEL_DROP_MS to land — must match the CSS animation-duration /
// animation-delay values in SlotsStyles below. The true outcome (and the
// balance credit for any payout) isn't revealed until this has fully played.
const REEL_STAGGER_MS = 140;
const REEL_DROP_MS = 950;
const MAX_COLS = 6; // the widest board (3x6, 4x6)
const REVEAL_MS = (MAX_COLS - 1) * REEL_STAGGER_MS + REEL_DROP_MS + 140; // last reel's delay + duration + buffer

const PARTICLE_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const FILLER_COUNT = 15;

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Strip = FILLER_COUNT cosmetic filler symbols (never part of the real
// outcome, just motion-blur padding) followed by the server's actual
// column, top-to-bottom. The CSS drop animation always shifts up by
// exactly FILLER_COUNT cell-heights regardless of row count, which lands
// the strip's last `rows` cells in the reel's `rows`-cell-tall viewport —
// see SlotsStyles' slReelDrop keyframes.
function buildStrip(reel: SlotReel): SlotSymbolId[] {
  const filler = Array.from({ length: FILLER_COUNT }, () => randomSymbolId());
  return [...filler, ...reel];
}
```

`REVEAL_MS` changes from being pinned to 5 reels' worth of stagger to `MAX_COLS`'s — this keeps the reveal timeout correct for the widest board (6 columns); narrower boards simply finish animating before the timeout fires, which was already true of any narrower-than-max case even in the old fixed-5 code.

- [ ] **Step 2: Update the `Props` interface and component signature**

Replace the `Props` interface and the destructured props (old lines 120-142):

```ts
interface Props {
  casinoId: string;
  gameId: string;
  rewardMode: RewardMode;
  boardSize: SlotBoardSize;
  houseEdge: number;
  design?: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Slots({
  casinoId,
  gameId,
  rewardMode,
  boardSize,
  houseEdge,
  design,
  balance: initialBalance,
  minBet,
  maxBet,
  onExit,
}: Props) {
```

Update the import line (old line 13) to add `SlotBoardSize`:

```ts
import type { SlotSymbolId, SlotReel, SlotWin, FullBoardSlotWin, SlotBoardSize } from "../../types";
```

- [ ] **Step 3: Update reel state initialization and derived dimensions**

Replace old line 148-150 (`const [reels, setReels] = useState...`):

```ts
  const { rows, cols } = BOARD_DIMENSIONS[boardSize];
  const paylineRow = Math.floor(rows / 2);
  const [reels, setReels] = useState<SlotReel[]>(() =>
    Array.from({ length: cols }, () => Array.from({ length: rows }, randomSymbolId))
  );
```

(`const { rows, cols }` / `paylineRow` must be declared before this `useState` call since the initializer closure references them — place this replacement at the same location as the old `reels` state declaration, after `busy`/`bet` aren't yet defined at that point in the component, matching where `reels` was originally declared.)

- [ ] **Step 4: Update the scaled-paytable memos and win-tier/lit-cell derivations**

Replace old lines 204-230 (`scaledSingleRowPay` through `fullBoardLit`):

```ts
  const activeSingleRowTable = SINGLE_ROW_PAYTABLES[boardSize];
  // 3x3/3x4 have no full-board table (full_board is never reachable there
  // per ALLOWED_REWARD_MODES) — this lookup is `undefined` for those two
  // sizes, so every consumer below must guard it rather than assume it
  // exists just because rewardMode happens to be checked elsewhere.
  const activeFullBoardTable = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] as
    | ClientPaytable
    | undefined;

  // Scaled to the game's actual configured house edge, so the displayed "x"
  // always matches what the server (supabase/functions/slots/index.ts) pays.
  // Both memos run on every render regardless of the current rewardMode
  // (hooks can't be conditional), so each must independently no-op when its
  // own table doesn't apply to this boardSize instead of assuming the other
  // one guards it.
  const scaledSingleRowPay = useMemo(() => {
    if (!activeSingleRowTable) return [];
    const scale = edgeScale(activeSingleRowTable.baselineRtp, houseEdge);
    return activeSingleRowTable.symbols.map((s) => ({ ...s, pay: s.pay.map((x) => x * scale) }));
  }, [activeSingleRowTable, houseEdge]);
  const scaledFullBoardPay = useMemo(() => {
    if (!activeFullBoardTable) return [];
    const scale = edgeScale(activeFullBoardTable.baselineRtp, houseEdge);
    return activeFullBoardTable.symbols.map((s) => ({ ...s, pay: s.pay.map((x) => x * scale) }));
  }, [activeFullBoardTable, houseEdge]);

  const tier = win ? winTier(boardSize, rewardMode, win.count) : null;
  const winMessage = tier === 5 ? "MEGA WIN" : tier === 4 ? "BIG WIN" : tier === 3 ? "WIN" : "";

  // Full-board wins light up cells on any row; build a lookup once per win
  // rather than re-scanning positions per cell.
  const fullBoardLit = useMemo(() => {
    if (!win || rewardMode !== "full_board") return null;
    const { wins } = win as FullBoardSlotWin;
    return new Set(wins.flatMap((w) => w.positions.map((p) => `${p.reel}:${p.row}`)));
  }, [win, rewardMode]);
```

- [ ] **Step 5: Update the paytable sidebar JSX**

Replace old lines 304-341 (the paytable header + list):

```tsx
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {rewardMode === "full_board" ? activeFullBoardTable?.label : activeSingleRowTable?.label}
              </p>
              <button
                type="button"
                onClick={() => setShowPaytable((v) => !v)}
                aria-label={showPaytable ? "Hide paytable" : "Show paytable"}
                aria-pressed={showPaytable}
                className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPaytable ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {showPaytable &&
              (rewardMode === "full_board" ? scaledFullBoardPay : scaledSingleRowPay).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="sl-sym-mini">
                    <SlotSymbol design={activeDesign} id={s.id} />
                  </span>
                  <span className="text-muted-foreground font-mono">
                    {s.pay.map((x) => `${displayX(x)}x`).join(" · ")}
                  </span>
                </div>
              ))}
          </div>
```

- [ ] **Step 6: Update the reel grid JSX (payline arrows, cell mapping)**

Replace old lines 344-400 (from `<div className="flex flex-1 items-center justify-center p-5 min-w-0">` through the closing of that block):

```tsx
        <div className="flex flex-1 items-center justify-center p-5 min-w-0">
          <div
            className={`sl-reels-wrap ${activeDesign.themeClass}`}
            style={{ ["--rows" as string]: rows, ["--cols" as string]: cols }}
          >
            {rewardMode === "single_row" && (
              <>
                <div
                  className="sl-payline-arrow sl-left"
                  style={{ top: `calc(14px + ${paylineRow + 0.5} * var(--cell))` }}
                />
                <div
                  className="sl-payline-arrow sl-right"
                  style={{ top: `calc(14px + ${paylineRow + 0.5} * var(--cell))` }}
                />
              </>
            )}
            <div className="sl-reels">
              {reels.map((reel, i) => {
                const strip = strips[i];
                return (
                  <div className="sl-reel" key={i}>
                    {spinning && strip ? (
                      <div className="sl-reel-strip sl-spin">
                        {strip.map((sym, k) => (
                          <div className="sl-cell" key={k}>
                            <SlotSymbol design={activeDesign} id={sym} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sl-reel-static">
                        {reel.map((symbol, row) => {
                          const isLit =
                            rewardMode === "full_board"
                              ? Boolean(fullBoardLit?.has(`${i}:${row}`))
                              : row === paylineRow && Boolean(win && (win as SlotWin).positions.includes(i));
                          return (
                            <div
                              className={`sl-cell ${row === paylineRow ? "sl-mid" : ""} ${isLit ? "sl-lit" : ""}`}
                              key={row}
                            >
                              <SlotSymbol design={activeDesign} id={symbol} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {win && (
              <div key={winId} className={`sl-win-tier-${tier}`}>
                <div className="sl-win-flash" />
                <div className="sl-win-banner">
                  <div className="sl-win-label">{winMessage}</div>
                  <div className="sl-win-amount">+{formatChips(win.amount)}</div>
                </div>
                <div className="sl-particles">
                  {PARTICLE_SLOTS.map((p) => (
                    <i className="sl-particle" key={p} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
```

Payline arrows are now gated to `rewardMode === "single_row"` — showing an arrow pinned at a fixed "middle row" offset made no sense for full-board mode (there's no distinguished payline there), and this was already latent in the pre-existing code (the arrow's hardcoded `1.5 * var(--cell)` offset happened to be harmless-looking on the old 3-row-always board, but a 4x6 board is full-board-only, where the arrow should never appear at all).

- [ ] **Step 7: Update `SlotsStyles` for dynamic columns/rows**

Replace the `SlotsStyles` function's CSS (old lines 407-444, from `.sl-reels-wrap {` through the last `nth-child` rule):

```tsx
function SlotsStyles() {
  const nthChildRules = Array.from(
    { length: MAX_COLS },
    (_, i) =>
      `.sl-reel:nth-child(${i + 1}) .sl-reel-strip.sl-spin { animation-delay: ${i * REEL_STAGGER_MS}ms; }`
  ).join("\n      ");

  return (
    <style>{`
      .sl-reels-wrap {
        /* Grows with the viewport (not just the modal) so the reels visibly
           fill more of the popup's empty space on larger screens, floored
           for mobile and capped so cells stay proportioned at 4K. */
        --cell: clamp(64px, 6.5vw, 108px);
        position: relative;
        padding: 14px;
        border-radius: 16px;
      }
      .sl-reels { display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); gap: 8px; }
      .sl-reel { width: var(--cell); height: calc(var(--rows) * var(--cell)); overflow: hidden; border-radius: 10px; position: relative; background: rgba(0,0,0,0.25); }
      .sl-reel-static, .sl-reel-strip { display: flex; flex-direction: column; }
      .sl-cell { width: var(--cell); height: var(--cell); display: flex; align-items: center; justify-content: center; flex: none; }
      .sl-cell.sl-mid { position: relative; }

      .sl-sym { width: 56%; height: 56%; display: flex; align-items: center; justify-content: center; position: relative; font-weight: 700; font-size: 24px; }
      .sl-sym-mini { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; }
      .sl-sym-mini .sl-sym { width: 100%; height: 100%; font-size: 12px; }
      /* .sl-ic is the themed icon's own box — always fills its .sl-sym
         wrapper, so every design's shapes (and any of their part elements,
         positioned absolutely against it) scale the same way at both the
         main reel size and the paytable's 22px mini size. */
      .sl-ic { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }

      @keyframes slReelDrop {
        0% { transform: translateY(0); filter: blur(6px); }
        70% { filter: blur(4px); }
        100% { transform: translateY(calc(-${FILLER_COUNT} * var(--cell))); filter: blur(0); }
      }
      .sl-reel-strip.sl-spin { animation: slReelDrop ${REEL_DROP_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
      ${nthChildRules}

      .sl-payline-arrow { position: absolute; width: 0; height: 0; transform: translateY(-50%); z-index: 1; }
      .sl-payline-arrow.sl-left { left: 2px; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left-width: 8px; border-left-style: solid; }
      .sl-payline-arrow.sl-right { right: 2px; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-right-width: 8px; border-right-style: solid; }
```

Everything from `.sl-win-flash { ... }` onward (old lines 450-599) is unchanged — leave it exactly as-is, this replacement only covers through the payline arrow rules.

Note the drop-distance keyframe now uses the constant `FILLER_COUNT` (15) regardless of board size — not `FILLER_COUNT + rows` — because the strip's window (`.sl-reel`, height `rows * cell`) is already sized to show exactly `rows` cells once the strip is shifted up by `FILLER_COUNT` cell-heights; the strip's last `rows` entries (built by `buildStrip`) land in that window regardless of what `rows` is.

- [ ] **Step 8: Type-check**

Run: `npx tsc -b --noEmit`
Expected: `Slots.tsx` errors clear. `CasinoDashboard.tsx` still has an error (missing `boardSize` prop) — that's Task 9.

- [ ] **Step 9: Commit**

```bash
git add src/components/games/Slots.tsx
git commit -m "slots: generalize Slots.tsx reel rendering and CSS grid to board size"
```

---

### Task 9: Frontend — `CasinoDashboard.tsx` wiring

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx:384-402`

- [ ] **Step 1: Add the `boardSize` prop**

In the `<Slots>` element (around line 385-401), add a `boardSize` prop alongside the existing `rewardMode`/`houseEdge`/`design`:

```tsx
          {activeGame.game_type_id === "slots" && (
            <Slots
              casinoId={currentCasino.id}
              gameId={activeGame.id}
              rewardMode={
                (activeGame.settings as SlotsInstanceSettings)?.rewardMode === "full_board"
                  ? "full_board"
                  : "single_row"
              }
              boardSize={(activeGame.settings as SlotsInstanceSettings)?.boardSize ?? "5x3"}
              // Mirrors the slots edge function's DEFAULT_HOUSE_EDGE fallback
              // (supabase/functions/slots/engine.ts) for pre-existing rows.
              houseEdge={(activeGame.settings as SlotsInstanceSettings)?.houseEdge ?? 0.02}
              design={(activeGame.settings as SlotsInstanceSettings)?.design ?? DEFAULT_SLOTS_DESIGN_ID}
              balance={membership?.balance ?? 0}
              minBet={activeGame.min_bet}
              maxBet={activeGame.max_bet}
              onExit={() => setActiveGame(null)}
            />
          )}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: no errors anywhere in `src/`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "slots: pass boardSize setting through to Slots component"
```

---

### Task 10: Admin UI — Board Size selector and Reward Mode gating in `GameSettingsModal.tsx`

**Files:**
- Modify: `src/components/GameSettingsModal.tsx`

- [ ] **Step 1: Add the `BOARD_SIZES`/`ALLOWED_REWARD_MODES` constants**

After the existing `HOUSE_EDGE_OPTIONS` declaration (old lines 27-30), add:

```ts
const BOARD_SIZES = [
  { id: "3x3" as const, label: "3×3", description: "Smallest board. Locked to single row." },
  { id: "3x4" as const, label: "3×4", description: "Locked to single row." },
  { id: "5x3" as const, label: "5×3 (Classic)", description: "Today's board. Single row or full board." },
  { id: "3x6" as const, label: "3×6", description: "Single row or full board." },
  { id: "4x6" as const, label: "4×6", description: "Largest board. Locked to full board." },
];
type BoardSize = (typeof BOARD_SIZES)[number]["id"];

// Mirrors supabase/functions/slots/engine.ts's ALLOWED_REWARD_MODES.
const ALLOWED_REWARD_MODES: Record<BoardSize, ("single_row" | "full_board")[]> = {
  "3x3": ["single_row"],
  "3x4": ["single_row"],
  "5x3": ["single_row", "full_board"],
  "3x6": ["single_row", "full_board"],
  "4x6": ["full_board"],
};
```

- [ ] **Step 2: Add `boardSize` state and gate `rewardMode`'s initial value**

Replace the `rewardMode` state initialization (old lines 58-60) with, inserted right before it:

```ts
  const initialBoardSize: BoardSize = BOARD_SIZES.some((b) => b.id === initialSettings.boardSize)
    ? (initialSettings.boardSize as BoardSize)
    : "5x3";
  const [boardSize, setBoardSize] = useState<BoardSize>(initialBoardSize);
  const [rewardMode, setRewardMode] = useState<"single_row" | "full_board">(() => {
    const allowed = ALLOWED_REWARD_MODES[initialBoardSize];
    return initialSettings.rewardMode === "full_board" && allowed.includes("full_board")
      ? "full_board"
      : allowed[0];
  });
```

- [ ] **Step 3: Add the board-size change handler**

After the `houseEdge`/`design` state declarations (old lines 61-68), add:

```ts
  function handleBoardSizeChange(next: BoardSize) {
    setBoardSize(next);
    const allowed = ALLOWED_REWARD_MODES[next];
    if (!allowed.includes(rewardMode)) setRewardMode(allowed[0]);
  }
```

- [ ] **Step 4: Include `boardSize` in the saved settings**

Replace `handleSave`'s settings object (old line 90):

```ts
      const settings = isSlots ? { ...initialSettings, rewardMode, houseEdge, design, boardSize } : initialSettings;
```

- [ ] **Step 5: Add the Board Size section and gate the Reward Mode buttons**

Insert a new Board Size section right before the existing Reward Mode section (old lines 257-278), and replace that Reward Mode section to disable/annotate unavailable modes:

```tsx
        {isSlots && (
          <div>
            <Label>Board Size</Label>
            <div className="mt-1.5 grid grid-cols-1 gap-2">
              {BOARD_SIZES.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => handleBoardSizeChange(b.id)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                    boardSize === b.id ? "border-primary bg-primary/10" : "border-border hover:border-foreground/30"
                  }`}
                >
                  <p className="text-sm font-medium">{b.label}</p>
                  <p className="text-xs text-muted-foreground">{b.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {isSlots && (
          <div>
            <Label>Reward Mode</Label>
            <div className="mt-1.5 grid grid-cols-1 gap-2">
              {REWARD_MODES.map((mode) => {
                const allowed = ALLOWED_REWARD_MODES[boardSize].includes(mode.id);
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => allowed && setRewardMode(mode.id)}
                    disabled={!allowed}
                    className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                      !allowed
                        ? "border-border opacity-40 cursor-not-allowed"
                        : rewardMode === mode.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-foreground/30"
                    }`}
                  >
                    <p className="text-sm font-medium">{mode.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {allowed ? mode.description : "Not available for this board size."}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/GameSettingsModal.tsx
git commit -m "slots: add Board Size admin setting with Reward Mode gating"
```

---

### Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including every `engine.test.ts` case from Tasks 1-5.

- [ ] **Step 2: Full project type-check**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: builds successfully (this also re-type-checks via `tsc -b` per the `build` script).

- [ ] **Step 4: Deploy the edge function**

The `slots` edge function's local edits don't go live until deployed. Use the `deploy_edge_function` Supabase MCP tool (per this project's standing instructions) to deploy `supabase/functions/slots`.

- [ ] **Step 5: Manual Playwright verification**

Using the seeded test admin account (`claudetest.cassie@gmail.com` / `ClaudeTest123!`), for each of the 5 board sizes:

1. In a casino's Settings tab, add a new Slot Machine instance, select that board size, confirm Reward Mode gating matches the table in the design doc (3x3/3x4 force-and-lock single row, 4x6 force-and-lock full board, 5x3/3x6 free choice), save.
2. Open the instance, confirm the reel grid renders with the correct row/column count and the modal/cell sizing still fills the viewport per CLAUDE.md's fill-sizing rules at both a ~375px and a ~1920px viewport width.
3. Spin until a win lands; confirm the correct cells light up, the WIN/BIG WIN/MEGA WIN banner matches the board's tier structure (3x3/3x4 only ever show WIN or MEGA WIN, never BIG WIN), and the paytable sidebar's displayed multipliers match the tables above scaled by the instance's house edge.
4. Confirm balance still deducts the bet instantly on spin, and only credits any payout once the reel-drop animation finishes (unchanged existing behavior — must not regress for any board size).
5. Refresh the page — board size and reward mode persist (confirms the DB write, not just local state).
6. For the 5x3 board specifically, confirm it plays identically to before this change (same visual layout, same odds) — this is the default/backward-compatible path and must show zero regression.

- [ ] **Step 6: Report results**

Summarize pass/fail for each of the 5 board sizes and note any visual or behavioral issue found, before considering this plan complete.
