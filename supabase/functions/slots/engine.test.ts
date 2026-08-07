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
  FULL_BOARD_TABLES,
  evaluateFullBoardWin,
  payoutForFullBoard,
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

function fullBoardReels(cellSymbols: SymbolId[], boardSize: BoardSize): Reel[] {
  // cellSymbols is row-major (row0 for every reel, then row1, ...) — this
  // helper reshapes it into the column-major Reel[] the engine expects.
  const { rows, cols } = BOARD_DIMENSIONS[boardSize];
  const reels: Reel[] = Array.from({ length: cols }, () => []);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      reels[c].push(cellSymbols[r * cols + c]);
    }
  }
  return reels;
}

describe("evaluateFullBoardWin", () => {
  it("returns null when no symbol reaches its own threshold (5x3)", () => {
    // dot=6 (below its threshold of 7), square=5 (below 7), diamond=2
    // (below 7), star=1 (below 6), seven=1 (below 5) — nobody qualifies.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot",
      "dot","square","square","square","square",
      "square","diamond","diamond","star","seven",
    ], "5x3");
    expect(evaluateFullBoardWin(reels, "5x3")).toBeNull();
  });

  it("a symbol wins alone at exactly its own threshold, with no other symbol also qualifying (5x3 dot at 7)", () => {
    // dot=7 (at its threshold), square=6 (below its threshold of 7),
    // diamond=2 (below its threshold of 7) — only dot qualifies.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot",
      "dot","dot","square","square","square",
      "square","square","square","diamond","diamond",
    ], "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot", count: 7 })]);
    expect(win?.wins[0].positions).toHaveLength(7);
  });

  it("two different symbols independently clear their own (different) thresholds in the same spin, and both are collected (5x3 dot=7, seven=5)", () => {
    // dot=7 (at its threshold of 7), seven=5 (at its threshold of 5),
    // square=3 (below its threshold of 7) fills the remaining cells.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot",
      "dot","dot","seven","seven","seven",
      "seven","seven","square","square","square",
    ], "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    expect(win?.wins.map((w) => w.symbol).sort()).toEqual(["dot", "seven"]);
    expect(win?.wins.find((w) => w.symbol === "dot")?.count).toBe(7);
    expect(win?.wins.find((w) => w.symbol === "seven")?.count).toBe(5);
  });

  it("collects any number of simultaneously qualifying symbols generically, not just one (3x6: diamond=7, star=6, seven=5 all independently win)", () => {
    // prettier-ignore
    const reels = fullBoardReels([
      "diamond","diamond","diamond","diamond","diamond","diamond",
      "diamond","star","star","star","star","star",
      "star","seven","seven","seven","seven","seven",
    ], "3x6");
    const win = evaluateFullBoardWin(reels, "3x6");
    expect(win?.wins.map((w) => w.symbol).sort()).toEqual(["diamond", "seven", "star"]);
    expect(win?.wins.find((w) => w.symbol === "diamond")?.count).toBe(7);
    expect(win?.wins.find((w) => w.symbol === "star")?.count).toBe(6);
    expect(win?.wins.find((w) => w.symbol === "seven")?.count).toBe(5);
  });

  it("positions use a numeric row index, not a top/mid/bottom label", () => {
    const reels = fullBoardReels(new Array(15).fill("dot"), "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    const rows = win!.wins[0].positions.map((p) => p.row).sort();
    expect(rows).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(win!.wins[0].count).toBe(15);
  });

  it("returns null below the 3x6 board's per-symbol thresholds", () => {
    // dot=8 (below its threshold of 9), square=6 (below 7), diamond=2
    // (below 7), star=1 (below 6), seven=1 (below 5).
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot","dot",
      "dot","dot","square","square","square","square",
      "square","square","diamond","diamond","star","seven",
    ], "3x6");
    expect(evaluateFullBoardWin(reels, "3x6")).toBeNull();
  });

  it("wins at the 3x6 board's dot threshold (9)", () => {
    // dot=9 (at its threshold), square=6 (below its threshold of 7),
    // diamond=3 (below its threshold of 7) fill the remaining 9 cells.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot","dot",
      "dot","dot","dot","square","square","square",
      "square","square","square","diamond","diamond","diamond",
    ], "3x6");
    const win = evaluateFullBoardWin(reels, "3x6");
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot", count: 9 })]);
  });

  it("wins at the 4x6 board's dot threshold (11)", () => {
    // dot=11 (at its threshold), square=8 (below its threshold of 9),
    // diamond=5 (below its threshold of 9) fill the remaining 13 cells.
    const cells = [
      ...new Array(11).fill("dot"),
      ...new Array(8).fill("square"),
      ...new Array(5).fill("diamond"),
    ];
    const reels = fullBoardReels(cells, "4x6");
    const win = evaluateFullBoardWin(reels, "4x6");
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot", count: 11 })]);
  });

  it("the rarest symbol (seven) wins alone at its own threshold of 5, distinct from dot's threshold of 7 (5x3)", () => {
    // seven=5 (at its threshold), dot=6 (below its threshold of 7),
    // square=4 (below its threshold of 7) fill the remaining 10 cells.
    const cells = [...new Array(5).fill("seven"), ...new Array(6).fill("dot"), ...new Array(4).fill("square")];
    const reels = fullBoardReels(cells, "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "seven", count: 5 })]);
  });
});

