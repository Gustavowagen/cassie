import { describe, it, expect } from "vitest";
import {
  ROWS,
  COLS,
  CELLS,
  SYMBOLS,
  ORB_COUNT_WEIGHTS,
  ORB_VALUES,
  BASELINE_RTP,
  HOUSE_EDGE_OPTIONS,
  MIN_HOUSE_EDGE,
  MAX_HOUSE_EDGE,
  DEFAULT_HOUSE_EDGE,
  edgeScale,
  tierIndex,
  countSymbols,
  evaluateBoard,
  tumble,
  spinBoard,
  playRound,
  payoutFor,
  pickSymbol,
  type Board,
  type SymbolId,
} from "./engine";

function queue(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

// Builds a board from 30 symbols in spinBoard's fill order (column by
// column, top to bottom).
function boardOf(cells: SymbolId[]): Board {
  expect(cells).toHaveLength(CELLS);
  const board: Board = [];
  for (let c = 0; c < COLS; c++) board.push(cells.slice(c * ROWS, c * ROWS + ROWS));
  return board;
}

function repeat(counts: Partial<Record<SymbolId, number>>): SymbolId[] {
  const out: SymbolId[] = [];
  for (const [id, n] of Object.entries(counts)) for (let i = 0; i < (n as number); i++) out.push(id as SymbolId);
  return out;
}

describe("board shape", () => {
  it("is a fixed 5x6 board", () => {
    expect(ROWS).toBe(5);
    expect(COLS).toBe(6);
    expect(CELLS).toBe(30);
  });

  it("spinBoard fills every cell, column by column", () => {
    const board = spinBoard(queue([0.1]));
    expect(board).toHaveLength(COLS);
    for (const col of board) expect(col).toHaveLength(ROWS);
  });
});

describe("symbol table", () => {
  it("weights sum to exactly 1", () => {
    expect(SYMBOLS.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 10);
  });

  it("orb distributions sum to exactly 1", () => {
    expect(ORB_COUNT_WEIGHTS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(ORB_VALUES.reduce((s, o) => s + o.weight, 0)).toBeCloseTo(1, 10);
  });

  it("a rarer symbol needs strictly fewer cells and pays strictly more", () => {
    for (let i = 1; i < SYMBOLS.length; i++) {
      const prev = SYMBOLS[i - 1];
      const cur = SYMBOLS[i];
      expect(cur.weight).toBeLessThan(prev.weight);
      expect(cur.threshold).toBeLessThan(prev.threshold);
      for (let tier = 0; tier < 3; tier++) expect(cur.pay[tier]).toBeGreaterThan(prev.pay[tier]);
    }
  });

  it("every symbol's pay rises with its tier", () => {
    for (const s of SYMBOLS) {
      expect(s.pay[1]).toBeGreaterThan(s.pay[0]);
      expect(s.pay[2]).toBeGreaterThan(s.pay[1]);
    }
  });

  // The balance the whole design rests on: a rare symbol needs fewer cells,
  // but "a lot of a common symbol" must still be MORE likely than "a few of
  // a rare one". Exact binomial tail over the 30 opening cells.
  it("a rarer symbol still wins strictly less often than every commoner one", () => {
    const logC = (n: number, k: number) => {
      let s = 0;
      for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1);
      return s;
    };
    const tail = (t: number, p: number) => {
      let s = 0;
      for (let k = t; k <= CELLS; k++) s += Math.exp(logC(CELLS, k) + k * Math.log(p) + (CELLS - k) * Math.log(1 - p));
      return s;
    };
    const probs = SYMBOLS.map((s) => tail(s.threshold, s.weight));
    for (let i = 1; i < probs.length; i++) expect(probs[i]).toBeLessThan(probs[i - 1]);
    // Guards the headline property against a future re-tune quietly eroding
    // it: the commonest symbol must win far more often than the rarest.
    expect(probs[0]).toBeGreaterThan(probs[4] * 10);
  });
});

describe("house edge", () => {
  it("offers a fixed 1-5% menu with no 0% option", () => {
    expect(HOUSE_EDGE_OPTIONS).toEqual([0.01, 0.02, 0.03, 0.04, 0.05]);
    expect(MIN_HOUSE_EDGE).toBe(0.01);
    expect(MAX_HOUSE_EDGE).toBe(0.05);
    expect(HOUSE_EDGE_OPTIONS).toContain(DEFAULT_HOUSE_EDGE);
  });

  it("scales the pay table so the picked edge is the realized RTP", () => {
    for (const edge of HOUSE_EDGE_OPTIONS) {
      expect(edgeScale(edge) * BASELINE_RTP).toBeCloseTo(1 - edge, 12);
    }
  });

  it("a bigger edge pays strictly less", () => {
    for (let i = 1; i < HOUSE_EDGE_OPTIONS.length; i++) {
      expect(edgeScale(HOUSE_EDGE_OPTIONS[i])).toBeLessThan(edgeScale(HOUSE_EDGE_OPTIONS[i - 1]));
    }
  });
});

describe("tierIndex", () => {
  it("maps count to [threshold, +1, +2 or more]", () => {
    expect(tierIndex(9, 9)).toBe(0);
    expect(tierIndex(10, 9)).toBe(1);
    expect(tierIndex(11, 9)).toBe(2);
    expect(tierIndex(30, 9)).toBe(2);
  });
});

describe("evaluateBoard", () => {
  it("pays nothing when no symbol reaches its own threshold", () => {
    const board = boardOf(repeat({ dot: 6, square: 6, diamond: 6, star: 6, seven: 6 }));
    expect(evaluateBoard(board)).toEqual([]);
  });

  it("pays a symbol that reaches its own threshold", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    const wins = evaluateBoard(board);
    expect(wins).toHaveLength(1);
    expect(wins[0].symbol).toBe("dot");
    expect(wins[0].count).toBe(15);
    expect(wins[0].tier).toBe(0);
    expect(wins[0].positions).toHaveLength(15);
  });

  // Each symbol is judged against its own threshold independently, so a
  // board can pay several symbols at once with no tie-break.
  it("pays every symbol that independently qualifies", () => {
    const board = boardOf(repeat({ dot: 15, seven: 8, square: 7 }));
    const wins = evaluateBoard(board);
    expect(wins.map((w) => w.symbol).sort()).toEqual(["dot", "seven"]);
    const total = wins.reduce((s, w) => s + w.pay, 0);
    expect(total).toBeCloseTo(0.25 + 6, 10);
  });

  it("reports every cell of a winning symbol as a position", () => {
    const board = boardOf(repeat({ star: 9, dot: 14, square: 7 }));
    const win = evaluateBoard(board).find((w) => w.symbol === "star")!;
    expect(win.positions).toHaveLength(9);
    for (const p of win.positions) expect(board[p.col][p.row]).toBe("star");
  });

  it("scales pays by the house edge when one is given", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    const raw = evaluateBoard(board)[0].pay;
    const scaled = evaluateBoard(board, 0.05)[0].pay;
    expect(scaled).toBeCloseTo(raw * edgeScale(0.05), 12);
  });
});

