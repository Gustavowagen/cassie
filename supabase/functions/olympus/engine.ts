// Gates of Olympus — the authoritative cascade engine.
//
// Pure and dependency-free (no Deno or Supabase imports) so it runs under
// vitest exactly as it runs in the edge function, and so the client mirror in
// src/lib/olympusEngine.ts can be checked against it constant-for-constant
// (see src/lib/olympusEngine.test.ts's parity block).
//
// Board layout is [col][row] with row 0 at the top, matching Tumble's
// TumbleBoard convention so the two games' rendering code reads alike.

export type Rng = () => number;

export const COLS = 6;
export const ROWS = 5;
export const CELLS = COLS * ROWS; // 30
/** A symbol pays when this many or more land anywhere on the board. */
export const MIN_MATCH = 8;
/**
 * Hard stop on a cascade. Unreachable in practice — a step clears with
 * probability ~0.27, so P(L > 200) is far below 1e-100 — it exists only so a
 * bug can never hang the edge function. Same guard Tumble's MAX_TUMBLES is.
 */
const MAX_STEPS = 200;

// Admins pick one of these; 0% is deliberately absent, the same product
// decision Tumble made — Olympus always keeps an edge of at least 1%.
export const HOUSE_EDGE_OPTIONS = [0.01, 0.02, 0.03, 0.04, 0.05] as const;
export const MIN_HOUSE_EDGE = HOUSE_EDGE_OPTIONS[0];
export const MAX_HOUSE_EDGE = HOUSE_EDGE_OPTIONS[HOUSE_EDGE_OPTIONS.length - 1];
export const DEFAULT_HOUSE_EDGE = 0.03;

export type OlyGemId = "sapphire" | "emerald" | "amethyst" | "ruby";
export type OlyHighId = "chalice" | "helmet" | "coin" | "bolt";
export type OlySymbolId = OlyGemId | OlyHighId;

/** A multiplier orb. Never pays on its own; its value joins the round total. */
export interface OlyOrb {
  kind: "orb";
  value: number;
}
/** null is a hole, and exists only mid-collapse — no board handed out has one. */
export type OlyCell = OlySymbolId | OlyOrb | null;
export type OlyBoard = OlyCell[][];

export interface Pos {
  col: number;
  row: number;
}
export interface OlyWin {
  symbol: OlySymbolId;
  count: number;
  positions: Pos[];
  /** This symbol's pay alone, already edge-scaled. */
  pay: number;
}
export interface OlyOrbHit extends Pos {
  value: number;
}

export interface OlyStep {
  /** The board exactly as it is rendered at the start of this step. */
  board: OlyBoard;
  /** Symbols that reached MIN_MATCH here. Empty on the settled final step. */
  wins: OlyWin[];
  /**
   * Multiplier orbs sitting on this step's board. Orbs survive the cascade, so
   * a later step's board still carries the ones that landed before it.
   */
  orbs: OlyOrbHit[];
  /** This step's pay, in multiples of the bet, already edge-scaled. */
  stepWin: number;
}

export interface OlympusRound {
  steps: OlyStep[];
  /** Sum of every step's pay, edge-scaled, before any multiplier. */
  baseWin: number;
  /**
   * Summed values of the orbs left standing on the settled board; 0 when none
   * landed or the round paid nothing. NEVER edge-scaled — a 50x badge on the
   * board is worth exactly 50x, the same rule Tumble's X follows.
   */
  multiplier: number;
  /** What the round actually pays, as a bet multiple. */
  totalWin: number;
}

export const isOrb = (cell: OlyCell): cell is OlyOrb =>
  typeof cell === "object" && cell !== null && cell.kind === "orb";

// ---------------------------------------------------------------- paytable

/**
 * Pays per symbol for counts of 8-9, 10-11, and 12+, in bet multiples. These
 * are the original game's published numbers and are deliberately left at them:
 * edgeScale below divides the whole table down to whichever edge the instance
 * runs at, so the shape a player recognises is preserved.
 */
