export type Rng = () => number;

export const HOUSE_EDGE = 0.01;
export const GROWTH_RATE = 0.115; // "Gentle" pacing, approved via live preview
export const MAX_CRASH_POINT = 100; // sanity cap on the rare extreme tail

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Standard crash-game formula: guarantees a fixed HOUSE_EDGE regardless of
// what multiplier a player targets. P(crash_point >= M) = (1 - HOUSE_EDGE) / M,
// so expected payout at any cash-out target M is bet * (1 - HOUSE_EDGE).
export function generateCrashPoint(rng: Rng): number {
  const r = rng();
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  const capped = Math.min(raw, MAX_CRASH_POINT);
  return Math.max(1, Math.floor(capped * 100) / 100);
}

// Public growth formula — same one the client mirrors for cosmetic
// rendering. t = seconds elapsed since the round started.
export function multiplierAt(elapsedSeconds: number): number {
  return Math.exp(GROWTH_RATE * elapsedSeconds);
}

export type CrashOutcome = "cashed_out" | "busted";

export interface CrashRoundState {
  bet: number;
  startedAt: string; // ISO timestamp
  crashPoint: number;
  status: "active" | "complete";
  outcome?: CrashOutcome;
  payout?: number;
  cashedOutAt?: number; // the multiplier at the moment of a winning cashout
}

export function startRound(opts: { bet: number; startedAt: string; rng: Rng }): CrashRoundState {
  return {
    bet: opts.bet,
    startedAt: opts.startedAt,
    crashPoint: generateCrashPoint(opts.rng),
    status: "active",
  };
}

export function resolveCashout(prev: CrashRoundState, now: number): CrashRoundState {
  if (prev.status !== "active") throw new Error("Round is already complete");

  const elapsed = (now - new Date(prev.startedAt).getTime()) / 1000;
  const current = multiplierAt(elapsed);

  if (current < prev.crashPoint) {
    return {
      ...prev,
      status: "complete",
      outcome: "cashed_out",
      cashedOutAt: roundMoney(current),
      payout: roundMoney(prev.bet * current),
    };
  }

  return {
    ...prev,
    status: "complete",
    outcome: "busted",
    payout: 0,
  };
}

export interface CrashSanitizedState {
  roundId: string;
  status: "active" | "complete";
  bet: number;
  startedAt: string;
  crashPoint: number | null; // only revealed once the round is complete
  outcome?: CrashOutcome;
  payout: number | null;
  cashedOutAt: number | null;
  balance: number;
}

export function sanitize(state: CrashRoundState, roundId: string, balance: number): CrashSanitizedState {
  return {
    roundId,
    status: state.status,
    bet: state.bet,
    startedAt: state.startedAt,
    crashPoint: state.status === "complete" ? state.crashPoint : null,
    outcome: state.outcome,
    payout: state.payout ?? null,
    cashedOutAt: state.cashedOutAt ?? null,
    balance,
  };
}
