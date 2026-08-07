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
// payline. Unlike single-row mode (one shared threshold, one winner),
// every symbol has its own threshold and is evaluated independently: a
// symbol wins whenever its own cell count reaches its own threshold,
// regardless of what any other symbol's count is. More than one symbol
// can independently qualify in the same spin — when that happens, every
// qualifying symbol pays, at its own tier; there is no single "winner" and
// no tie-break rule needed, since qualification isn't relative to any
// other symbol's count.
//
// Thresholds and pay tables below are from exact binomial/multinomial
// enumeration (not simulation) — see
// docs/superpowers/specs/2026-08-07-slots-full-board-per-symbol-thresholds-design.md
// for the full derivation (thresholds chosen so each symbol requires no
// more matches than the next-more-common symbol, while each symbol's own
// win probability is strictly less than every more-common symbol's).
export interface FullBoardPosition {
  reel: number;
  row: number; // 0-based row index
}

// `wins` holds every symbol that independently reached its own threshold
// this spin — normally length 0-1, occasionally more when multiple
// symbols each clear their own (different) threshold at once. Each entry
// carries its own `count`, since different symbols can win at different
// counts in the same spin — there is no single board-wide count anymore.
export interface FullBoardTieWin {
  symbol: SymbolId;
  count: number;
  positions: FullBoardPosition[];
}

export interface FullBoardWin {
  wins: FullBoardTieWin[];
}

interface FullBoardSymbolConfig {
  id: SymbolId;
  threshold: number;
  tierIndex: (count: number) => number;
  pay: number[]; // indexed by 0-based tier
}

interface FullBoardConfig {
  symbols: FullBoardSymbolConfig[];
  baselineRtp: number;
}

// Full-board mode is only ever evaluated on 5x3/3x6/4x6 (3x3 and 3x4 never
// reach full_board per ALLOWED_REWARD_MODES), so this is a Partial keyed
// by BoardSize, with no entry for the sizes that don't support the mode —
// both callers below guard against a missing config rather than trusting
// a TS cast.
export const FULL_BOARD_TABLES: Partial<Record<BoardSize, FullBoardConfig>> = {
  "5x3": {
    baselineRtp: 0.953370178231,
    symbols: [
      { id: "dot", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [0.5, 1.5, 4.5] },
      { id: "square", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [2.5, 8, 28] },
      { id: "diamond", threshold: 7, tierIndex: (c) => (c >= 9 ? 2 : c === 8 ? 1 : 0), pay: [6, 17.5, 61.5] },
      { id: "star", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [22, 66.5, 233.5] },
      { id: "seven", threshold: 5, tierIndex: (c) => (c >= 7 ? 2 : c === 6 ? 1 : 0), pay: [27.5, 82.5, 288] },
    ],
  },
  "3x6": {
    baselineRtp: 0.990009227769,
    symbols: [
      { id: "dot", threshold: 9, tierIndex: (c) => (c >= 12 ? 2 : c === 11 ? 1 : 0), pay: [1, 2.5, 9] },
      { id: "square", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [1, 2.5, 9] },
      { id: "diamond", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [3, 8.5, 30] },
      { id: "star", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [7, 21.5, 74.5] },
      { id: "seven", threshold: 5, tierIndex: (c) => (c >= 7 ? 2 : c === 6 ? 1 : 0), pay: [10.5, 31.5, 110.5] },
    ],
  },
  "4x6": {
    baselineRtp: 0.924315378511,
    symbols: [
      { id: "dot", threshold: 11, tierIndex: (c) => (c >= 15 ? 2 : c >= 13 ? 1 : 0), pay: [0.5, 2, 6.5] },
      { id: "square", threshold: 9, tierIndex: (c) => (c >= 13 ? 2 : c >= 11 ? 1 : 0), pay: [1, 3, 11] },
      { id: "diamond", threshold: 9, tierIndex: (c) => (c >= 12 ? 2 : c === 11 ? 1 : 0), pay: [3.5, 11, 39] },
      { id: "star", threshold: 7, tierIndex: (c) => (c >= 9 ? 2 : c === 8 ? 1 : 0), pay: [5, 14.5, 50.5] },
      { id: "seven", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [11, 33, 116.5] },
    ],
  },
};

// Counts every cell (not just the payline) per symbol, then checks each
// symbol independently against its own threshold — no "max count" concept
// anymore. Every symbol whose count reaches its own threshold is collected
// into `wins`, generically (no hardcoded cap on how many can qualify at
// once).
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

  const wins: FullBoardTieWin[] = [];
  for (const s of config.symbols) {
    const positions = cellsBySymbol.get(s.id) ?? [];
    if (positions.length >= s.threshold) {
      wins.push({ symbol: s.id, count: positions.length, positions });
    }
  }
  return wins.length > 0 ? { wins } : null;
}

// Every qualifying symbol pays its own-tier rate — a dot win and a
// separately-qualifying seven win both pay in full and sum together, since
// each symbol's win is independent of every other symbol's count.
export function payoutForFullBoard(
  win: FullBoardWin | null,
  bet: number,
  boardSize: BoardSize,
  houseEdge?: number
): number {
  if (!win) return 0;
  const config = FULL_BOARD_TABLES[boardSize];
  if (!config) return 0;
  const scale = houseEdge === undefined ? 1 : edgeScale(config.baselineRtp, houseEdge);
  const total = win.wins.reduce((sum, w) => {
    const symbol = config.symbols.find((s) => s.id === w.symbol)!;
    const tier = symbol.tierIndex(w.count);
    return sum + symbol.pay[tier];
  }, 0);
  return roundMoney(bet * total * scale);
}
