import { describe, it, expect } from "vitest";
import {
  SYMBOLS,
  pickSymbol,
  spin,
  evaluateWin,
  payoutFor,
  roundMoney,
  REEL_COUNT,
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
    // Cumulative bounds: dot [0, .35), square [.35, .60), diamond [.60, .80),
    // star [.80, .92), seven [.92, 1).
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
  it("returns null when the leading run is shorter than 3", () => {
    expect(evaluateWin(reelsWithMid(["dot", "dot", "square", "dot", "dot"]))).toBeNull();
    expect(evaluateWin(reelsWithMid(["dot", "square", "dot", "dot", "dot"]))).toBeNull();
  });

  it("only counts a run starting at reel 0 — a match starting later never pays", () => {
    // reels 1-4 all match, but reel 0 breaks it — this must not count as a win.
    expect(evaluateWin(reelsWithMid(["square", "dot", "dot", "dot", "dot"]))).toBeNull();
  });

  it("detects a 3-in-a-row", () => {
    expect(evaluateWin(reelsWithMid(["star", "star", "star", "dot", "square"]))).toEqual({
      symbol: "star",
      count: 3,
    });
  });

  it("detects a 4-in-a-row", () => {
    expect(evaluateWin(reelsWithMid(["seven", "seven", "seven", "seven", "dot"]))).toEqual({
      symbol: "seven",
      count: 4,
    });
  });

  it("detects a 5-in-a-row", () => {
    expect(evaluateWin(reelsWithMid(["diamond", "diamond", "diamond", "diamond", "diamond"]))).toEqual({
      symbol: "diamond",
      count: 5,
    });
  });
});

describe("payoutFor", () => {
  it("returns 0 for no win", () => {
    expect(payoutFor(null, 10)).toBe(0);
  });

  it("multiplies bet by the symbol's pay table at the matched count", () => {
    expect(payoutFor({ symbol: "dot", count: 3 }, 10)).toBe(70);
    expect(payoutFor({ symbol: "seven", count: 5 }, 2)).toBe(440);
  });

  it("rounds to 4 decimal places", () => {
    // 0.10005 * 7 = 0.70035 -> rounds to 0.7004
    expect(payoutFor({ symbol: "dot", count: 3 }, 0.10005)).toBe(0.7004);
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
  // curve without this test catching it.
  function theoreticalRtp() {
    let rtp = 0;
    let hitFrequency = 0;
    for (const s of SYMBOLS) {
      const p3 = s.weight ** 3 * (1 - s.weight);
      const p4 = s.weight ** 4 * (1 - s.weight);
      const p5 = s.weight ** 5;
      rtp += p3 * s.pay[3] + p4 * s.pay[4] + p5 * s.pay[5];
      hitFrequency += p3 + p4 + p5;
    }
    return { rtp, hitFrequency };
  }

  it("pays back roughly 95-97% over the long run (a fair, sustainable house edge)", () => {
    const { rtp } = theoreticalRtp();
    expect(rtp).toBeCloseTo(0.9581, 3);
    expect(rtp).toBeGreaterThan(0.94);
    expect(rtp).toBeLessThan(0.97);
  });

  it("hit frequency is a plausible single-payline rate", () => {
    const { hitFrequency } = theoreticalRtp();
    expect(hitFrequency).toBeGreaterThan(0.05);
    expect(hitFrequency).toBeLessThan(0.1);
  });
});