export const PAYTABLE: Record<OlySymbolId, [number, number, number]> = {
  bolt: [10, 25, 50],
  coin: [2.5, 10, 25],
  helmet: [2, 5, 15],
  chalice: [1.5, 2, 12],
  ruby: [1, 1.5, 10],
  amethyst: [0.5, 1, 5],
  emerald: [0.4, 0.9, 4],
  sapphire: [0.25, 0.75, 2],
};

/** Board order, richest first — also the order the paytable panel lists them. */
export const SYMBOLS: OlySymbolId[] = [
  "bolt",
  "coin",
  "helmet",
  "chalice",
  "ruby",
  "amethyst",
  "emerald",
  "sapphire",
];

/**
 * Relative weights of the eight paying symbols. Only their ratios matter —
 * cellDistribution normalises them against the orb share below.
 *
 * Deliberately shallow. MIN_MATCH is 8 of 30 cells, so a symbol's win
 * probability is a binomial tail that collapses fast as its weight drops: the
 * steep, low-symbol-heavy table this started out with (sapphire 22 … bolt 4)
 * hit on 63% of spins, which is a demo, not a slot. Flattening toward uniform
 * pulls the board's hit rate down to roughly a quarter of spins — the band the
 * original game sits in — while keeping every symbol's ordering intact: a
 * rarer symbol still wins strictly less often than every commoner one
 * (asserted in engine.test.ts).
 */
export const SYMBOL_WEIGHTS: Record<OlySymbolId, number> = {
  sapphire: 16,
  emerald: 15,
  amethyst: 14,
  ruby: 13,
  chalice: 12,
  helmet: 11,
  coin: 10,
  bolt: 9,
};

/**
 * Orb face values, one per painted badge in public/olympus/multipliers. The
 * number is part of the art, so a value with no badge cannot be dealt.
 * Weighted so 2x is ordinary and 50x is a story.
 */
export const ORB_VALUE_WEIGHTS: { value: number; weight: number }[] = [
  { value: 2, weight: 0.7 },
  { value: 5, weight: 0.24 },
  { value: 25, weight: 0.045 },
  { value: 50, weight: 0.015 },
];
/** Every value an orb can carry — what the art and the preloader key on. */
export const ORB_VALUES = ORB_VALUE_WEIGHTS.map((o) => o.value);

/**
 * An orb's share of a single cell draw, in the base game. An orb is drawn
 * exactly like a paying symbol — same distribution, same fall — it simply
 * never counts toward a match (see findWins).
 *
 * 1% per cell puts at least one orb on the opening board about a quarter of
 * the time, so the feature is a regular sight rather than something a player
 * has to be told exists. Raising it is the single most powerful lever on RTP
 * in the whole engine — orbs sum, and the sum multiplies the entire cascade —
 * so it is also what BASELINE_RTP is most sensitive to. Re-measure after any
 * change (npm run calibrate:olympus).
 */
export const ORB_WEIGHT = 0.01;

/**
 * The same draw during free spins, where orbs land three times as often. This
 * is what makes the feature a different game rather than fifteen prepaid
 * spins, and together with the multiplier persisting across the batch (see
 * playFreeSpins) it is the whole reason a batch is worth many times its
 * per-spin stake.
 */
export const FREE_SPINS_ORB_WEIGHT = 0.03;

/** Spins in one purchased batch — the original game's count. */
export const FREE_SPINS_COUNT = 15;

/**
 * Long-run RTP of the raw pay table above, at scale 1, in the base game.
 * Measured empirically — the cascade has no closed form here because orbs
 * occupy real board cells (so they compete with paying symbols for space) AND
 * survive the cascade (so a step's orb total is coupled to every step before
 * it). Same reason Tumble's own baseline is a simulated figure rather than an
 * exact solve.
 *
 * It exceeds 1 because the raw table is deliberately left at the original
 * game's human-readable numbers; edgeScale below divides it back down so
 * whichever edge the instance runs at becomes the realized RTP.
 *
 * 40,000,000 simulated rounds (Math.random, scale 1): mean
 * 1.0388484937004534, 95% interval ±0.00278 (0.27% relative). Hit rate at
 * these weights is 27.1% of spins. See scripts/calibrate-olympus.mjs, which
 * regenerates both figures below.
 */
export const BASELINE_RTP = 1.0388484937004534;

