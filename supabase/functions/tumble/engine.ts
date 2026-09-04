export type Rng = () => number;
export type SymbolId = "dot" | "square" | "diamond" | "star" | "seven";
export type CellId = SymbolId | "x";

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

// Weights match the `slots` game, scaled down by (1 - X_WEIGHT) so a cell's
// full distribution (these five plus "x" below) still sums to 1 — so the
// shared design skins in src/lib/slotsDesigns.ts apply unchanged and the
// relative shape between symbols (and therefore the "rarer needs fewer cells
// but still wins less often" invariant) is untouched. Thresholds and pays are
// specific to this board and were derived by exact enumeration, not
// simulation — see the design doc referenced by BASELINE_RTP below.
//
// Opening-board win probability per symbol (exact binomial tail over 30
// cells), which is what the "rarer symbol, fewer cells, still rarer win"
// balance rests on:
//   dot     15 cells -> 6.52%      star     9 cells -> 0.69%
//   square  12 cells -> 5.07%      seven    8 cells -> 0.20%
//   diamond 11 cells -> 2.56%
// (figures predate the X symbol's cell share; see engine.test.ts for the
// exact post-X binomial tails, which shrink slightly but keep the ordering.)
export const SYMBOLS: SymbolConfig[] = [
  { id: "dot", weight: 0.35 * 0.97, threshold: 15, pay: [0.25, 0.6, 1.5] },
  { id: "square", weight: 0.25 * 0.97, threshold: 12, pay: [0.6, 1.5, 4] },
  { id: "diamond", weight: 0.2 * 0.97, threshold: 11, pay: [1.2, 3, 8] },
  { id: "star", weight: 0.12 * 0.97, threshold: 9, pay: [2.5, 6.5, 18] },
  { id: "seven", weight: 0.08 * 0.97, threshold: 8, pay: [6, 16, 50] },
];

// The multiplier symbol. It drops into a cell exactly like the five paying
// symbols above — same odds mechanism, same fall/pop animation — but never
// counts toward any symbol's threshold and never pays on its own (see
// countSymbols/evaluateBoard, which both ignore it). Whenever a tumble
// already pays, every X currently on the board is swept up: its value adds
// to the round's running multiplier and the cell pops and refills alongside
// the winning symbols, so the same X can never be counted twice. X values are
// NEVER scaled by the house edge — the player sees "x25" on the board and
// gets exactly x25; only the pay table moves with the edge.
export const X_WEIGHT = 0.03;
export const X_VALUES: { value: number; weight: number }[] = [
  { value: 2, weight: 0.73 },
  { value: 3, weight: 0.15 },
  { value: 5, weight: 0.06 },
  { value: 10, weight: 0.04 },
  { value: 25, weight: 0.02 },
];

// Long-run RTP of the raw pay table above, including the X symbol, at scale
// 1. Unlike the old orb feature (an extra draw independent of the board, so
// the whole cascade was solvable exactly as a 324,632-state Markov chain over
// per-symbol counts), X occupies real board cells: it competes with the five
// paying symbols for space, and how many X land on a given winning step is
// coupled to that step's board state. That breaks the independence the exact
// solve leaned on and blows the state space up ~6x, so this is calibrated
// empirically instead — 20,000,000 simulated rounds (Math.random, scale 1):
// mean 1.4081232249959508, stderr 0.0027 (95% CI ±0.0054, ~0.4% relative).
// See docs/superpowers/specs/2026-08-08-tumble-game-design.md for the
// original exact-solve era and the design note on this switch.
//
// It exceeds 1 because the raw table is deliberately authored at
// human-readable numbers; edgeScale below divides it back down so whichever
// edge the admin picks becomes the (statistically) realized RTP.
//
// Jumped up from the pre-2026-08-21 figure (1.0474430474956598) when
// playRound started sweeping any X left on finalBoard by the last winning
// tumble's own refill into the multiplier (previously silently discarded) —
// a real shift in the raw table's average payout, not drift to chase.
export const BASELINE_RTP = 1.4081232249959508;

