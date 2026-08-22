export type Rng = () => number;
export type SymbolId = "dot" | "square" | "diamond" | "star" | "seven";

// Fixed 5x6 board — unlike the older `slots` game there is no selectable
// board size, and no single-row reward mode. Tumble is full-board only.
export const ROWS = 5;
export const COLS = 6;
export const CELLS = ROWS * COLS; // 30

// Admins pick one of these; 0% is deliberately absent (unlike `slots`), since
// the product decision is that Tumble always keeps an edge of at least 1%.
export const HOUSE_EDGE_OPTIONS = [0.01, 0.02, 0.03, 0.04, 0.05] as const;
export const MIN_HOUSE_EDGE = HOUSE_EDGE_OPTIONS[0];
export const MAX_HOUSE_EDGE = HOUSE_EDGE_OPTIONS[HOUSE_EDGE_OPTIONS.length - 1];
export const DEFAULT_HOUSE_EDGE = 0.03;

export interface SymbolConfig {
  id: SymbolId;
  weight: number;
  // Cells of this symbol needed anywhere on the board to win. A rarer symbol
  // needs FEWER cells, yet still wins strictly less often than every
  // more-common symbol — see the invariant test in engine.test.ts.
  threshold: number;
  // Indexed by tier: [exactly threshold, threshold+1, threshold+2 or more].
  pay: [number, number, number];
}

// Weights match the `slots` game so the shared design skins in
// src/lib/slotsDesigns.ts apply unchanged. Thresholds and pays are specific
// to this board and were derived by exact enumeration, not simulation — see
// the design doc referenced by BASELINE_RTP below.
//
// Opening-board win probability per symbol (exact binomial tail over 30
// cells), which is what the "rarer symbol, fewer cells, still rarer win"
// balance rests on:
//   dot     15 cells -> 6.52%      star     9 cells -> 0.69%
//   square  12 cells -> 5.07%      seven    8 cells -> 0.20%
//   diamond 11 cells -> 2.56%
export const SYMBOLS: SymbolConfig[] = [
  { id: "dot", weight: 0.35, threshold: 15, pay: [0.25, 0.6, 1.5] },
  { id: "square", weight: 0.25, threshold: 12, pay: [0.6, 1.5, 4] },
  { id: "diamond", weight: 0.2, threshold: 11, pay: [1.2, 3, 8] },
  { id: "star", weight: 0.12, threshold: 9, pay: [2.5, 6.5, 18] },
  { id: "seven", weight: 0.08, threshold: 8, pay: [6, 16, 50] },
];

// Multiplier orbs. On every step that pays, this many orbs land (indexed by
// count), each taking one of ORB_VALUES. Orb values are NEVER scaled by the
// house edge — the player sees "x25" on the board and gets exactly x25;
// only the pay table moves with the edge.
export const ORB_COUNT_WEIGHTS = [0.84, 0.14, 0.02];
export const ORB_VALUES: { value: number; weight: number }[] = [
  { value: 2, weight: 0.72 },
  { value: 3, weight: 0.15 },
  { value: 5, weight: 0.06 },
  { value: 10, weight: 0.03 },
  { value: 25, weight: 0.02 },
  { value: 50, weight: 0.012 },
  { value: 100, weight: 0.006 },
  { value: 250, weight: 0.002 },
];

// Exact long-run RTP of the raw pay table above, including the orb feature,
// at scale 1. Computed by solving the cascade as a Markov chain over
// per-symbol count vectors (only 324,632 vectors of sum <= 30 exist, so the
// game is solvable exactly) — see
// docs/superpowers/specs/2026-08-08-tumble-game-design.md.
//
// It exceeds 1 because the raw table is deliberately authored at
// human-readable numbers; edgeScale below divides it back down so whichever
// edge the admin picks becomes the exact realized RTP.
export const BASELINE_RTP = 1.070847083099;