/**
 * Expected return of one FREE_SPINS_COUNT batch, in multiples of the PER-SPIN
 * stake, at scale 1. Far above 15x BASELINE_RTP because the bank persists:
 * every orb collected during the batch keeps multiplying every later win that
 * unlocks it. 2,000,000 simulated batches (30,000,000 spins): mean
 * 60.52463467506568, 95% interval ±0.164 (0.27% relative).
 *
 * It was 72.93 before playFreeSpins gated the bank on the spin in front of it
 * collecting an orb of its own. That gate costs the feature 17% of its value —
 * roughly a third of paying free spins land no orb, and those now pay flat
 * instead of riding whatever is banked — and the price below moves with it, so
 * a batch still returns (1 - houseEdge) of what it cost.
 *
 * Together with BASELINE_RTP this prices a batch at 58.3x the per-spin stake
 * (see freeSpinsCostMultiplier). BASELINE_RTP itself is untouched by that
 * change — the base game has no bank — and the same run re-measured it at
 * 1.0430 ±1.2% over 2,000,000 rounds, consistent with the far tighter 40M
 * figure above, which is therefore the one kept.
 */
export const FREE_SPINS_BASELINE_EV = 60.52463467506568;

/**
 * houseEdge only ever scales how much a win PAYS. It never touches the symbol
 * weights, the orb weight, or MIN_MATCH — so hit frequency, cascade length
 * and how often orbs land are identical at every edge setting, and only the
 * pay table moves.
 */
export function edgeScale(houseEdge: number): number {
  return (1 - houseEdge) / BASELINE_RTP;
}

/**
 * The mathematically fair price of a batch, as a multiple of the per-spin
 * stake: 58.261 at the calibrated figures above.
 *
 * Note it takes no edge: the (1 - houseEdge) in edgeScale cancels against the
 * (1 - houseEdge) the price has to return, leaving FREE_SPINS_BASELINE_EV /
 * BASELINE_RTP. That is not a coincidence to be tidied away — it is the
 * statement that a bought batch returns exactly the same fraction of its price
 * as a base spin returns of its bet, at every edge setting. The edge on the
 * feature is taken in the price, not per spin.
 */
export const FREE_SPINS_FAIR_MULTIPLIER = FREE_SPINS_BASELINE_EV / BASELINE_RTP;

/**
 * What a batch is actually charged at: the fair multiple, rounded to a whole
 * number.
 *
 * The rounding is the point. A price of 58.261x turns every stake on the
 * ladder into a fractional bill — 1 chip buys at 58.261, 5 at 291.31, 20 at
 * 1165.23 — and a player adjusting the stake watches a number with three
 * decimals in it slide around. At a whole 58x every stop on Olympus's
 * 1 / 2 / 5 STAKE_LADDER prices to a whole, round figure: 58, 116, 290, 580,
 * 1,160, 2,900.
 *
 * What it costs is 0.45% of the price, and the direction matters: rounding
 * DOWN off the fair figure means a bought batch returns marginally more than
 * (1 - houseEdge) of what was paid for it, never less. A tidier number is
 * worth that much in the player's favour; it would not be worth it in the
 * house's, which is what the engine test pins.
 *
 * Sub-chip stakes bill whole only where the price shares the fraction's
 * factors, and rounding the price itself at that scale would distort it far
 * past a rounding error. 58 is even, so the 0.5 stop still buys at a whole 29;
 * 70 was also a multiple of ten, so before the bank was gated the 0.1 and 0.2
 * stops were whole too and now bill at 5.8 and 11.6. Buying that back with a
 * tidier 60x would put the price 3% ABOVE fair — the one direction the
 * rounding is not allowed to go.
 */
export const FREE_SPINS_MULTIPLIER = Math.round(FREE_SPINS_FAIR_MULTIPLIER);

/** What one batch of free spins costs, as a multiple of the per-spin stake. */
export function freeSpinsCostMultiplier(): number {
  return FREE_SPINS_MULTIPLIER;
}

