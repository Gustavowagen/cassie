export type Rng = () => number;
export type SymbolId = "dot" | "square" | "diamond" | "star" | "seven";
export type RunLength = 3 | 4 | 5;

interface SymbolDef {
  id: SymbolId;
  weight: number;
  pay: Record<RunLength, number>;
}

// Ordered low tier -> high tier. Rarer symbols pay more, matching the shape
// shown in the approved Neon Rush design mockup.
//
// Wins are "scatter" style: any 3+ of the same symbol on the payline count,
// regardless of position (see evaluateWin). That means a count of k can land
// in C(5,k) different arrangements instead of just 1 (left-aligned), so hit
// frequency for k=3,4 is far higher than a purely positional rule — pay[3]
// and pay[4] are scaled down accordingly to hold RTP steady (pay[5] needs no
// adjustment, since all 5 reels matching is the same event either way).
//
// For symbol i, P(exactly k matches among 5 reels) = C(5,k) * weight_i^k *
// (1 - weight_i)^(5-k). Summing that times pay_i[k] over all symbols and
// counts gives RTP ≈ 0.982 (house edge ≈ 1.8%, hit frequency ≈ 41.5% —
// unchanged, since hit frequency depends only on weight, not pay) — see
// engine.test.ts, which recomputes this exactly and pins it.
export const SYMBOLS: SymbolDef[] = [
  { id: "dot", weight: 0.35, pay: { 3: 1, 4: 3, 5: 33 } },
  { id: "square", weight: 0.25, pay: { 3: 1.5, 4: 4.5, 5: 48 } },
  { id: "diamond", weight: 0.2, pay: { 3: 2, 4: 6.5, 5: 70 } },
  { id: "star", weight: 0.12, pay: { 3: 2.5, 4: 11, 5: 115 } },
  { id: "seven", weight: 0.08, pay: { 3: 4.5, 4: 19, 5: 240 } },
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

export function payoutFor(win: Win | null, bet: number): number {
  if (!win) return 0;
  const symbol = SYMBOLS.find((s) => s.id === win.symbol)!;
  return roundMoney(bet * symbol.pay[win.count]);
}

// --- Full board reward mode -------------------------------------------
//
// "Full board" scores all 15 visible cells (top/mid/bottom x 5 reels)
// instead of just the mid-row payline. With 15 iid draws across 5
// symbols, some symbol has count >= 3 on effectively 100% of spins
// (pigeonhole: 15 cells / 5 symbols = 3 average), so reusing the
// single-row threshold of 3 would mean winning every spin. Exact
// multinomial enumeration (all 3,876 compositions of 15 into 5 parts,
// weighted by SYMBOLS' weights above) over "highest count wins, ties
// broken toward the rarer symbol" gives:
//
//   P(max count >= 7)  = 31.97%  <- win threshold
//   P(max count >= 9)  =  4.72%  <- BIG WIN tier
//   P(max count >= 11) =  0.30%  <- MEGA WIN tier
//
// The pay table below was solved (same weighted-sum-times-pay approach
// as SYMBOLS' RTP above, using those exact tier probabilities) to bring
// total RTP to ~0.9817 (house edge ~1.83%), matching single-row's ~0.9820
// (~1.80%). Full derivation:
// docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md
export interface FullBoardPosition {
  reel: number;
  row: "top" | "mid" | "bottom";
}

export interface FullBoardWin {
  symbol: SymbolId;
  count: number; // 7..15
  positions: FullBoardPosition[];
}

interface FullBoardSymbolDef {
  id: SymbolId;
  // Pay at tier 0 (7-8 cells), tier 1 (9-10 cells), tier 2 (11-15 cells).
  pay: [number, number, number];
}

export const FULL_BOARD_MIN_COUNT = 7;

export const FULL_BOARD_SYMBOLS: FullBoardSymbolDef[] = [
  { id: "dot", pay: [1.46, 7.31, 58.46] },
  { id: "square", pay: [2.19, 10.23, 80.38] },
  { id: "diamond", pay: [2.92, 14.61, 116.92] },
  { id: "star", pay: [4.38, 21.92, 189.99] },
  { id: "seven", pay: [7.31, 36.54, 379.98] },
];

function fullBoardTierIndex(count: number): 0 | 1 | 2 {
  if (count >= 11) return 2;
  if (count >= 9) return 1;
  return 0;
}

// Counts every cell (not just mid) per symbol, then picks the highest
// count. SYMBOLS is ordered low -> high tier (rarer last); scanning in
// that order and overwriting on `>=` lets a later (rarer) symbol win
// ties, matching the tie-break rule baked into the pay table's derivation.
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

  let best: { symbol: SymbolId; positions: FullBoardPosition[] } | null = null;
  for (const s of SYMBOLS) {
    const positions = cellsBySymbol.get(s.id) ?? [];
    if (positions.length > 0 && (!best || positions.length >= best.positions.length)) {
      best = { symbol: s.id, positions };
    }
  }

  if (!best || best.positions.length < FULL_BOARD_MIN_COUNT) return null;
  return { symbol: best.symbol, count: best.positions.length, positions: best.positions };
}

export function payoutForFullBoard(win: FullBoardWin | null, bet: number): number {
  if (!win) return 0;
  const symbol = FULL_BOARD_SYMBOLS.find((s) => s.id === win.symbol)!;
  return roundMoney(bet * symbol.pay[fullBoardTierIndex(win.count)]);
}