describe("tumble", () => {
  it("pops every winning cell, drops survivors, and rains in from the top", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    const wins = evaluateBoard(board);
    // Fresh draws are all sevens, so refilled cells are unmistakable.
    const next = tumble(board, wins, queue([0.99]));

    expect(next).toHaveLength(COLS);
    for (const col of next) expect(col).toHaveLength(ROWS);
    expect(countSymbols(next).dot).toBe(0);
    expect(countSymbols(next).seven).toBe(15);
    // Survivors keep their relative order and settle at the bottom.
    for (const col of next) {
      const firstSurvivor = col.findIndex((s) => s !== "seven");
      if (firstSurvivor === -1) continue;
      for (let r = firstSurvivor; r < ROWS; r++) expect(col[r]).not.toBe("seven");
    }
  });

  it("leaves non-winning symbols untouched", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    const next = tumble(board, evaluateBoard(board), queue([0.99]));
    const counts = countSymbols(next);
    expect(counts.square).toBe(11);
    expect(counts.diamond).toBe(4);
  });

  it("always returns a full board", () => {
    const board = boardOf(repeat({ dot: 15, seven: 8, square: 7 }));
    const next = tumble(board, evaluateBoard(board), queue([0.5]));
    const counts = countSymbols(next);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(CELLS);
  });
});

