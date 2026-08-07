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
    threshold: 4,
    tierIndex: (count) => (count >= 6 ? 2 : count === 5 ? 1 : 0),
    symbols: [
      { id: "dot", pay: [4, 8, 31] },
      { id: "square", pay: [5, 10.5, 41.5] },
      { id: "diamond", pay: [6.5, 13, 52] },
      { id: "star", pay: [8, 15.5, 62] },
      { id: "seven", pay: [10.5, 20.5, 83] },
    ],
    baselineRtp: 0.972812236308,
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

// --- Full board reward mode -------------------------------------------
//
// "Full board" scores every visible cell instead of just the middle-row
// payline. Win thresholds and pay tables below are from exact multinomial-
// composition enumeration over SYMBOL_WEIGHTS (not simulation) — see
// docs/superpowers/specs/2026-08-06-slots-board-size-design.md and the
// original 5x3 derivation at
// docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md.
//
// Every symbol tied for the max count pays (not just the rarest). A k-way
// winning tie requires k * minCount <= totalCells; checking each current
// table shows only a 2-way tie is reachable at any board size (5x3:
// 3*7=21>15; 3x6: 3*8=24>18; 4x6: 3*10=30>24 — a 3-way tie is impossible
// under all 3 current tables). `wins` is nonetheless written to handle any
// tie length generically (no hardcoded 2-entry cap), so it stays correct
// if a future table's minCount ever makes a 3-way tie reachable.
export interface FullBoardPosition {
  reel: number;
  row: number; // 0-based row index
}

export interface FullBoardTieWin {
  symbol: SymbolId;
  positions: FullBoardPosition[];
}

// `wins` holds every symbol that reached the max count — normally length
// 1, occasionally 2 when symbols tie (see the tie-reachability comment
// above evaluateFullBoardWin). All of them share `count`/tier, since a tie
// is only possible between symbols at the exact same count.
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

// Full-board mode is only ever evaluated on 5x3/3x6/4x6 (3x3 and 3x4 never
// reach full_board per ALLOWED_REWARD_MODES), so this mirrors
// SINGLE_ROW_TABLES's shape: a Partial keyed by BoardSize, with no entry
// for the sizes that don't support the mode, and both callers below
// guarding against a missing config rather than trusting a TS cast.
export const FULL_BOARD_TABLES: Partial<Record<BoardSize, FullBoardConfig>> = {
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

// Counts every cell (not just the payline) per symbol, then finds the
// highest count. Every symbol that reaches that count wins.
export function evaluateFullBoardWin(reels: Reel[], boardSize: BoardSize): FullBoardWin | null {
  const config = FULL_BOARD_TABLES[boardSize];
  if (!config) return null;
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
  const config = FULL_BOARD_TABLES[boardSize];
  if (!config) return 0;
  const tier = config.tierIndex(win.count);
  const total = win.wins.reduce((sum, w) => {
    const symbol = config.symbols.find((s) => s.id === w.symbol)!;
    return sum + symbol.pay[tier];
  }, 0);
  const scale = houseEdge === undefined ? 1 : edgeScale(config.baselineRtp, houseEdge);
  return roundMoney(bet * total * scale);
}