/** The price of a batch at a given per-spin stake, in chips. */
export function freeSpinsCost(stake: number): number {
  return roundMoney(stake * freeSpinsCostMultiplier());
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export function payFor(symbol: OlySymbolId, count: number): number {
  if (count < MIN_MATCH) return 0;
  const [low, mid, high] = PAYTABLE[symbol];
  if (count <= 9) return low;
  if (count <= 11) return mid;
  return high;
}

// --------------------------------------------------------------------- rng

/** mulberry32 — small, fast, and seedable so a round can be reproduced. */
export function makeRng(seed: number): Rng {
  let a = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ the cell draw

/** One cell's outcome: a paying symbol, or the orb category. */
export type CellPick = OlySymbolId | "orb";
export type CellDistribution = [CellPick, number][];

/**
 * A cumulative distribution over the eight symbols plus "orb", built once per
 * round rather than per cell. The last entry is the fallback for the r === 1
 * edge (float rounding), never a silent bias.
 */
export function cellDistribution(orbWeight: number): CellDistribution {
  const symbolTotal = SYMBOLS.reduce((sum, id) => sum + SYMBOL_WEIGHTS[id], 0);
  const share = 1 - orbWeight;
  const cum: CellDistribution = [];
  let acc = 0;
  for (const id of SYMBOLS) {
    acc += (SYMBOL_WEIGHTS[id] / symbolTotal) * share;
    cum.push([id, acc]);
  }
  cum.push(["orb", 1]);
  return cum;
}

const ORB_CUM: [number, number][] = (() => {
  const total = ORB_VALUE_WEIGHTS.reduce((sum, o) => sum + o.weight, 0);
  const cum: [number, number][] = [];
  let acc = 0;
  for (const o of ORB_VALUE_WEIGHTS) {
    acc += o.weight / total;
    cum.push([o.value, acc]);
  }
  return cum;
})();

function pickOrbValue(rng: Rng): number {
  const r = rng();
  for (const [value, edge] of ORB_CUM) if (r < edge) return value;
  return ORB_CUM[ORB_CUM.length - 1][0];
}

/** Draws one cell. An orb roll spends a second rng() call on its face value. */
export function drawCell(rng: Rng, dist: CellDistribution): OlyCell {
  const r = rng();
  for (const [pick, edge] of dist) {
    if (r < edge) {
      return pick === "orb" ? { kind: "orb", value: pickOrbValue(rng) } : pick;
    }
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

// ------------------------------------------------------------ board pieces

export function findWins(board: OlyBoard, houseEdge?: number): OlyWin[] {
  const scale = houseEdge === undefined ? 1 : edgeScale(houseEdge);
  const found = new Map<OlySymbolId, Pos[]>();
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const cell = board[col][row];
      // Orbs and holes are not symbols, so they never count toward a win.
      if (cell === null || isOrb(cell)) continue;
      const at = found.get(cell);
      if (at) at.push({ col, row });
      else found.set(cell, [{ col, row }]);
    }
  }
  const wins: OlyWin[] = [];
  // Iterate SYMBOLS rather than the map so a step's wins always come back
  // richest-first, whatever order the cells happened to be scanned in.
  for (const symbol of SYMBOLS) {
    const positions = found.get(symbol);
    if (positions && positions.length >= MIN_MATCH) {
      wins.push({
        symbol,
        count: positions.length,
        positions,
        pay: payFor(symbol, positions.length) * scale,
      });
    }
  }
  return wins;
}

/** Survivors fall to the bottom of their own column; holes end up on top. */
export function collapse(board: OlyBoard): OlyBoard {
  return board.map((col) => {
    const survivors = col.filter((cell) => cell !== null);
    const holes = Array<OlyCell>(ROWS - survivors.length).fill(null);
    return [...holes, ...survivors];
  });
}

function clearCells(board: OlyBoard, cleared: Pos[]): OlyBoard {
  const next = board.map((col) => [...col]);
  for (const { col, row } of cleared) next[col][row] = null;
  return next;
}

/**
 * Fills every hole with a fresh independent draw. Because scoring only ever
 * looks at per-symbol counts, this is exactly "replace each popped cell" — the
 * falling is what the player sees, not extra randomness. An orb can only ever
 * arrive in a hole, so it always drops in from above the board rather than
 * popping into existence on a cell that stayed put.
 */
function fillHoles(board: OlyBoard, rng: Rng, dist: CellDistribution): OlyBoard {
  return board.map((col) => col.map((cell) => (cell === null ? drawCell(rng, dist) : cell)));
}

export function orbsOn(board: OlyBoard): OlyOrbHit[] {
  const hits: OlyOrbHit[] = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const cell = board[col][row];
      if (isOrb(cell)) hits.push({ col, row, value: cell.value });
    }
  }
  return hits;
}