describe("playRound", () => {
  it("records no steps and pays nothing on a losing spin", () => {
    // 6 of each symbol: nothing reaches its threshold.
    const cells = [0.1, 0.5, 0.7, 0.85, 0.95];
    const draws: number[] = [];
    for (let i = 0; i < 6; i++) draws.push(...cells);
    const round = playRound(queue(draws));
    expect(round.steps).toEqual([]);
    expect(round.basePay).toBe(0);
    expect(round.multiplier).toBe(1);
    expect(round.totalMultiplier).toBe(0);
    expect(payoutFor(round, 100)).toBe(0);
    expect(countSymbols(round.finalBoard)).toEqual({ dot: 6, square: 6, diamond: 6, star: 6, seven: 6 });
  });

  it("multiplier is 1 when no orb lands, so orbs never pay on their own", () => {
    const cells = [0.1, 0.5, 0.7, 0.85, 0.95];
    const draws: number[] = [];
    for (let i = 0; i < 6; i++) draws.push(...cells);
    const round = playRound(queue(draws));
    expect(round.multiplier).toBe(1);
    expect(round.totalMultiplier).toBe(0);
  });

  it("chains tumbles and sums every step's pay", () => {
    // 0.01 draws dot everywhere, so the opening board is 30 dots and each
    // refill is dots again — the chain only ends at MAX_TUMBLES, which is
    // enough to prove pays accumulate across steps.
    const round = playRound(queue([0.01]));
    expect(round.steps.length).toBeGreaterThan(1);
    const summed = round.steps.reduce((s, step) => s + step.pay, 0);
    expect(round.basePay).toBeCloseTo(summed, 8);
    expect(round.totalMultiplier).toBeCloseTo(round.basePay * round.multiplier, 8);
  });

  it("each step's board is the previous step's board after tumbling", () => {
    const round = playRound(Math.random);
    for (let i = 1; i < round.steps.length; i++) {
      const prev = round.steps[i - 1];
      const expected = tumble(prev.board, prev.wins, () => 0.5);
      // The refilled cells are random, but the survivors must line up.
      const popped = new Set(prev.wins.map((w) => w.symbol));
      for (let c = 0; c < COLS; c++) {
        const survivors = prev.board[c].filter((s) => !popped.has(s));
        const actual = round.steps[i].board[c].slice(ROWS - survivors.length);
        expect(actual).toEqual(survivors);
        expect(expected[c]).toHaveLength(ROWS);
      }
    }
  });

  it("the final board never qualifies for a win", () => {
    for (let i = 0; i < 200; i++) {
      const round = playRound(Math.random);
      expect(evaluateBoard(round.finalBoard)).toEqual([]);
    }
  });

  it("payout is bet * basePay * multiplier", () => {
    const round = playRound(queue([0.01]));
    expect(payoutFor(round, 20)).toBeCloseTo(20 * round.basePay * round.multiplier, 6);
  });
});

describe("pickSymbol", () => {
  it("maps the weighted cumulative ranges to the right symbol", () => {
    expect(pickSymbol(queue([0.0]))).toBe("dot");
    expect(pickSymbol(queue([0.34]))).toBe("dot");
    expect(pickSymbol(queue([0.36]))).toBe("square");
    expect(pickSymbol(queue([0.61]))).toBe("diamond");
    expect(pickSymbol(queue([0.81]))).toBe("star");
    expect(pickSymbol(queue([0.93]))).toBe("seven");
    expect(pickSymbol(queue([1.0]))).toBe("seven");
  });
});

