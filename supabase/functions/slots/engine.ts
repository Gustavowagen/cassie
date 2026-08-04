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
// The pay[5] tail is deliberately compressed relative to pay[3]/pay[4]:
// dot's 3-of-a-kind (the single most frequent winning event, ~18% of all
// spins) pays 1.5x, while seven's 5-of-a-kind (~0.0003% of spins) pays 40x
// rather than a naive odds-implied multiplier in the hundreds. This lowers
// volatility — frequent small wins feel more substantial, the rare jackpot
// less dominant — without changing hit frequency (weights, not pay,
// determine how often a spin wins) or RTP (still fully renormalized by
// edgeScale at every house edge setting).
//
// For symbol i, P(exactly k matches among 5 reels) = C(5,k) * weight_i^k *
// (1 - weight_i)^(5-k). Summing that times pay_i[k] over all symbols and
// counts gives RTP ≈ 0.962 (hit frequency ≈ 41.5% — unchanged, since hit
// frequency depends only on weight, not pay) — see engine.test.ts, which
// recomputes this exactly and pins it.
export const SYMBOLS: SymbolDef[] = [
  { id: "dot", weight: 0.35, pay: { 3: 1.5, 4: 3, 5: 12 } },
  { id: "square", weight: 0.25, pay: { 3: 2, 4: 4, 5: 15 } },
  { id: "diamond", weight: 0.2, pay: { 3: 2.5, 4: 5, 5: 19 } },
  { id: "star", weight: 0.12, pay: { 3: 3, 4: 6.5, 5: 25 } },
  { id: "seven", weight: 0.08, pay: { 3: 4, 4: 8.5, 5: 40 } },
];

export const REEL_COUNT = 5;

// Theoretical RTP of the pay tables above (SYMBOLS / FULL_BOARD_SYMBOLS) with
// no house-edge scaling applied — exact values, recomputed independently by
// engine.test.ts's "RTP" / "full board RTP" describe blocks (the full-board
// figure includes the pay-both-ties rule). A chosen house edge scales
// payouts by (1 - houseEdge) / baseline, so the resulting theoretical RTP
// equals 1 - houseEdge exactly, regardless of which baseline it started from.
export const BASELINE_RTP_SINGLE_ROW = 0.9619252895;
export const BASELINE_RTP_FULL_BOARD = 0.984280455592317;

// The only house-edge values an admin can pick (a fixed menu, not free
// entry) — 0%, 1%, 2%, ..., 5%.
export const HOUSE_EDGE_OPTIONS = [0, 0.01, 0.02, 0.03, 0.04, 0.05] as const;
export const MIN_HOUSE_EDGE = HOUSE_EDGE_OPTIONS[0];
export const MAX_HOUSE_EDGE = HOUSE_EDGE_OPTIONS[HOUSE_EDGE_OPTIONS.length - 1];
export const DEFAULT_HOUSE_EDGE = 0.02;

// houseEdge only ever scales *how much* a win pays (see payoutFor /
// payoutForFullBoard below) — it never touches SYMBOLS' weights or
// evaluateWin/evaluateFullBoardWin, which decide *whether* a spin wins.
// That keeps hit frequency identical at every edge setting; only the
// pay-table "x" multipliers move.
function edgeScale(baselineRtp: number, houseEdge: number): number {
  return (1 - houseEdge) / baselineRtp;
}

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

// `houseEdge` left undefined leaves the raw pay table untouched (scale 1) —
// callers that care about a configurable edge (the slots edge function)
// always pass one; engine.test.ts's pinned-payout assertions rely on the
// unscaled default.
export function payoutFor(win: Win | null, bet: number, houseEdge?: number): number {
  if (!win) return 0;
  const symbol = SYMBOLS.find((s) => s.id === win.symbol)!;
  const scale = houseEdge === undefined ? 1 : edgeScale(BASELINE_RTP_SINGLE_ROW, houseEdge);
  return roundMoney(bet * symbol.pay[win.count] * scale);
}