// houseEdge only ever scales how much a win PAYS. It never touches the
// symbol weights or the thresholds, so hit frequency, cascade length and X
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

// The id-only draw over all 6 cell categories (5 paying symbols + "x").
// Standalone (not composed with a value roll) so callers that only need the
// id — like counting how a cell type is distributed — don't pay for one.
export function pickCellId(rng: Rng): CellId {
  return pickWeighted<{ id: CellId; weight: number }>(
    rng,
    [...SYMBOLS.map((s) => ({ id: s.id as CellId, weight: s.weight })), { id: "x", weight: X_WEIGHT }],
    (item) => item.weight
  ).id;
}

export function pickSymbol(rng: Rng): SymbolId {
  return pickWeighted(rng, SYMBOLS, (s) => s.weight).id;
}

// A plain symbol id for the five paying symbols, or a tagged object for the
// multiplier symbol (which needs to carry its own rolled value). Distinguish
// with `typeof cell === "string"` rather than a shared `id` field on both, so
// the common case (a paying symbol) stays a bare string through the engine.
export interface XCell {
  id: "x";
  value: number;
}
export type BoardCell = SymbolId | XCell;

// Draws one cell: an "x" roll spends a second rng() call on its value, same
// pattern the old orb-value draw used.
export function pickCell(rng: Rng): BoardCell {
  const id = pickCellId(rng);
  if (id === "x") return { id: "x", value: pickWeighted(rng, X_VALUES, (v) => v.weight).value };
  return id;
}

// board[col][row], row 0 = top. Columns are the unit that symbols fall
// through, so this orientation is what makes the tumble refill natural.
export type Board = BoardCell[][];

