export type Rng = () => number;
export type SymbolId = "dot" | "square" | "diamond" | "star" | "seven";
export type RunLength = 3 | 4 | 5;

interface SymbolDef {
  id: SymbolId;
  // Probability a single reel stop lands on this symbol. Every visible cell
  // (top/mid/bottom, all 5 reels) is an independent draw from this
  // distribution — weights across SYMBOLS sum to 1.
  weight: number;
  // Total return multiplier (stake included) for a left-aligned run of this
  // length on the payline, e.g. pay[3] = 7 means a 3-in-a-row pays 7x bet.
  pay: Record<RunLength, number>;
}

// Ordered low tier -> high tier. Rarer symbols pay more, matching the shape
// shown in the approved Neon Rush design mockup.
//
// RTP is fully determined by weight + pay below: for symbol i, P(run of
// exactly k) = weight_i^k * (1 - weight_i) for k=3,4 and weight_i^5 for k=5
// (reels are independent). Summing weight_i^k * pay_i[k] over all symbols
// and run lengths gives RTP ≈ 0.9581 (house edge ≈ 4.19%, hit frequency
// ≈ 6.87%) — see engine.test.ts, which recomputes this exactly and pins it.
export const SYMBOLS: SymbolDef[] = [
  { id: "dot", weight: 0.35, pay: { 3: 7, 4: 15, 5: 30 } },
  { id: "square", weight: 0.25, pay: { 3: 11, 4: 22, 5: 44 } },
  { id: "diamond", weight: 0.2, pay: { 3: 15, 4: 30, 5: 66 } },
  { id: "star", weight: 0.12, pay: { 3: 22, 4: 52, 5: 110 } },
  { id: "seven", weight: 0.08, pay: { 3: 37, 4: 92, 5: 220 } },
];

export const REEL_COUNT = 5;

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Weighted pick over SYMBOLS via cumulative distribution. The final entry is
// returned as a fallback for the r === sum-of-weights edge (float rounding),
// never as a silent bias — weights are authored to sum to exactly 1.
export function pickSymbol(rng: Rng): SymbolId {
  const r = rng();
  let cum = 0;
  for (const s of SYMBOLS) {
    cum += s.weight;
    if (r < cum) return s.id;
  }
  return SYMBOLS[SYMBOLS.length - 1].id;
}

export interface Reel {
  top: SymbolId;
  mid: SymbolId;
  bottom: SymbolId;
}

// Every visible cell is an independent weighted draw (15 rng() calls per
// spin). Only `mid` across all reels — the payline — feeds into the payout;
// top/bottom are cosmetic and never affect the outcome.
export function spin(rng: Rng): Reel[] {
  const reels: Reel[] = [];
  for (let i = 0; i < REEL_COUNT; i++) {
    reels.push({ top: pickSymbol(rng), mid: pickSymbol(rng), bottom: pickSymbol(rng) });
  }
  return reels;
}

export interface Win {
  symbol: SymbolId;
  count: RunLength;
}

// Left-aligned run on the payline, starting at reel 0 — the standard
// single-line slot rule. A run has to start at the first reel to count; a
// match starting at reel 1 or later never pays.
export function evaluateWin(reels: Reel[]): Win | null {
  const first = reels[0].mid;
  let count = 1;
  while (count < reels.length && reels[count].mid === first) count++;
  if (count < 3) return null;
  return { symbol: first, count: count as RunLength };
}

export function payoutFor(win: Win | null, bet: number): number {
  if (!win) return 0;
  const symbol = SYMBOLS.find((s) => s.id === win.symbol)!;
  return roundMoney(bet * symbol.pay[win.count]);
}