// --- Full board reward mode -------------------------------------------
//
// "Full board" scores all 15 visible cells (top/mid/bottom x 5 reels)
// instead of just the mid-row payline. With 15 iid draws across 5
// symbols, some symbol has count >= 3 on effectively 100% of spins
// (pigeonhole: 15 cells / 5 symbols = 3 average), so reusing the
// single-row threshold of 3 would mean winning every spin. Exact
// multinomial enumeration (all 3,876 compositions of 15 into 5 parts,
// weighted by SYMBOLS' weights above) over "every symbol at the max count
// wins" gives:
//
//   P(max count >= 7)  = 31.97%  <- win threshold
//   P(max count >= 9)  =  4.72%  <- BIG WIN tier
//   P(max count >= 11) =  0.30%  <- MEGA WIN tier
//
// Two symbols can tie for the max count (e.g. 7 dots + 7 squares + 1
// other) — 15 cells / 7-cell threshold allows at most a 2-way tie, never 3
// (3 * 7 = 21 > 15). When that happens both symbols pay in full rather
// than picking a "winner" (see evaluateFullBoardWin/payoutForFullBoard).
// Ties only land in the 7-8 tier (two symbols both at 9+ would need 18+
// cells) and are rare — 0.10% of all spins, 0.32% of winning spins — so
// they nudge RTP up slightly rather than requiring a full re-solve.
//
// The pay table below was solved (same weighted-sum-times-pay approach
// as SYMBOLS' RTP above, using those exact tier probabilities, under the
// single-winner rule) to bring total RTP to ~0.9822 (house edge ~1.78%),
// matching single-row's ~0.9820 (~1.80%). Tier multipliers are deliberately
// flatter than a naive scale-up (tier0:tier1:tier2 ≈ 1:3:10.5 per symbol,
// vs. a much steeper spread) so the common small win (7-8 cells) pays more
// and the rare max win (11-15 cells) pays less — the same total RTP spread
// more evenly across outcomes. Paying both symbols on a tie lifts actual
// RTP to ~0.9843 (house edge ~1.57%) — within the same 97-99% band, so the
// table wasn't rescaled for it. Full derivation:
// docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md
export interface FullBoardPosition {
  reel: number;
  row: "top" | "mid" | "bottom";
}

export interface FullBoardTieWin {
  symbol: SymbolId;
  positions: FullBoardPosition[];
}

// `wins` holds every symbol that reached the max count — normally length 1,
// occasionally 2 when two symbols tie (see evaluateFullBoardWin). All of
// them share `count`/tier, since a tie is only possible between symbols at
// the exact same count.
export interface FullBoardWin {
  count: number; // 7..15
  wins: FullBoardTieWin[];
}

interface FullBoardSymbolDef {
  id: SymbolId;
  // Pay at tier 0 (7-8 cells), tier 1 (9-10 cells), tier 2 (11-15 cells).
  pay: [number, number, number];
}

export const FULL_BOARD_MIN_COUNT = 7;

export const FULL_BOARD_SYMBOLS: FullBoardSymbolDef[] = [
  { id: "dot", pay: [2, 6, 21] },
  { id: "square", pay: [3, 9, 32] },
  { id: "diamond", pay: [4, 12, 42] },
  { id: "star", pay: [6, 18, 63] },
  { id: "seven", pay: [10, 30, 105] },
];

function fullBoardTierIndex(count: number): 0 | 1 | 2 {
  if (count >= 11) return 2;
  if (count >= 9) return 1;
  return 0;
}

// Counts every cell (not just mid) per symbol, then finds the highest
// count. Every symbol that reaches that count wins — with 15 cells, two
// symbols tying for the max is possible (e.g. 7 dots + 7 squares + 1
// other), but three-way ties aren't (3 * 7 = 21 > 15), so `wins` is never
// longer than 2.
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

  let maxCount = 0;
  for (const positions of cellsBySymbol.values()) {
    if (positions.length > maxCount) maxCount = positions.length;
  }
  if (maxCount < FULL_BOARD_MIN_COUNT) return null;

  const wins: FullBoardTieWin[] = [];
  for (const s of SYMBOLS) {
    const positions = cellsBySymbol.get(s.id) ?? [];
    if (positions.length === maxCount) wins.push({ symbol: s.id, positions });
  }
  return { count: maxCount, wins };
}

// Every tied symbol pays out — a 7-dot/7-square tie pays dot's tier-0 rate
// plus square's, not just the rarer one.
export function payoutForFullBoard(win: FullBoardWin | null, bet: number, houseEdge?: number): number {
  if (!win) return 0;
  const tier = fullBoardTierIndex(win.count);
  const total = win.wins.reduce((sum, w) => {
    const symbol = FULL_BOARD_SYMBOLS.find((s) => s.id === w.symbol)!;
    return sum + symbol.pay[tier];
  }, 0);
  const scale = houseEdge === undefined ? 1 : edgeScale(BASELINE_RTP_FULL_BOARD, houseEdge);
  return roundMoney(bet * total * scale);
}