export function freshBoard(rng: Rng, dist: CellDistribution): OlyBoard {
  const empty: OlyBoard = Array.from({ length: COLS }, () => Array<OlyCell>(ROWS).fill(null));
  // Every cell is a hole on a fresh board, so the whole board drops in.
  return fillHoles(empty, rng, dist);
}

// -------------------------------------------------------------------- spin

/**
 * Plays one round to the end. `orbWeight` is the base game's by default and
 * the free-spins rate when playFreeSpins calls it.
 */
export function playRound(
  rng: Rng,
  houseEdge?: number,
  orbWeight: number = ORB_WEIGHT
): OlympusRound {
  const dist = cellDistribution(orbWeight);
  const steps: OlyStep[] = [];
  let board = freshBoard(rng, dist);

  for (let i = 0; i < MAX_STEPS; i++) {
    const wins = findWins(board, houseEdge);
    const orbs = orbsOn(board);
    const stepWin = wins.reduce((sum, w) => sum + w.pay, 0);
    steps.push({ board, wins, orbs, stepWin });
    if (wins.length === 0) break;
    // Only the winning symbols leave. Orbs ride the cascade out: they are not
    // null, so collapse drops them down their own column with the rest of the
    // survivors, and they keep standing until the round is done.
    const cleared = wins.flatMap((w) => w.positions);
    board = fillHoles(collapse(clearCells(board, cleared)), rng, dist);
  }

  // Only reachable if a cascade somehow ran the full MAX_STEPS. A round must
  // still end on a board that has settled, so roll one that has.
  if (steps[steps.length - 1].wins.length > 0) {
    let settled = board;
    while (findWins(settled).length > 0) settled = freshBoard(rng, dist);
    steps.push({ board: settled, wins: [], orbs: orbsOn(settled), stepWin: 0 });
  }

  // Rounded to chip precision BEFORE the multiplier is applied, so that the
  // arithmetic a player can do on screen actually works out: the banner shows
  // the base win and the multiplier, and their product has to be the total it
  // also shows. Multiplying the unrounded sum instead left the two off by up
  // to the multiplier times a rounding error — small, but visible at x80.
  const baseWin = roundMoney(steps.reduce((sum, s) => sum + s.stepWin, 0));
  // Orbs only multiply a win. On a round that pays nothing they are left on
  // the board uncollected, so the round reports no multiplier at all rather
  // than a "5x" that multiplied zero.
  //
  // Every orb the round dealt is still standing on the settled board, so that
  // one board is the whole tally — summing per step would count a survivor
  // once for every step it sat through.
  const settledOrbs = steps[steps.length - 1].orbs;
  const multiplier = baseWin > 0 ? settledOrbs.reduce((sum, o) => sum + o.value, 0) : 0;
  return {
    steps,
    baseWin,
    multiplier,
    totalWin: roundMoney(multiplier > 0 ? baseWin * multiplier : baseWin),
  };
}

/** What a resolved round pays at a given stake, in chips. */
export function payoutFor(round: OlympusRound, bet: number): number {
  return roundMoney(bet * round.totalWin);
}

// -------------------------------------------------------------- free spins

export interface OlyFreeSpin {
  /**
   * The spin itself. Its own `multiplier` is what THIS spin collected and its
   * `totalWin` is what it would have paid standing alone — inside a batch
   * neither is the money. `spinWin` below is.
   */
  round: OlympusRound;
  /** The banked multiplier this spin started under. */
  multiplierBefore: number;
  /** …and ended under, once its own orbs were added. */
  multiplierAfter: number;
  /**
   * The multiplier that actually multiplied THIS spin: the full bank when the
   * spin collected an orb of its own, and 0 when it did not — see
   * playFreeSpins. 0 means the spin paid its raw win, bank or no bank, so this
   * is what the win banner must show rather than multiplierAfter.
   */
  multiplierApplied: number;
  /** What this spin pays, as a bet multiple: baseWin x multiplierApplied. */
  spinWin: number;
}