describe("payoutForFullBoard", () => {
  it("returns 0 for no win", () => {
    expect(payoutForFullBoard(null, 10, "5x3")).toBe(0);
  });

  it("pays the 5x3 table's tier-0 rate for 7-8 matches (unchanged from before)", () => {
    expect(payoutForFullBoard({ count: 7, wins: [{ symbol: "dot", positions: [] }] }, 10, "5x3")).toBe(20);
    expect(payoutForFullBoard({ count: 8, wins: [{ symbol: "dot", positions: [] }] }, 10, "5x3")).toBe(20);
  });

  it("pays the 5x3 table's tier-2 rate for 11+ matches", () => {
    expect(payoutForFullBoard({ count: 11, wins: [{ symbol: "seven", positions: [] }] }, 2, "5x3")).toBe(210);
    expect(payoutForFullBoard({ count: 15, wins: [{ symbol: "seven", positions: [] }] }, 2, "5x3")).toBe(210);
  });

  it("pays every tied symbol's rate when two symbols share the max count (5x3)", () => {
    const win = {
      count: 7,
      wins: [
        { symbol: "dot" as const, positions: [] },
        { symbol: "square" as const, positions: [] },
      ],
    };
    expect(payoutForFullBoard(win, 10, "5x3")).toBe(50);
  });

  it("pays the 3x6 table across its 3 tiers (8-9 / 10-11 / 12-18)", () => {
    expect(payoutForFullBoard({ count: 8, wins: [{ symbol: "dot", positions: [] }] }, 10, "3x6")).toBe(15);
    expect(payoutForFullBoard({ count: 10, wins: [{ symbol: "dot", positions: [] }] }, 10, "3x6")).toBe(50);
    expect(payoutForFullBoard({ count: 18, wins: [{ symbol: "dot", positions: [] }] }, 10, "3x6")).toBe(185);
  });

  it("pays the 4x6 table across its 3 tiers (10-12 / 13-16 / 17-24)", () => {
    expect(payoutForFullBoard({ count: 10, wins: [{ symbol: "dot", positions: [] }] }, 10, "4x6")).toBe(20);
    expect(payoutForFullBoard({ count: 13, wins: [{ symbol: "dot", positions: [] }] }, 10, "4x6")).toBe(55);
    expect(payoutForFullBoard({ count: 24, wins: [{ symbol: "dot", positions: [] }] }, 10, "4x6")).toBe(190);
  });

  it("scales the raw payout by (1 - houseEdge) / that board size's BASELINE_RTP when houseEdge is given", () => {
    const win = { count: 11, wins: [{ symbol: "seven" as const, positions: [] }] };
    const raw = payoutForFullBoard(win, 100, "5x3");
    const scaled = payoutForFullBoard(win, 100, "5x3", DEFAULT_HOUSE_EDGE);
    expect(scaled).toBe(
      roundMoney(raw * ((1 - DEFAULT_HOUSE_EDGE) / FULL_BOARD_TABLES["5x3"]!.baselineRtp))
    );
  });

  it("a lower house edge pays more, a higher house edge pays less, than the unscaled default", () => {
    const win = { count: 11, wins: [{ symbol: "seven" as const, positions: [] }] };
    const raw = payoutForFullBoard(win, 100, "5x3");
    expect(payoutForFullBoard(win, 100, "5x3", MIN_HOUSE_EDGE)).toBeGreaterThan(raw);
    expect(payoutForFullBoard(win, 100, "5x3", MAX_HOUSE_EDGE)).toBeLessThan(raw);
  });
});