// houseEdge only ever scales how much a win PAYS. It never touches the
// symbol weights or the thresholds, so hit frequency, cascade length and orb
// frequency are identical at every edge setting — only the pay table moves.
export function edgeScale(houseEdge: number): number {
  return (1 - houseEdge) / BASELINE_RTP;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Weighted pick over a cumulative distribution. The last entry is the
// fallback for the r === sum-of-weights edge (float rounding), never a
// silent bias — every table here is authored to sum to exactly 1.
function pickWeighted<T>(rng: Rng, items: T[], weightOf: (item: T) => number): T {
  const r = rng();
  let cum = 0;
  for (const item of items) {
    cum += weightOf(item);
    if (r < cum) return item;
  }
  return items[items.length - 1];
}

export function pickSymbol(rng: Rng): SymbolId {
  return pickWeighted(rng, SYMBOLS, (s) => s.weight).id;
}

// board[col][row], row 0 = top. Columns are the unit that symbols fall
// through, so this orientation is what makes the tumble refill natural.
export type Board = SymbolId[][];

export function spinBoard(rng: Rng): Board {
  const board: Board = [];
  for (let c = 0; c < COLS; c++) {
    const col: SymbolId[] = [];
    for (let r = 0; r < ROWS; r++) col.push(pickSymbol(rng));
    board.push(col);
  }
  return board;
}

export interface Cell {
  col: number;
  row: number;
}

export interface TumbleWin {
  symbol: SymbolId;
  count: number;
  tier: number;
  // Pay multiplier for this symbol alone, already edge-scaled.
  pay: number;
  positions: Cell[];
}

export interface TumbleOrb extends Cell {
  value: number;
}

export interface TumbleStep {
  // The board this step scored, before anything popped.
  board: Board;
  wins: TumbleWin[];
  orbs: TumbleOrb[];
  // Sum of this step's win pays, edge-scaled.
  pay: number;
}

export interface TumbleRound {
  steps: TumbleStep[];
  // The board left once nothing else qualified — what the player is looking
  // at when the round ends. Equals the opening board on a losing spin.
  finalBoard: Board;
  // Summed pay of every step, edge-scaled. Bet multiplier, not chips.
  basePay: number;
  // Product applied to basePay: the summed orb values, or 1 when no orb
  // landed. Orbs alone never pay — they only multiply an existing win.
  multiplier: number;
  // basePay * multiplier.
  totalMultiplier: number;
}

// Which tier a count falls in: exactly the threshold, one above, or two-plus.
export function tierIndex(count: number, threshold: number): number {
  if (count >= threshold + 2) return 2;
  if (count === threshold + 1) return 1;
  return 0;
}

export function countSymbols(board: Board): Record<SymbolId, number> {
  const counts = { dot: 0, square: 0, diamond: 0, star: 0, seven: 0 } as Record<SymbolId, number>;
  for (const col of board) for (const symbol of col) counts[symbol]++;
  return counts;
}

// Every symbol is judged independently against its OWN threshold, so more
// than one can qualify on the same board — when that happens all of them pay
// and all of them pop. There is no single "winner" and so no tie-break rule.
export function evaluateBoard(board: Board, houseEdge?: number): TumbleWin[] {
  const counts = countSymbols(board);
  const scale = houseEdge === undefined ? 1 : edgeScale(houseEdge);
  const wins: TumbleWin[] = [];
  for (const symbol of SYMBOLS) {
    const count = counts[symbol.id];
    if (count < symbol.threshold) continue;
    const tier = tierIndex(count, symbol.threshold);
    const positions: Cell[] = [];
    board.forEach((col, c) =>
      col.forEach((s, r) => {
        if (s === symbol.id) positions.push({ col: c, row: r });
      })
    );
    wins.push({ symbol: symbol.id, count, tier, pay: symbol.pay[tier] * scale, positions });
  }
  return wins;
}

// Pops every winning cell and lets the survivors fall: within each column the
// cells that stayed keep their order and settle at the bottom, and fresh
// independent draws rain in above them. Because scoring only ever looks at
// per-symbol counts, this is exactly "replace each popped cell with a new
// draw" — the falling is what the player sees, not extra randomness.
export function tumble(board: Board, wins: TumbleWin[], rng: Rng): Board {
  const popped = new Set<SymbolId>(wins.map((w) => w.symbol));
  return board.map((col) => {
    const survivors = col.filter((s) => !popped.has(s));
    const fresh: SymbolId[] = [];
    for (let i = survivors.length; i < ROWS; i++) fresh.push(pickSymbol(rng));
    return [...fresh, ...survivors];
  });
}

export function rollOrbs(rng: Rng): TumbleOrb[] {
  let count = 0;
  const r = rng();
  let cum = 0;
  for (let i = 0; i < ORB_COUNT_WEIGHTS.length; i++) {
    cum += ORB_COUNT_WEIGHTS[i];
    if (r < cum) {
      count = i;
      break;
    }
  }
  const orbs: TumbleOrb[] = [];
  const taken = new Set<number>();
  for (let i = 0; i < count; i++) {
    // Orbs sit on top of cells purely for display, so a cell is only claimed
    // to stop two orbs stacking on the same square.
    let slot = Math.floor(rng() * CELLS);
    for (let guard = 0; guard < CELLS && taken.has(slot); guard++) slot = (slot + 1) % CELLS;
    taken.add(slot);
    orbs.push({
      col: slot % COLS,
      row: Math.floor(slot / COLS),
      value: pickWeighted(rng, ORB_VALUES, (o) => o.weight).value,
    });
  }
  return orbs;
}

// The chain ends with probability ~2/3 at every step, so this is unreachable
// in practice (P(L > 200) is around 1e-94) — it exists only so a bug can
// never hang the edge function.
const MAX_TUMBLES = 200;

export function playRound(rng: Rng, houseEdge?: number): TumbleRound {
  let board = spinBoard(rng);
  const steps: TumbleStep[] = [];
  let basePay = 0;
  let orbTotal = 0;

  for (let i = 0; i < MAX_TUMBLES; i++) {
    const wins = evaluateBoard(board, houseEdge);
    if (wins.length === 0) break;
    const orbs = rollOrbs(rng);
    const pay = wins.reduce((sum, w) => sum + w.pay, 0);
    steps.push({ board, wins, orbs, pay });
    basePay += pay;
    for (const orb of orbs) orbTotal += orb.value;
    board = tumble(board, wins, rng);
  }

  const multiplier = orbTotal === 0 ? 1 : orbTotal;
  return {
    steps,
    finalBoard: board,
    basePay: roundMoney(basePay),
    multiplier,
    totalMultiplier: roundMoney(basePay * multiplier),
  };
}

export function payoutFor(round: TumbleRound, bet: number): number {
  return roundMoney(bet * round.totalMultiplier);
}

// Bounds for the free-spins settings menu — enforced here, never trusted
// from the client (same rule as HOUSE_EDGE_OPTIONS above).
export const FREE_SPINS_MIN_BET_FLOOR = 1;
export const FREE_SPINS_MAX_BET_CEILING = 10_000_000;
export const FREE_SPINS_SPINS_MIN = 1;
export const FREE_SPINS_SPINS_MAX = 50;
export const DEFAULT_FREE_SPINS_COUNT = 10;

// Missing/invalid settings default to a disabled feature. Even when
// enabled, every field is clamped into range rather than trusted — the
// admin UI (GameSettingsModal.tsx) is not the authority, same rule
// index.ts's resolveHouseEdge follows for the house edge menu. Pure and
// dependency-free (no Deno/Supabase imports) so it's directly testable here,
// unlike resolveHouseEdge which stays in index.ts.
export function resolveFreeSpinsSettings(
  settings: unknown,
  regularMaxBet: number
): { enabled: boolean; minBet: number; maxBet: number; spinsPerPurchase: number } {
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).freeSpins : undefined;
  const fs = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;

  const defaultMaxBet = Math.max(FREE_SPINS_MIN_BET_FLOOR, regularMaxBet);
  if (!fs || fs.enabled !== true) {
    return {
      enabled: false,
      minBet: FREE_SPINS_MIN_BET_FLOOR,
      maxBet: defaultMaxBet,
      spinsPerPurchase: DEFAULT_FREE_SPINS_COUNT,
    };
  }

  let minBet = typeof fs.minBet === "number" && isFinite(fs.minBet) ? fs.minBet : FREE_SPINS_MIN_BET_FLOOR;
  minBet = Math.min(Math.max(minBet, FREE_SPINS_MIN_BET_FLOOR), FREE_SPINS_MAX_BET_CEILING);

  let maxBet = typeof fs.maxBet === "number" && isFinite(fs.maxBet) ? fs.maxBet : defaultMaxBet;
  maxBet = Math.min(Math.max(maxBet, minBet), FREE_SPINS_MAX_BET_CEILING);

  let spinsPerPurchase =
    typeof fs.spinsPerPurchase === "number" && Number.isInteger(fs.spinsPerPurchase)
      ? fs.spinsPerPurchase
      : DEFAULT_FREE_SPINS_COUNT;
  spinsPerPurchase = Math.min(Math.max(spinsPerPurchase, FREE_SPINS_SPINS_MIN), FREE_SPINS_SPINS_MAX);

  return { enabled: true, minBet, maxBet, spinsPerPurchase };
}