export interface OlyFreeSpinsBatch {
  spins: OlyFreeSpin[];
  /** Sum of every spin's pay, in multiples of the per-spin stake. */
  totalWin: number;
}

/**
 * A bought batch of free spins. Unlike the base game — and unlike Tumble's
 * feature buy, which is genuinely just N prepaid spins — ONE multiplier bank
 * runs through the whole batch: every orb collected joins it, and it is never
 * spent, reset or wiped.
 *
 * The bank is DORMANT, though, unless the spin in front of it collected an orb
 * of its own. A spin that lands a 5x with 20x already banked pays its win at
 * 25x; a spin that pays with no orb on its board pays its raw win and leaves
 * the 20x sitting there for whichever later spin does land one. That gate is
 * the whole tension of the feature — the bank is only ever worth what the next
 * orb unlocks — and it is what separates a batch from fifteen spins that all
 * ride one number for free.
 *
 * Orbs are collected on the same terms as the base game: only a spin that
 * actually pays sweeps the orbs standing on its settled board. Orbs left by a
 * spin that paid nothing are not banked — round.multiplier is already 0 in
 * that case, so this falls out rather than being special-cased. The same 0 is
 * what closes the gate above, so a spin that pays nothing also unlocks
 * nothing.
 */
export function playFreeSpins(
  rng: Rng,
  houseEdge?: number,
  count: number = FREE_SPINS_COUNT
): OlyFreeSpinsBatch {
  const spins: OlyFreeSpin[] = [];
  let running = 0;
  let totalWin = 0;

  for (let i = 0; i < count; i++) {
    const round = playRound(rng, houseEdge, FREE_SPINS_ORB_WEIGHT);
    const multiplierBefore = running;
    running += round.multiplier;
    // The gate: this spin's own orbs are the key to the bank. Without one the
    // bank stays locked — whatever is standing in it — and the spin pays flat.
    const multiplierApplied = round.multiplier > 0 ? running : 0;
    // `|| 1` rather than a branch: a spin paying unmultiplied pays exactly what
    // an unmultiplied base round does.
    const spinWin = roundMoney(round.baseWin * (multiplierApplied || 1));
    spins.push({
      round,
      multiplierBefore,
      multiplierAfter: running,
      multiplierApplied,
      spinWin,
    });
    totalWin += spinWin;
  }

  return { spins, totalWin: roundMoney(totalWin) };
}

// ------------------------------------------------------------- settings

/**
 * Missing/off-menu settings fall back to DEFAULT_HOUSE_EDGE — which is what
 * every freshly enabled casino_games row (settings = '{}') gets, so a casino
 * that never opens the settings modal runs the 3% the game is designed
 * around. This is also the authoritative gate on the 1-5% menu: even if the
 * admin UI's dropdown were bypassed, an out-of-range edge is coerced rather
 * than trusted. Float tolerant because `raw` round-trips through JSON.
 */
export function resolveHouseEdge(settings: unknown): number {
  const raw =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).houseEdge
      : undefined;
  if (typeof raw === "number" && HOUSE_EDGE_OPTIONS.some((o) => Math.abs(o - raw) < 1e-9)) {
    return raw;
  }
  return DEFAULT_HOUSE_EDGE;
}

/**
 * Whether this instance offers the feature buy. Unlike Tumble's, there is
 * nothing to configure but the switch: the batch is always FREE_SPINS_COUNT
 * spins and its price is fixed by the maths (freeSpinsCostMultiplier), not by
 * an admin. The per-spin stake a player may buy at is bounded by the
 * instance's own min_bet/max_bet, so there is no second set of limits either.
 *
 * Defaults to ON — the feature is part of the game rather than an extra, and
 * a freshly enabled row (settings = '{}') should play the whole game.
 */
export function freeSpinsEnabled(settings: unknown): boolean {
  const raw =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).freeSpins
      : undefined;
  if (raw && typeof raw === "object") {
    return (raw as Record<string, unknown>).enabled !== false;
  }
  return true;
}
