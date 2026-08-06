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

export interface Win {
  symbol: SymbolId;
  count: RunLength;
  // Reel indices (0-based) holding the winning symbol — not necessarily
  // contiguous or left-aligned, since matches are scatter-style.
  positions: number[];
}

// Scatter rule: 3+ of the same symbol anywhere on the payline wins, not just
// a left-aligned consecutive run. At most one symbol can reach a count of 3+
// per spin (two symbols both doing so would need 6+ of the 5 reels), so
// there's no tie to break.
export function evaluateWin(reels: Reel[]): Win | null {
  const positionsBySymbol = new Map<SymbolId, number[]>();
  reels.forEach((reel, i) => {
    const positions = positionsBySymbol.get(reel.mid) ?? [];
    positions.push(i);
    positionsBySymbol.set(reel.mid, positions);
  });
  for (const [symbol, positions] of positionsBySymbol) {
    if (positions.length >= 3) {
      return { symbol, count: positions.length as RunLength, positions };
    }
  }
  return null;
}

// `houseEdge` left undefined leaves the raw pay table untouched (scale 1) —
// callers that care about a configurable edge (the slots edge function)
// always pass one; engine.test.ts's pinned-payout assertions rely on the
// unscaled default.
export function payoutFor(win: Win | null, bet: number, houseEdge?: number): number {
  if (!win) return 0;
  const symbol = SYMBOLS.find((s) => s.id === win.symbol)!;
  const scale = houseEdge === undefined ? 1 : edgeScale(BASELINE_RTP_SINGLE_ROW, houseEdge);
  return roundMoney(bet * symbol.pay[win.count] * scale);
}

// --- Full board reward mode -------------------------------------------
//
// "Full board" scores all 15 visible cells (top/mid/bottom x 5 reels)
// instead of just the mid-row payline. With 15 iid draws across 5
// symbols, some symbol has count >= 3 on effectively 100% of spins
// (pigeonhole: 15 cells / 5 symbols = 3 average), so reusing the
// single-row threshold of 3 would mean winning every spin. Exact
// multinomial enumeration (all 3,876 compositions of 15 into 5 parts,
// weighted by SYMBOLS' weights above) over "every symbol at the max count
// wins" gives:
//
//   P(max count >= 7)  = 31.97%  <- win threshold
//   P(max count >= 9)  =  4.72%  <- BIG WIN tier
//   P(max count >= 11) =  0.30%  <- MEGA WIN tier
//
// Two symbols can tie for the max count (e.g. 7 dots + 7 squares + 1
// other) — 15 cells / 7-cell threshold allows at most a 2-way tie, never 3
// (3 * 7 = 21 > 15). When that happens both symbols pay in full rather
// than picking a "winner" (see evaluateFullBoardWin/payoutForFullBoard).
// Ties only land in the 7-8 tier (two symbols both at 9+ would need 18+
// cells) and are rare — 0.10% of all spins, 0.32% of winning spins — so
// they nudge RTP up slightly rather than requiring a full re-solve.
//
// The pay table below was solved (same weighted-sum-times-pay approach
// as SYMBOLS' RTP above, using those exact tier probabilities, under the
// single-winner rule) to bring total RTP to ~0.9822 (house edge ~1.78%),
// matching single-row's ~0.9820 (~1.80%). Tier multipliers are deliberately
// flatter than a naive scale-up (tier0:tier1:tier2 ≈ 1:3:10.5 per symbol,
// vs. a much steeper spread) so the common small win (7-8 cells) pays more
// and the rare max win (11-15 cells) pays less — the same total RTP spread
// more evenly across outcomes. Paying both symbols on a tie lifts actual
// RTP to ~0.9843 (house edge ~1.57%) — within the same 97-99% band, so the
// table wasn't rescaled for it. Full derivation:
// docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md
export interface FullBoardPosition {
  reel: number;
  row: "top" | "mid" | "bottom";
}

export interface FullBoardTieWin {
  symbol: SymbolId;
  positions: FullBoardPosition[];
}

// `wins` holds every symbol that reached the max count — normally length 1,
// occasionally 2 when two symbols tie (see evaluateFullBoardWin). All of
// them share `count`/tier, since a tie is only possible between symbols at
// the exact same count.
export interface FullBoardWin {
  count: number; // 7..15
  wins: FullBoardTieWin[];
}

interface FullBoardSymbolDef {
  id: SymbolId;
  // Pay at tier 0 (7-8 cells), tier 1 (9-10 cells), tier 2 (11-15 cells).
  pay: [number, number, number];
}

export const FULL_BOARD_MIN_COUNT = 7;

export const FULL_BOARD_SYMBOLS: FullBoardSymbolDef[] = [
  { id: "dot", pay: [2, 6, 21] },
  { id: "square", pay: [3, 9, 32] },
  { id: "diamond", pay: [4, 12, 42] },
  { id: "star", pay: [6, 18, 63] },
  { id: "seven", pay: [10, 30, 105] },
];

function fullBoardTierIndex(count: number): 0 | 1 | 2 {
  if (count >= 11) return 2;
  if (count >= 9) return 1;
  return 0;
}

// Counts every cell (not just mid) per symbol, then finds the highest
// count. Every symbol that reaches that count wins — with 15 cells, two
// symbols tying for the max is possible (e.g. 7 dots + 7 squares + 1
// other), but three-way ties aren't (3 * 7 = 21 > 15), so `wins` is never
// longer than 2.
export function evaluateFullBoardWin(reels: Reel[]): FullBoardWin | null {
  const cellsBySymbol = new Map<SymbolId, FullBoardPosition[]>();
  reels.forEach((reel, i) => {
    (["top", "mid", "bottom"] as const).forEach((row) => {
      const symbol = reel[row];
      const positions = cellsBySymbol.get(symbol) ?? [];
      positions.push({ reel: i, row });
      cellsBySymbol.set(symbol, positions);
    });
  });

  let maxCount = 0;
  for (const positions of cellsBySymbol.values()) {
    if (positions.length > maxCount) maxCount = positions.length;
  }
  if (maxCount < FULL_BOARD_MIN_COUNT) return null;

  const wins: FullBoardTieWin[] = [];
  for (const s of SYMBOLS) {
    const positions = cellsBySymbol.get(s.id) ?? [];
    if (positions.length === maxCount) wins.push({ symbol: s.id, positions });
  }
  return { count: maxCount, wins };
}

// Every tied symbol pays out — a 7-dot/7-square tie pays dot's tier-0 rate
// plus square's, not just the rarer one.
export function payoutForFullBoard(win: FullBoardWin | null, bet: number, houseEdge?: number): number {
  if (!win) return 0;
  const tier = fullBoardTierIndex(win.count);
  const total = win.wins.reduce((sum, w) => {
    const symbol = FULL_BOARD_SYMBOLS.find((s) => s.id === w.symbol)!;
    return sum + symbol.pay[tier];
  }, 0);
  const scale = houseEdge === undefined ? 1 : edgeScale(BASELINE_RTP_FULL_BOARD, houseEdge);
  return roundMoney(bet * total * scale);
}
