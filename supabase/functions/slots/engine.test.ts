import { describe, it, expect } from "vitest";
import {
  SYMBOLS,
  pickSymbol,
  spin,
  evaluateWin,
  payoutFor,
  roundMoney,
  REEL_COUNT,
  FULL_BOARD_SYMBOLS,
  evaluateFullBoardWin,
  payoutForFullBoard,
  type Reel,
  type SymbolId,
} from "./engine";

function queue(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("SYMBOLS", () => {
  it("weights sum to exactly 1", () => {
    const total = SYMBOLS.reduce((s, x) => s + x.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("rarer symbols pay more at every run length", () => {
    for (let i = 1; i < SYMBOLS.length; i++) {
      const prev = SYMBOLS[i - 1];
      const cur = SYMBOLS[i];
      expect(cur.weight).toBeLessThan(prev.weight);
      expect(cur.pay[3]).toBeGreaterThan(prev.pay[3]);
      expect(cur.pay[4]).toBeGreaterThan(prev.pay[4]);
      expect(cur.pay[5]).toBeGreaterThan(prev.pay[5]);
    }
  });
});

describe("pickSymbol", () => {
  it("picks the first symbol whose cumulative weight exceeds r", () => {
    // Cumulative bounds: dot [0, .35), square [.35, .6), diamond [.6, .8),
    // star [.8, .92), seven [.92, 1).
    expect(pickSymbol(() => 0)).toBe("dot");
    expect(pickSymbol(() => 0.349999)).toBe("dot");
    expect(pickSymbol(() => 0.35)).toBe("square");
    expect(pickSymbol(() => 0.599999)).toBe("square");
    expect(pickSymbol(() => 0.6)).toBe("diamond");
    expect(pickSymbol(() => 0.799999)).toBe("diamond");
    expect(pickSymbol(() => 0.8)).toBe("star");
    expect(pickSymbol(() => 0.919999)).toBe("star");
    expect(pickSymbol(() => 0.92)).toBe("seven");
    expect(pickSymbol(() => 0.999999)).toBe("seven");
  });

  it("never throws and always returns a known symbol id for the full [0,1) range", () => {
    const ids = new Set(SYMBOLS.map((s) => s.id));
    for (let r = 0; r < 1; r += 0.013) {
      expect(ids.has(pickSymbol(() => r))).toBe(true);
    }
  });
});

describe("spin", () => {
  it("draws REEL_COUNT reels, each from 3 independent rng() calls (top, mid, bottom)", () => {
    // 15 draws: reel i's top/mid/bottom = the i*3, i*3+1, i*3+2'th queued values.
    const rng = queue([
      0, 0, 0, // reel0: dot, dot, dot
      0.35, 0.35, 0.35, // reel1: square, square, square
      0.6, 0.8, 0.92, // reel2: diamond, star, seven
      0, 0.35, 0.6, // reel3: dot, square, diamond
      0.92, 0.8, 0, // reel4: seven, star, dot
    ]);
    const reels = spin(rng);
    expect(reels).toHaveLength(REEL_COUNT);
    expect(reels[0]).toEqual({ top: "dot", mid: "dot", bottom: "dot" });
    expect(reels[1]).toEqual({ top: "square", mid: "square", bottom: "square" });
    expect(reels[2]).toEqual({ top: "diamond", mid: "star", bottom: "seven" });
    expect(reels[3]).toEqual({ top: "dot", mid: "square", bottom: "diamond" });
    expect(reels[4]).toEqual({ top: "seven", mid: "star", bottom: "dot" });
  });
});

function reelsWithMid(mids: SymbolId[]): Reel[] {
  return mids.map((mid) => ({ top: "dot", mid, bottom: "dot" }));
}

describe("evaluateWin", () => {
  it("returns null when no symbol reaches 3 matches", () => {
    expect(evaluateWin(reelsWithMid(["dot", "dot", "square", "square", "diamond"]))).toBeNull();
    expect(evaluateWin(reelsWithMid(["dot", "square", "dot", "diamond", "star"]))).toBeNull();
  });

  it("matches anywhere on the payline (scatter), not just a contiguous run from reel 0", () => {
    // reel 0 breaks the run, but 4 of the other reels still match — must win.
    expect(evaluateWin(reelsWithMid(["square", "dot", "dot", "dot", "dot"]))).toEqual({
      symbol: "dot",
      count: 4,
      positions: [1, 2, 3, 4],
    });
  });

  it("detects a 3-of-a-kind spread across non-adjacent reels", () => {
    expect(evaluateWin(reelsWithMid(["star", "dot", "star", "square", "star"]))).toEqual({
      symbol: "star",
      count: 3,
      positions: [0, 2, 4],
    });
  });

  it("detects a contiguous 3-in-a-row", () => {
    expect(evaluateWin(reelsWithMid(["star", "star", "star", "dot", "square"]))).toEqual({
      symbol: "star",
      count: 3,
      positions: [0, 1, 2],
    });
  });

  it("detects a 4-in-a-row", () => {
    expect(evaluateWin(reelsWithMid(["seven", "seven", "seven", "seven", "dot"]))).toEqual({
      symbol: "seven",
      count: 4,
      positions: [0, 1, 2, 3],
    });
  });

  it("detects a 5-in-a-row", () => {
    expect(evaluateWin(reelsWithMid(["diamond", "diamond", "diamond", "diamond", "diamond"]))).toEqual({
      symbol: "diamond",
      count: 5,
      positions: [0, 1, 2, 3, 4],
    });
  });
});

describe("payoutFor", () => {
  it("returns 0 for no win", () => {
    expect(payoutFor(null, 10)).toBe(0);
  });

  it("multiplies bet by the symbol's pay table at the matched count", () => {
    expect(payoutFor({ symbol: "dot", count: 3, positions: [0, 1, 2] }, 10)).toBe(10);
    expect(payoutFor({ symbol: "seven", count: 5, positions: [0, 1, 2, 3, 4] }, 2)).toBe(480);
  });

  it("rounds to 4 decimal places", () => {
    // 0.10005 * 1.5 = 0.150075 -> rounds to 0.1501 (square's 3-of-a-kind pays 1.5x)
    expect(payoutFor({ symbol: "square", count: 3, positions: [0, 1, 2] }, 0.10005)).toBe(0.1501);
  });
});

describe("roundMoney", () => {
  it("rounds to 4 decimal places", () => {
    expect(roundMoney(1.00005)).toBe(1.0001);
    expect(roundMoney(1.00004)).toBe(1);
  });
});

describe("RTP", () => {
  // Closed-form theoretical RTP, recomputed independently of engine.ts so a
  // change to SYMBOLS' weights/pay table can't silently drift the payout
  // curve without this test catching it. Wins are scatter-style (3+ of the
  // same symbol anywhere among the 5 reels), so exactly-k probabilities use
  // the binomial coefficient C(5,k), not a single left-aligned arrangement.
  function choose5(k: number): number {
    return [1, 5, 10, 10, 5, 1][k];
  }

  function theoreticalRtp() {
    let rtp = 0;
    let hitFrequency = 0;
    for (const s of SYMBOLS) {
      const p3 = choose5(3) * s.weight ** 3 * (1 - s.weight) ** 2;
      const p4 = choose5(4) * s.weight ** 4 * (1 - s.weight);
      const p5 = s.weight ** 5;
      rtp += p3 * s.pay[3] + p4 * s.pay[4] + p5 * s.pay[5];
      hitFrequency += p3 + p4 + p5;
    }
    return { rtp, hitFrequency };
  }

  it("pays back roughly 97-99% over the long run (a ~1.8% house edge)", () => {
    const { rtp } = theoreticalRtp();
    expect(rtp).toBeGreaterThan(0.97);
    expect(rtp).toBeLessThan(0.99);
  });

  it("hit frequency reflects that matches count anywhere on the payline, not just left-aligned", () => {
    // Much higher than a contiguous-only rule (~11%) since scatter matches
    // land in C(5,k) arrangements instead of just 1.
    const { hitFrequency } = theoreticalRtp();
    expect(hitFrequency).toBeGreaterThan(0.35);
    expect(hitFrequency).toBeLessThan(0.48);
  });
});

describe("evaluateFullBoardWin", () => {
  it("returns null when the max count across all 15 cells is below 7", () => {
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "square" },
      { top: "dot", mid: "dot", bottom: "square" },
      { top: "dot", mid: "square", bottom: "diamond" },
      { top: "diamond", mid: "star", bottom: "seven" },
      { top: "star", mid: "seven", bottom: "square" },
    ];
    expect(evaluateFullBoardWin(reels)).toBeNull();
  });

  it("counts matches across all 3 rows, not just mid, at the 7-cell threshold", () => {
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "square" },
      { top: "dot", mid: "dot", bottom: "square" },
      { top: "dot", mid: "dot", bottom: "diamond" },
      { top: "dot", mid: "square", bottom: "diamond" },
      { top: "star", mid: "seven", bottom: "square" },
    ];
    expect(evaluateFullBoardWin(reels)).toEqual({
      count: 7,
      wins: [
        {
          symbol: "dot",
          positions: [
            { reel: 0, row: "top" },
            { reel: 0, row: "mid" },
            { reel: 1, row: "top" },
            { reel: 1, row: "mid" },
            { reel: 2, row: "top" },
            { reel: 2, row: "mid" },
            { reel: 3, row: "top" },
          ],
        },
      ],
    });
  });

  it("reaches the 9-cell BIG WIN tier", () => {
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "diamond" },
      { top: "dot", mid: "square", bottom: "diamond" },
      { top: "star", mid: "seven", bottom: "square" },
    ];
    const win = evaluateFullBoardWin(reels);
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot" })]);
    expect(win?.count).toBe(9);
  });

  it("reaches the 11-cell MEGA WIN tier", () => {
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "diamond" },
      { top: "star", mid: "seven", bottom: "square" },
    ];
    const win = evaluateFullBoardWin(reels);
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot" })]);
    expect(win?.count).toBe(11);
  });

  it("both symbols win when they tie for the max count", () => {
    // dot and square both land exactly 7 times — both must appear in `wins`,
    // not just the rarer one.
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "square", bottom: "square" },
      { top: "square", mid: "square", bottom: "square" },
      { top: "square", mid: "square", bottom: "diamond" },
    ];
    const win = evaluateFullBoardWin(reels);
    expect(win?.count).toBe(7);
    expect(win?.wins.map((w) => w.symbol).sort()).toEqual(["dot", "square"]);
    expect(win?.wins.every((w) => w.positions.length === 7)).toBe(true);
  });

  it("never ties three ways (15 cells can't fit three symbols at 7+)", () => {
    // Sanity check on the data itself, not a specific spin: 3 * FULL_BOARD_MIN_COUNT > 15.
    expect(3 * 7).toBeGreaterThan(15);
  });
});

