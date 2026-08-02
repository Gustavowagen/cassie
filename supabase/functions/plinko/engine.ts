export type Risk = "low" | "medium" | "high";
export type Rng = () => number;

// 0 = the ball deflects left off the peg, 1 = right.
export type Step = 0 | 1;

export const RISKS: Risk[] = ["low", "medium", "high"];

// Fixed board: a ball makes one left/right decision per row, so the bucket it
// lands in is the number of rightward steps — 13 possible buckets for 12 rows.
export const ROWS = 12;
export const BUCKETS = ROWS + 1;

// Stake's published 12-row payout tables. Each is symmetric about the centre
// and, against a Binomial(12, 0.5) landing distribution, returns ~99% — risk
// only redistributes that return between the edges and the centre. Verified by
// the RTP check in engine.test.ts, which recomputes the expectation from
// scratch; changing a number here without changing the house's take will fail
// that test.
export const MULTIPLIERS: Record<Risk, number[]> = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export function isRisk(v: unknown): v is Risk {
  return typeof v === "string" && (RISKS as string[]).includes(v);
}

// One fair coin flip per row. The client replays this exact path as the drop
// animation, so the ball is always seen to land where the server decided.
export function dropPath(rng: Rng): Step[] {
  return Array.from({ length: ROWS }, () => (rng() < 0.5 ? 0 : 1));
}

export function bucketFor(path: Step[]): number {
  return path.reduce<number>((sum, step) => sum + step, 0);
}

export function multiplierFor(risk: Risk, bucket: number): number {
  return MULTIPLIERS[risk][bucket];
}