export function spinBoard(rng: Rng): Board {
  const board: Board = [];
  for (let c = 0; c < COLS; c++) {
    const col: BoardCell[] = [];
    for (let r = 0; r < ROWS; r++) col.push(pickCell(rng));
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

export interface TumbleStep {
  // The board this step scored, before anything popped. X cells (and their
  // rolled values) live directly on it — nothing else carries their position.
  board: Board;
  wins: TumbleWin[];
  // Sum of every X currently on the board this step, edge-scale-exempt. 0
  // when none landed.
  xValue: number;
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
  // Sum of every step's xValue, PLUS any X left on finalBoard by the last
  // winning tumble's own refill (see playRound) — or 1 when none landed all
  // round. X symbols alone never pay — they only multiply an existing win.
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

// Ignores X cells — they never count toward any symbol's threshold.
export function countSymbols(board: Board): Record<SymbolId, number> {
  const counts = { dot: 0, square: 0, diamond: 0, star: 0, seven: 0 } as Record<SymbolId, number>;
  for (const col of board) for (const cell of col) if (typeof cell === "string") counts[cell]++;
  return counts;
}

export function xValueOnBoard(board: Board): number {
  let total = 0;
  for (const col of board) for (const cell of col) if (typeof cell !== "string") total += cell.value;
  return total;
}

// Every symbol is judged independently against its OWN threshold, so more
// than one can qualify on the same board — when that happens all of them pay
// and all of them pop. There is no single "winner" and so no tie-break rule.
// X cells are invisible here — see countSymbols.
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
      col.forEach((cell, r) => {
        if (cell === symbol.id) positions.push({ col: c, row: r });
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
//
// tumble() is only ever called after a win (see playRound), so every X
// currently on the board has already had its value collected into that
// step's xValue — they always pop here too, never surviving to be
// double-counted on a later step.
export function tumble(board: Board, wins: TumbleWin[], rng: Rng): Board {
  const popped = new Set<SymbolId>(wins.map((w) => w.symbol));
  return board.map((col) => {
    const survivors = col.filter((cell) => typeof cell === "string" && !popped.has(cell));
    const fresh: BoardCell[] = [];
    for (let i = survivors.length; i < ROWS; i++) fresh.push(pickCell(rng));
    return [...fresh, ...survivors];
  });
}

// The chain ends with probability ~2/3 at every step, so this is unreachable
// in practice (P(L > 200) is around 1e-94) — it exists only so a bug can
// never hang the edge function.
const MAX_TUMBLES = 200;

export function playRound(rng: Rng, houseEdge?: number): TumbleRound {
  let board = spinBoard(rng);
  const steps: TumbleStep[] = [];
  let basePay = 0;
  let xTotal = 0;

  for (let i = 0; i < MAX_TUMBLES; i++) {
    const wins = evaluateBoard(board, houseEdge);
    if (wins.length === 0) break;
    const pay = wins.reduce((sum, w) => sum + w.pay, 0);
    const xValue = xValueOnBoard(board);
    steps.push({ board, wins, xValue, pay });
    basePay += pay;
    xTotal += xValue;
    board = tumble(board, wins, rng);
  }

  // A winning tumble's own refill can drop a fresh X that never gets a
  // further winning step to sweep it up — the player still watched it land
  // as part of this win's cascade, so it isn't discarded: any X left on the
  // board is collected once, as long as the round won at least once. A total
  // loss (steps.length === 0) never sweeps anything, since X never pays on
  // its own regardless of what's sitting on the opening board.
  if (steps.length > 0) xTotal += xValueOnBoard(board);

  const multiplier = xTotal === 0 ? 1 : xTotal;
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
//
// These bound the TOTAL COST of a purchase, not the per-spin stake: the
// player buys a batch for a price and the per-spin stake is derived from it
// (cost / spinsPerPurchase), so the price is the number both the admin and
// the player actually reason about. Before 2026-08-30 these bounded the
// per-spin stake instead — a stored config's minBet/maxBet is read as
// minCost/maxCost, see resolveFreeSpinsSettings.
export const FREE_SPINS_MIN_COST_FLOOR = 0.1;
export const FREE_SPINS_MAX_COST_CEILING = 10_000_000;
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
): { enabled: boolean; minCost: number; maxCost: number; spinsPerPurchase: number } {
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).freeSpins : undefined;
  const fs = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;

  let spinsPerPurchase =
    typeof fs?.spinsPerPurchase === "number" && Number.isInteger(fs.spinsPerPurchase)
      ? (fs.spinsPerPurchase as number)
      : DEFAULT_FREE_SPINS_COUNT;
  spinsPerPurchase = Math.min(Math.max(spinsPerPurchase, FREE_SPINS_SPINS_MIN), FREE_SPINS_SPINS_MAX);

  // A row an admin never configured prices a batch at the instance's own max
  // bet per spin — the same purchase the player could make by hand — capped
  // at the ceiling.
  const defaultMaxCost = clampCost(regularMaxBet * spinsPerPurchase, FREE_SPINS_MIN_COST_FLOOR);
  if (!fs || fs.enabled !== true) {
    return {
      enabled: false,
      minCost: FREE_SPINS_MIN_COST_FLOOR,
      maxCost: defaultMaxCost,
      spinsPerPurchase,
    };
  }

  // minBet/maxBet are the pre-2026-08-30 field names, when these bounded the
  // per-spin stake — read as costs so a config saved back then keeps working
  // without a migration.
  const rawMin = pickNumber(fs.minCost, fs.minBet);
  const rawMax = pickNumber(fs.maxCost, fs.maxBet);

  const minCost = clampCost(rawMin ?? FREE_SPINS_MIN_COST_FLOOR, FREE_SPINS_MIN_COST_FLOOR);
  const maxCost = clampCost(rawMax ?? defaultMaxCost, minCost);

  return { enabled: true, minCost, maxCost, spinsPerPurchase };
}

// First of the candidates that's a usable number, or undefined if none is.
function pickNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) if (typeof c === "number" && isFinite(c)) return c;
  return undefined;
}

function clampCost(n: number, floor: number): number {
  return Math.min(Math.max(n, floor), FREE_SPINS_MAX_COST_CEILING);
}