describe("payoutForFullBoard", () => {
  it("returns 0 for no win", () => {
    expect(payoutForFullBoard(null, 10)).toBe(0);
  });

  it("pays the tier-0 rate for 7-8 matches", () => {
    expect(payoutForFullBoard({ count: 7, wins: [{ symbol: "dot", positions: [] }] }, 10)).toBe(20);
    expect(payoutForFullBoard({ count: 8, wins: [{ symbol: "dot", positions: [] }] }, 10)).toBe(20);
  });

  it("pays the tier-1 rate for 9-10 matches", () => {
    expect(payoutForFullBoard({ count: 9, wins: [{ symbol: "square", positions: [] }] }, 10)).toBe(90);
    expect(payoutForFullBoard({ count: 10, wins: [{ symbol: "square", positions: [] }] }, 10)).toBe(90);
  });

  it("pays the tier-2 rate for 11+ matches", () => {
    expect(payoutForFullBoard({ count: 11, wins: [{ symbol: "seven", positions: [] }] }, 2)).toBe(210);
    expect(payoutForFullBoard({ count: 15, wins: [{ symbol: "seven", positions: [] }] }, 2)).toBe(210);
  });

  it("pays every tied symbol's rate when two symbols share the max count", () => {
    // dot (2x) + square (3x) tier-0 = 5x total, not just one or the other.
    const win = {
      count: 7,
      wins: [
        { symbol: "dot" as const, positions: [] },
        { symbol: "square" as const, positions: [] },
      ],
    };
    expect(payoutForFullBoard(win, 10)).toBe(50);
  });
});

