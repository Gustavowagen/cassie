import { describe, it, expect } from "vitest";
import {
  SYMBOL_WEIGHTS,
  pickSymbol,
  spin,
  roundMoney,
  BOARD_DIMENSIONS,
  ALLOWED_REWARD_MODES,
  evaluateWin,
  payoutFor,
  SINGLE_ROW_TABLES,
  MIN_HOUSE_EDGE,
  MAX_HOUSE_EDGE,
  DEFAULT_HOUSE_EDGE,
  type Reel,
  type SymbolId,
  type BoardSize,
} from "./engine";

function queue(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function reelsForRow(mids: SymbolId[], row: number, rows: number): Reel[] {
  return mids.map((mid) => {
    const reel: Reel = [];
    for (let r = 0; r < rows; r++) reel.push(r === row ? mid : "dot");
    return reel;
  });
}

describe("BOARD_DIMENSIONS", () => {
  it("has an entry for every BoardSize with the expected rows/cols", () => {
    expect(BOARD_DIMENSIONS["3x3"]).toEqual({ rows: 3, cols: 3 });
    expect(BOARD_DIMENSIONS["3x4"]).toEqual({ rows: 3, cols: 4 });
    expect(BOARD_DIMENSIONS["5x3"]).toEqual({ rows: 3, cols: 5 });
    expect(BOARD_DIMENSIONS["3x6"]).toEqual({ rows: 3, cols: 6 });
    expect(BOARD_DIMENSIONS["4x6"]).toEqual({ rows: 4, cols: 6 });
  });
});

describe("ALLOWED_REWARD_MODES", () => {
  it("locks 3x3 and 3x4 to single_row", () => {
    expect(ALLOWED_REWARD_MODES["3x3"]).toEqual(["single_row"]);
    expect(ALLOWED_REWARD_MODES["3x4"]).toEqual(["single_row"]);
  });

  it("locks 4x6 to full_board", () => {
    expect(ALLOWED_REWARD_MODES["4x6"]).toEqual(["full_board"]);
  });

  it("allows free choice on 5x3 and 3x6", () => {
    expect(ALLOWED_REWARD_MODES["5x3"]).toEqual(["single_row", "full_board"]);
    expect(ALLOWED_REWARD_MODES["3x6"]).toEqual(["single_row", "full_board"]);
  });
});

describe("spin", () => {
  it("draws cols reels of length rows for the default 5x3 board, from independent rng() calls", () => {
    const rng = queue([
      0, 0, 0, // reel0: dot, dot, dot
      0.35, 0.35, 0.35, // reel1: square, square, square
      0.6, 0.8, 0.92, // reel2: diamond, star, seven
      0, 0.35, 0.6, // reel3: dot, square, diamond
      0.92, 0.8, 0, // reel4: seven, star, dot
    ]);
    const reels = spin(rng, "5x3");
    expect(reels).toHaveLength(5);
    reels.forEach((reel) => expect(reel).toHaveLength(3));
    expect(reels[0]).toEqual(["dot", "dot", "dot"]);
    expect(reels[1]).toEqual(["square", "square", "square"]);
    expect(reels[2]).toEqual(["diamond", "star", "seven"]);
    expect(reels[3]).toEqual(["dot", "square", "diamond"]);
    expect(reels[4]).toEqual(["seven", "star", "dot"]);
  });

  it("draws rows*cols reels for a non-default board size (3x3 = 9 draws)", () => {
    const rng = queue([0, 0, 0, 0.35, 0.35, 0.35, 0.6, 0.8, 0.92]);
    const reels = spin(rng, "3x3");
    expect(reels).toHaveLength(3);
    reels.forEach((reel) => expect(reel).toHaveLength(3));
    expect(reels).toEqual([
      ["dot", "dot", "dot"],
      ["square", "square", "square"],
      ["diamond", "star", "seven"],
    ]);
  });

  it("draws a 4-row board (4x6) with reels of length 4", () => {
    const rng = queue(new Array(24).fill(0)); // all dot
    const reels = spin(rng, "4x6");
    expect(reels).toHaveLength(6);
    reels.forEach((reel) => expect(reel).toEqual(["dot", "dot", "dot", "dot"]));
  });
});

describe("evaluateWin", () => {
  it("returns null when no symbol reaches the 5x3 board's threshold of 3", () => {
    expect(evaluateWin(reelsForRow(["dot", "dot", "square", "square", "diamond"], 1, 3), "5x3")).toBeNull();
    expect(evaluateWin(reelsForRow(["dot", "square", "dot", "diamond", "star"], 1, 3), "5x3")).toBeNull();
  });

  it("matches anywhere on the middle row (scatter), not just a contiguous run from reel 0", () => {
    expect(evaluateWin(reelsForRow(["square", "dot", "dot", "dot", "dot"], 1, 3), "5x3")).toEqual({
      symbol: "dot",
      count: 4,
      positions: [1, 2, 3, 4],
    });
  });

  it("detects a 5x3 5-in-a-row", () => {
    expect(
      evaluateWin(reelsForRow(["diamond", "diamond", "diamond", "diamond", "diamond"], 1, 3), "5x3")
    ).toEqual({ symbol: "diamond", count: 5, positions: [0, 1, 2, 3, 4] });
  });

  it("evaluates the middle row of a 3x3 board (row index 1) at its threshold of 2", () => {
    expect(evaluateWin(reelsForRow(["dot", "square", "diamond"], 1, 3), "3x3")).toBeNull();
    expect(evaluateWin(reelsForRow(["dot", "dot", "diamond"], 1, 3), "3x3")).toEqual({
      symbol: "dot",
      count: 2,
      positions: [0, 1],
    });
  });

  it("evaluates the middle row of a 3x4 board at its threshold of 3", () => {
    expect(evaluateWin(reelsForRow(["dot", "dot", "square", "diamond"], 1, 3), "3x4")).toBeNull();
    expect(evaluateWin(reelsForRow(["dot", "dot", "dot", "diamond"], 1, 3), "3x4")).toEqual({
      symbol: "dot",
      count: 3,
      positions: [0, 1, 2],
    });
  });

  it("evaluates the middle row of a 3x6 board at its threshold of 4", () => {
    expect(evaluateWin(reelsForRow(["dot", "dot", "dot", "square", "diamond", "star"], 1, 3), "3x6")).toBeNull();
    expect(
      evaluateWin(reelsForRow(["dot", "dot", "dot", "dot", "diamond", "star"], 1, 3), "3x6")
    ).toEqual({ symbol: "dot", count: 4, positions: [0, 1, 2, 3] });
    expect(
      evaluateWin(reelsForRow(["dot", "dot", "dot", "dot", "dot", "star"], 1, 3), "3x6")
    ).toEqual({ symbol: "dot", count: 5, positions: [0, 1, 2, 3, 4] });
    const allDot = reelsForRow(["dot", "dot", "dot", "dot", "dot", "dot"], 1, 3);
    expect(evaluateWin(allDot, "3x6")).toEqual({
      symbol: "dot",
      count: 6,
      positions: [0, 1, 2, 3, 4, 5],
    });
  });
});

describe("payoutFor", () => {
  it("returns 0 for no win", () => {
    expect(payoutFor(null, 10, "5x3")).toBe(0);
  });

  it("multiplies bet by the 5x3 symbol's pay table at the matched count (unchanged from before)", () => {
    expect(payoutFor({ symbol: "dot", count: 3, positions: [0, 1, 2] }, 10, "5x3")).toBe(15);
    expect(payoutFor({ symbol: "seven", count: 5, positions: [0, 1, 2, 3, 4] }, 2, "5x3")).toBe(80);
  });

  it("pays the 5x3 table's middle tier (count 4) between the 3-of-a-kind and 5-of-a-kind tiers", () => {
    expect(payoutFor({ symbol: "star", count: 4, positions: [0, 1, 2, 3] }, 10, "5x3")).toBe(65);
  });

  it("rounds to 4 decimal places", () => {
    expect(payoutFor({ symbol: "dot", count: 3, positions: [0, 1, 2] }, 0.10005, "5x3")).toBe(0.1501);
  });

  it("pays the 3x3 table at its own tiers", () => {
    // dot tier0 (count 2) = 0.5x, tier1 (count 3) = 5.5x
    expect(payoutFor({ symbol: "dot", count: 2, positions: [0, 1] }, 10, "3x3")).toBe(5);
    expect(payoutFor({ symbol: "dot", count: 3, positions: [0, 1, 2] }, 10, "3x3")).toBe(55);
  });

  it("pays the 3x4 table at its own tiers", () => {
    expect(payoutFor({ symbol: "seven", count: 3, positions: [0, 1, 2] }, 10, "3x4")).toBe(60);
    expect(payoutFor({ symbol: "seven", count: 4, positions: [0, 1, 2, 3] }, 10, "3x4")).toBe(485);
  });

  it("pays the 3x6 table across its 3 tiers (count 4 / 5 / 6)", () => {
    expect(payoutFor({ symbol: "star", count: 4, positions: [0, 1, 2, 3] }, 10, "3x6")).toBe(80);
    expect(payoutFor({ symbol: "star", count: 5, positions: [0, 1, 2, 3, 4] }, 10, "3x6")).toBe(155);
    expect(payoutFor({ symbol: "star", count: 6, positions: [0, 1, 2, 3, 4, 5] }, 10, "3x6")).toBe(620);
  });

  it("scales the raw payout by (1 - houseEdge) / that board size's BASELINE_RTP when houseEdge is given", () => {
    const win = { symbol: "seven" as const, count: 5, positions: [0, 1, 2, 3, 4] };
    const raw = payoutFor(win, 100, "5x3");
    const scaled = payoutFor(win, 100, "5x3", DEFAULT_HOUSE_EDGE);
    expect(scaled).toBe(roundMoney(raw * ((1 - DEFAULT_HOUSE_EDGE) / SINGLE_ROW_TABLES["5x3"]!.baselineRtp)));
  });

  it("a lower house edge pays more, a higher house edge pays less, than the unscaled default", () => {
    const win = { symbol: "seven" as const, count: 5, positions: [0, 1, 2, 3, 4] };
    const raw = payoutFor(win, 100, "5x3");
    expect(payoutFor(win, 100, "5x3", MIN_HOUSE_EDGE)).toBeGreaterThan(raw);
    expect(payoutFor(win, 100, "5x3", MAX_HOUSE_EDGE)).toBeLessThan(raw);
  });
});

describe("SYMBOL_WEIGHTS", () => {
  it("weights sum to exactly 1", () => {
    const total = SYMBOL_WEIGHTS.reduce((s, x) => s + x.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("is ordered rarest-last (dot most common, seven rarest)", () => {
    for (let i = 1; i < SYMBOL_WEIGHTS.length; i++) {
      expect(SYMBOL_WEIGHTS[i].weight).toBeLessThan(SYMBOL_WEIGHTS[i - 1].weight);
    }
  });
});

describe("single-row RTP", () => {
  // Exact multinomial-composition enumeration over SYMBOL_WEIGHTS, generic
  // over column count — recomputed independently of evaluateWin/payoutFor
  // so a change to a board size's table can't silently drift its payout
  // curve without this test catching it.
  function factorial(n: number): number {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function theoreticalSingleRowRtp(boardSize: BoardSize) {
    const config = SINGLE_ROW_TABLES[boardSize]!;
    const cols = BOARD_DIMENSIONS[boardSize].cols;
    let rtp = 0;
    let hitFrequency = 0;

    function enumerate(idx: number, remaining: number, counts: number[]) {
      if (idx === SYMBOL_WEIGHTS.length - 1) {
        // The last symbol's count isn't free to choose — it's whatever's
        // left after every other symbol has claimed its share of the `cols`
        // reels, since every reel holds exactly one symbol.
        counts[idx] = remaining;
        // coef: the multinomial coefficient cols! / (c0! * c1! * ... * cN!)
        // — how many distinct orderings of the reels produce this exact
        // per-symbol count breakdown.
        let coef = factorial(cols);
        // pw: the probability of any one specific ordering with this count
        // breakdown — each symbol's weight raised to its own count,
        // multiplied together (reels are independent draws).
        let pw = 1;
        for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
          coef /= factorial(counts[i]);
          pw *= SYMBOL_WEIGHTS[i].weight ** counts[i];
        }
        // p: total probability of this count breakdown = (# orderings) *
        // (probability per ordering).
        const p = coef * pw;

        const maxCount = Math.max(...counts);
        if (maxCount >= config.threshold) {
          const tier = config.tierIndex(maxCount);
          const winners = counts.reduce((n, c) => (c === maxCount ? n + 1 : n), 0);
          if (winners === 1) {
            const i = counts.indexOf(maxCount);
            rtp += p * config.symbols[i].pay[tier];
          }
          // winners > 1 (a same-row tie) can't happen for any of these
          // thresholds — see the "avoids same-row ties" test below — so no
          // pay-both-ties branch is needed here.
          hitFrequency += p;
        }
        return;
      }
      for (let c = 0; c <= remaining; c++) {
        counts[idx] = c;
        enumerate(idx + 1, remaining - c, counts);
      }
    }
    enumerate(0, cols, new Array(SYMBOL_WEIGHTS.length).fill(0));
    return { rtp, hitFrequency };
  }

  it("every single-row threshold avoids same-row ties (2 * threshold > cols)", () => {
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const config = SINGLE_ROW_TABLES[boardSize]!;
      const cols = BOARD_DIMENSIONS[boardSize].cols;
      expect(2 * config.threshold).toBeGreaterThan(cols);
    }
  });

  it("matches each board size's pinned baselineRtp", () => {
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const { rtp } = theoreticalSingleRowRtp(boardSize);
      expect(rtp).toBeCloseTo(SINGLE_ROW_TABLES[boardSize]!.baselineRtp, 6);
    }
  });

  it("a chosen house edge scales payoutFor's raw payout by (1 - houseEdge) / baselineRtp, for every single-row board size", () => {
    // Mirrors the 5x3-only version of this test in the payoutFor block
    // above, but exercises payoutFor (and therefore engine.ts's real
    // edgeScale) directly for all 4 sizes, rather than re-deriving the
    // scale factor locally — a purely local `baseline * ((1-e)/baseline)`
    // check is tautological and never touches production code.
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const cols = BOARD_DIMENSIONS[boardSize].cols;
      // A max-count win (all reels the same symbol) is always a valid win
      // at every board size's top tier, regardless of that size's threshold.
      const win = { symbol: "seven" as const, count: cols, positions: Array.from({ length: cols }, (_, i) => i) };
      const raw = payoutFor(win, 100, boardSize);
      for (const houseEdge of [MIN_HOUSE_EDGE, 0.02, DEFAULT_HOUSE_EDGE, MAX_HOUSE_EDGE]) {
        const scaled = payoutFor(win, 100, boardSize, houseEdge);
        expect(scaled).toBe(roundMoney(raw * ((1 - houseEdge) / SINGLE_ROW_TABLES[boardSize]!.baselineRtp)));
      }
    }
  });

  it("hit frequencies land where exact enumeration puts them (documented in the design doc)", () => {
    const expected: Record<BoardSize, [number, number]> = {
      "3x3": [0.55, 0.65],
      "3x4": [0.18, 0.25],
      "5x3": [0.35, 0.48],
      // Lower than the other sizes: 3x6's threshold was raised from 3 to 4
      // to avoid same-row ties (2*4=8>6) — see design doc's "Correction"
      // note. 17.5% is the actually-achievable hit frequency at threshold 4.
      "3x6": [0.14, 0.21],
      "4x6": [0, 0], // unused, no single-row table
    };
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const { hitFrequency } = theoreticalSingleRowRtp(boardSize);
      const [lo, hi] = expected[boardSize];
      expect(hitFrequency).toBeGreaterThan(lo);
      expect(hitFrequency).toBeLessThan(hi);
    }
  });

  it("within every board size's table, rarer symbols pay more at every tier", () => {
    for (const boardSize of Object.keys(SINGLE_ROW_TABLES) as BoardSize[]) {
      const symbols = SINGLE_ROW_TABLES[boardSize]!.symbols;
      for (let i = 1; i < symbols.length; i++) {
        for (let tier = 0; tier < symbols[i].pay.length; tier++) {
          // >= not > : 3x3's tier-0 has an intentional tie between
          // square/diamond, a rounding artifact of that board's coarse
          // probability space — see design doc.
          expect(symbols[i].pay[tier]).toBeGreaterThanOrEqual(symbols[i - 1].pay[tier]);
        }
      }
    }
  });
});