describe("full-board RTP", () => {
  // Exact multinomial-composition enumeration over SYMBOL_WEIGHTS, generic
  // over total cell count — recomputed independently of
  // evaluateFullBoardWin/payoutForFullBoard. Ties are summed generically
  // (matches the pay-all-ties rule), though under the current tables at
  // most a 2-way tie is ever reachable — see engine.ts's own corrected
  // comment on this.
  function factorial(n: number): number {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function theoreticalFullBoardRtp(boardSize: "5x3" | "3x6" | "4x6") {
    const config = FULL_BOARD_TABLES[boardSize]!;
    const n = BOARD_DIMENSIONS[boardSize].rows * BOARD_DIMENSIONS[boardSize].cols;
    let rtp = 0;
    let hitFrequency = 0;

    function enumerate(idx: number, remaining: number, counts: number[]) {
      if (idx === SYMBOL_WEIGHTS.length - 1) {
        // The last symbol's count isn't free to choose — it's whatever's
        // left after every other symbol has claimed its share of the `n`
        // cells, since every cell holds exactly one symbol.
        counts[idx] = remaining;
        // coef: the multinomial coefficient n! / (c0! * c1! * ... * cN!) —
        // how many distinct cell layouts produce this exact per-symbol
        // count breakdown.
        let coef = factorial(n);
        // pw: the probability of any one specific layout with this count
        // breakdown — each symbol's weight raised to its own count,
        // multiplied together (cells are independent draws).
        let pw = 1;
        for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
          coef /= factorial(counts[i]);
          pw *= SYMBOL_WEIGHTS[i].weight ** counts[i];
        }
        // p: total probability of this count breakdown = (# layouts) *
        // (probability per layout).
        const p = coef * pw;

        const maxCount = Math.max(...counts);
        if (maxCount >= config.minCount) {
          const tier = config.tierIndex(maxCount);
          // Unlike single-row mode (single winner, no same-row tie
          // possible at any current threshold), full-board mode pays
          // every symbol tied for maxCount — sum each tied symbol's pay
          // at this tier, mirroring evaluateFullBoardWin/
          // payoutForFullBoard's pay-all-ties rule. A k-way tie is only
          // reachable when k * minCount <= n; under the current tables
          // that caps out at a 2-way tie (verified by the "matches each
          // board size's pinned baselineRtp" test above), but this loop
          // stays correct for any tie width.
          let tiedPay = 0;
          for (let i = 0; i < counts.length; i++) {
            if (counts[i] === maxCount) tiedPay += config.symbols[i].pay[tier];
          }
          rtp += p * tiedPay;
          hitFrequency += p;
        }
        return;
      }
      for (let c = 0; c <= remaining; c++) {
        counts[idx] = c;
        enumerate(idx + 1, remaining - c, counts);
      }
    }
    enumerate(0, n, new Array(SYMBOL_WEIGHTS.length).fill(0));
    return { rtp, hitFrequency };
  }

  it("matches each board size's pinned baselineRtp", () => {
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const { rtp } = theoreticalFullBoardRtp(boardSize);
      expect(rtp).toBeCloseTo(FULL_BOARD_TABLES[boardSize]!.baselineRtp, 6);
    }
  });

  it("a chosen house edge scales payoutForFullBoard's raw payout by (1 - houseEdge) / baselineRtp, for every full-board size", () => {
    // Mirrors the 5x3-only version of this test in the payoutForFullBoard
    // block above, but exercises payoutForFullBoard (and therefore
    // engine.ts's real edgeScale) directly for all 3 sizes, rather than
    // re-deriving the scale factor locally — a purely local
    // `baseline * ((1-e)/baseline)` check is tautological (true by algebra
    // for any baseline) and never touches production code.
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const n = BOARD_DIMENSIONS[boardSize].rows * BOARD_DIMENSIONS[boardSize].cols;
      // A max-count win (every cell the same symbol) is always a valid win
      // at every board size's top tier, regardless of that size's minCount.
      const win = { count: n, wins: [{ symbol: "seven" as const, positions: [] }] };
      const raw = payoutForFullBoard(win, 100, boardSize);
      for (const houseEdge of [MIN_HOUSE_EDGE, 0.02, DEFAULT_HOUSE_EDGE, MAX_HOUSE_EDGE]) {
        const scaled = payoutForFullBoard(win, 100, boardSize, houseEdge);
        expect(scaled).toBe(roundMoney(raw * ((1 - houseEdge) / FULL_BOARD_TABLES[boardSize]!.baselineRtp)));
      }
    }
  });

  it("hit frequencies land where exact enumeration puts them (documented in the design doc)", () => {
    const expected: Record<"5x3" | "3x6" | "4x6", [number, number]> = {
      "5x3": [0.28, 0.36],
      "3x6": [0.3, 0.39],
      "4x6": [0.33, 0.42],
    };
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const { hitFrequency } = theoreticalFullBoardRtp(boardSize);
      const [lo, hi] = expected[boardSize];
      expect(hitFrequency).toBeGreaterThan(lo);
      expect(hitFrequency).toBeLessThan(hi);
    }
  });
});