describe("full board RTP", () => {
  // Exact multinomial enumeration over all compositions of 15 cells into
  // the 5 symbols (C(19,4) = 3,876 of them), recomputed independently of
  // evaluateFullBoardWin/payoutForFullBoard so a change to FULL_BOARD_SYMBOLS
  // or the pay-all-ties rule can't silently drift the payout curve without
  // this test catching it. Same rule as evaluateFullBoardWin: every symbol
  // at the max count pays (not just one "winner").
  // See docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md.
  function factorial(n: number): number {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function tierIndex(count: number): 0 | 1 | 2 {
    if (count >= 11) return 2;
    if (count >= 9) return 1;
    return 0;
  }

  function theoreticalFullBoardRtp() {
    const n = 15;
    let rtp = 0;
    let hitFrequency = 0;

    function enumerate(idx: number, remaining: number, counts: number[]) {
      if (idx === SYMBOLS.length - 1) {
        counts[idx] = remaining;
        let coef = factorial(n);
        let pw = 1;
        for (let i = 0; i < SYMBOLS.length; i++) {
          coef /= factorial(counts[i]);
          pw *= SYMBOLS[i].weight ** counts[i];
        }
        const p = coef * pw;

        const maxCount = Math.max(...counts);
        if (maxCount >= 7) {
          const tier = tierIndex(maxCount);
          let tiedPay = 0;
          for (let i = 0; i < counts.length; i++) {
            if (counts[i] === maxCount) tiedPay += FULL_BOARD_SYMBOLS[i].pay[tier];
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
    enumerate(0, n, new Array(SYMBOLS.length).fill(0));
    return { rtp, hitFrequency };
  }

  it("pays back roughly 97-99%, matching single-row's house edge", () => {
    const { rtp } = theoreticalFullBoardRtp();
    expect(rtp).toBeGreaterThan(0.97);
    expect(rtp).toBeLessThan(0.99);
  });

  it("hits noticeably less often than single-row, since it needs 7+ of 15 cells", () => {
    const { hitFrequency } = theoreticalFullBoardRtp();
    expect(hitFrequency).toBeGreaterThan(0.28);
    expect(hitFrequency).toBeLessThan(0.36);
  });
});