// ---------------------------------------------------------------------------
// Exact RTP. Scoring depends on the board only through per-symbol counts, and
// a tumble redraws every popped cell independently — so a round is a Markov
// chain over count vectors summing to 30. Only 324,632 vectors of sum <= 30
// exist, so the RTP is solved exactly here rather than simulated, and any
// edit to a threshold, pay or orb weight fails this test until BASELINE_RTP
// is recomputed.
// ---------------------------------------------------------------------------
describe("BASELINE_RTP", () => {
  it("matches an exact solve of the cascade", { timeout: 180_000 }, () => {
    const W = SYMBOLS.map((s) => s.weight);
    const THRESH = SYMBOLS.map((s) => s.threshold);

    const vectors: number[][] = [];
    const sums: number[] = [];
    const codeToIdx = new Map<number, number>();
    const code = (v: number[]) => (((v[0] * 31 + v[1]) * 31 + v[2]) * 31 + v[3]) * 31 + v[4];
    for (let s = 0; s <= CELLS; s++)
      for (let a = 0; a <= s; a++)
        for (let b = 0; a + b <= s; b++)
          for (let c = 0; a + b + c <= s; c++)
            for (let d = 0; a + b + c + d <= s; d++) {
              const v = [a, b, c, d, s - a - b - c - d];
              codeToIdx.set(code(v), vectors.length);
              vectors.push(v);
              sums.push(s);
            }
    const TOTAL = vectors.length;
    expect(TOTAL).toBe(324_632);

    const succ = new Int32Array(TOTAL * 5).fill(-1);
    for (let idx = 0; idx < TOTAL; idx++) {
      if (sums[idx] === CELLS) continue;
      for (let i = 0; i < 5; i++) {
        const n = vectors[idx].slice();
        n[i]++;
        succ[idx * 5 + i] = codeToIdx.get(code(n))!;
      }
    }
    const full: number[] = [];
    for (let idx = 0; idx < TOTAL; idx++) if (sums[idx] === CELLS) full.push(idx);

    // Push a partial board up to a full one by dropping single cells — this
    // is the multinomial refill, done in 1.6M ops instead of per-state
    // enumeration.
    const fill = (buf: Float64Array) => {
      for (let idx = 0; idx < TOTAL; idx++) {
        const m = buf[idx];
        if (m === 0 || sums[idx] === CELLS) continue;
        for (let i = 0; i < 5; i++) buf[succ[idx * 5 + i]] += m * W[i];
        buf[idx] = 0;
      }
    };
    const opening = new Float64Array(TOTAL);
    opening[0] = 1;
    fill(opening);

    // Adjoint: H[residual] = E[F(next board)].
    const applyT = (F: Float64Array) => {
      const H = new Float64Array(TOTAL);
      for (let idx = TOTAL - 1; idx >= 0; idx--) {
        if (sums[idx] === CELLS) {
          H[idx] = F[idx];
        } else {
          const b = idx * 5;
          H[idx] =
            W[0] * H[succ[b]] +
            W[1] * H[succ[b + 1]] +
            W[2] * H[succ[b + 2]] +
            W[3] * H[succ[b + 3]] +
            W[4] * H[succ[b + 4]];
        }
      }
      return H;
    };

    const residual = new Int32Array(TOTAL).fill(-1);
    const pay = new Float64Array(TOTAL);
    for (const idx of full) {
      const v = vectors[idx];
      const left = v.slice();
      let total = 0;
      let won = false;
      for (let i = 0; i < 5; i++) {
        if (v[i] >= THRESH[i]) {
          total += SYMBOLS[i].pay[tierIndex(v[i], THRESH[i])];
          left[i] = 0;
          won = true;
        }
      }
      pay[idx] = total;
      if (won) residual[idx] = codeToIdx.get(code(left))!;
    }

    const fixpoint = (step: (idx: number, H: Float64Array) => number, init = 0) => {
      let F = new Float64Array(TOTAL);
      if (init) for (const idx of full) F[idx] = init;
      for (let iter = 0; iter < 500; iter++) {
        const H = applyT(F);
        const next = new Float64Array(TOTAL);
        let delta = 0;
        for (const idx of full) {
          const val = step(idx, H);
          next[idx] = val;
          delta = Math.max(delta, Math.abs(val - F[idx]));
        }
        F = next;
        if (delta < 1e-16) break;
      }
      return F;
    };
    const expectation = (F: Float64Array) => full.reduce((s, idx) => s + opening[idx] * F[idx], 0);

    const eV = ORB_VALUES.reduce((s, o) => s + o.value * o.weight, 0);
    const eN = ORB_COUNT_WEIGHTS.reduce((s, p, n) => s + n * p, 0);
    const mu = eN * eV; // orb value added by one winning step
    const q = ORB_COUNT_WEIGHTS[0]; // that step drops no orb at all

    const won = (idx: number) => residual[idx] >= 0;
    const D = fixpoint((idx, H) => (won(idx) ? 1 + H[residual[idx]] : 0));
    const G = fixpoint((idx, H) => (won(idx) ? q * H[residual[idx]] : 1), 1);
    const HD = applyT(D);
    const HG = applyT(G);
    const A = fixpoint((idx, H) => (won(idx) ? pay[idx] + H[residual[idx]] : 0));
    const HA = applyT(A);
    // payout = W * max(1, M) and max(1, M) = M + 1{M=0}, with M a sum of L
    // i.i.d. orb draws independent of the board. So
    //   E[payout] = mu * E[W*L] + E[W * q^L]
    const B = fixpoint((idx, H) =>
      won(idx) ? pay[idx] + pay[idx] * HD[residual[idx]] + HA[residual[idx]] + H[residual[idx]] : 0
    );
    const C = fixpoint((idx, H) => (won(idx) ? q * (pay[idx] * HG[residual[idx]] + H[residual[idx]]) : 0));

    const exact = mu * expectation(B) + expectation(C);
    expect(exact).toBeCloseTo(BASELINE_RTP, 9);

    // Sanity on the shape the design targets, so a re-tune that wrecks the
    // feel fails here too rather than silently shipping.
    const hitRate = full.reduce((s, idx) => s + (won(idx) ? opening[idx] : 0), 0);
    expect(hitRate).toBeGreaterThan(0.12);
    expect(hitRate).toBeLessThan(0.2);
    expect(expectation(D) / hitRate).toBeGreaterThan(1.3); // tumbles per winning round
  });
});
