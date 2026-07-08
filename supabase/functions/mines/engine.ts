export type Rng = () => number;

export const GRID_SIZE = 25;
export const HOUSE_EDGE = 0.02;
export const MIN_MINES = 1;
export const MAX_MINES = 24;

export type Outcome = "cashed_out" | "hit_mine" | "cleared";

export interface RoundState {
  mines: number[];
  revealed: number[];
  minesCount: number;
  bet: number;
  status: "active" | "complete";
  outcome?: Outcome;
  payout?: number;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Full Fisher-Yates shuffle, then take the first `count` indices — picks
// `count` unique values from [0, GRID_SIZE) uniformly at random.
export function placeMines(count: number, rng: Rng): number[] {
  const pool = Array.from({ length: GRID_SIZE }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

// Fair multiplier for surviving `picks` reveals with `minesCount` mines on
// the board, scaled down by HOUSE_EDGE. picks = 0 returns (1 - HOUSE_EDGE).
export function multiplierForPicks(picks: number, minesCount: number): number {
  let fairOdds = 1;
  for (let i = 0; i < picks; i++) {
    fairOdds *= (GRID_SIZE - minesCount - i) / (GRID_SIZE - i);
  }
  return (1 / fairOdds) * (1 - HOUSE_EDGE);
}

export function startRound(opts: { bet: number; minesCount: number; rng: Rng }): RoundState {
  return {
    mines: placeMines(opts.minesCount, opts.rng),
    revealed: [],
    minesCount: opts.minesCount,
    bet: opts.bet,
    status: "active",
  };
}

export function revealTile(prev: RoundState, tile: number): RoundState {
  if (prev.status !== "active") throw new Error("Round is already complete");
  if (!Number.isInteger(tile) || tile < 0 || tile >= GRID_SIZE) {
    throw new Error("Tile out of range");
  }
  if (prev.revealed.includes(tile)) throw new Error("Tile already revealed");

  const state: RoundState = { ...prev, revealed: [...prev.revealed, tile] };

  if (state.mines.includes(tile)) {
    state.status = "complete";
    state.outcome = "hit_mine";
    state.payout = 0;
    return state;
  }

  const safeTiles = GRID_SIZE - state.minesCount;
  if (state.revealed.length === safeTiles) {
    state.status = "complete";
    state.outcome = "cleared";
    state.payout = roundMoney(state.bet * multiplierForPicks(state.revealed.length, state.minesCount));
  }
  return state;
}

export function cashOut(prev: RoundState): RoundState {
  if (prev.status !== "active") throw new Error("Round is already complete");
  if (prev.revealed.length === 0) throw new Error("Reveal at least one tile before cashing out");
  return {
    ...prev,
    status: "complete",
    outcome: "cashed_out",
    payout: roundMoney(prev.bet * multiplierForPicks(prev.revealed.length, prev.minesCount)),
  };
}

export interface MinesState {
  roundId: string;
  status: "active" | "complete";
  minesCount: number;
  bet: number;
  revealed: number[];
  mines: number[] | null;
  outcome?: Outcome;
  multiplier: number;
  nextMultiplier: number | null;
  payout: number | null;
  balance: number;
}

export function sanitize(state: RoundState, roundId: string, balance: number): MinesState {
  const safeTiles = GRID_SIZE - state.minesCount;
  const atMax = state.revealed.length >= safeTiles;
  return {
    roundId,
    status: state.status,
    minesCount: state.minesCount,
    bet: state.bet,
    revealed: state.revealed,
    mines: state.status === "complete" ? state.mines : null,
    outcome: state.outcome,
    multiplier: multiplierForPicks(state.revealed.length, state.minesCount),
    nextMultiplier:
      state.status === "complete" || atMax
        ? null
        : multiplierForPicks(state.revealed.length + 1, state.minesCount),
    payout: state.payout ?? null,
    balance,
  };
}
