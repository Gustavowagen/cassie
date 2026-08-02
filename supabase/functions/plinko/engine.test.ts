import { describe, it, expect } from "vitest";
import {
  ROWS,
  BUCKETS,
  MULTIPLIERS,
  RISKS,
  isRisk,
  dropPath,
  bucketFor,
  multiplierFor,
  roundMoney,
} from "./engine";

// C(ROWS, k) for k = 0..ROWS, built with Pascal's rule so the expectation
// checks below don't depend on the engine's own maths.
function binomial(n: number): number[] {
  let row = [1];
  for (let i = 0; i < n; i++) {
    const next = [1];
    for (let j = 0; j < row.length - 1; j++) next.push(row[j] + row[j + 1]);
    next.push(1);
    row = next;
  }
  return row;
}

// A path is fully determined by the coin flips; feed dropPath a scripted rng.
function rngFromFlips(flips: number[]) {
  let i = 0;
  return () => (flips[i++] === 1 ? 0.75 : 0.25);
}

describe("board shape", () => {
  it("has 12 rows and one more bucket than rows", () => {
    expect(ROWS).toBe(12);
    expect(BUCKETS).toBe(13);
  });

  it("every risk level has one multiplier per bucket", () => {
    for (const risk of RISKS) {
      expect(MULTIPLIERS[risk]).toHaveLength(BUCKETS);
    }
  });

  it("multiplier tables are symmetric about the centre", () => {
    for (const risk of RISKS) {
      expect(MULTIPLIERS[risk]).toEqual([...MULTIPLIERS[risk]].reverse());
    }
  });

  it("multipliers decrease from the edge towards the centre", () => {
    for (const risk of RISKS) {
      const half = MULTIPLIERS[risk].slice(0, Math.ceil(BUCKETS / 2));
      for (let i = 1; i < half.length; i++) {
        expect(half[i]).toBeLessThanOrEqual(half[i - 1]);
      }
    }
  });

  it("higher risk pays more at the edges and less in the centre", () => {
    expect(MULTIPLIERS.high[0]).toBeGreaterThan(MULTIPLIERS.medium[0]);
    expect(MULTIPLIERS.medium[0]).toBeGreaterThan(MULTIPLIERS.low[0]);

    const mid = (BUCKETS - 1) / 2;
    expect(MULTIPLIERS.high[mid]).toBeLessThan(MULTIPLIERS.medium[mid]);
    expect(MULTIPLIERS.medium[mid]).toBeLessThan(MULTIPLIERS.low[mid]);
  });
});

describe("return to player", () => {
  // The bucket a ball lands in is Binomial(ROWS, 0.5), so the expected return
  // is sum(C(12,k) * multiplier[k]) / 2^12. Stake's Plinko targets ~99% and
  // each table lands within a fraction of a percent of it (low 98.98%, medium
  // 98.99%, high 99.12%) rather than hitting it exactly.
  it.each(RISKS.map((r) => [r]))("%s risk returns ~99%%", (risk) => {
    const coeffs = binomial(ROWS);
    const total = 2 ** ROWS;
    const rtp = coeffs.reduce((sum, c, k) => sum + c * MULTIPLIERS[risk][k], 0) / total;
    expect(rtp).toBeCloseTo(0.99, 2);
  });
});

describe("dropPath", () => {
  it("returns one left/right decision per row", () => {
    const path = dropPath(() => 0.25);
    expect(path).toHaveLength(ROWS);
    expect(path.every((d) => d === 0 || d === 1)).toBe(true);
  });

  it("rng below 0.5 goes left, at or above 0.5 goes right", () => {
    expect(dropPath(() => 0.49)).toEqual(Array(ROWS).fill(0));
    expect(dropPath(() => 0.5)).toEqual(Array(ROWS).fill(1));
  });
});

describe("bucketFor", () => {
  it("counts the rightward steps", () => {
    expect(bucketFor(Array(ROWS).fill(0))).toBe(0);
    expect(bucketFor(Array(ROWS).fill(1))).toBe(ROWS);
    expect(bucketFor(dropPath(rngFromFlips([1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0])))).toBe(5);
  });

  it("only ever lands in a real bucket", () => {
    const bucket = bucketFor(dropPath(() => Math.random()));
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(BUCKETS);
  });
});

describe("multiplierFor", () => {
  it("reads the multiplier for the landed bucket", () => {
    expect(multiplierFor("medium", 0)).toBe(MULTIPLIERS.medium[0]);
    expect(multiplierFor("medium", 6)).toBe(MULTIPLIERS.medium[6]);
    expect(multiplierFor("high", 12)).toBe(MULTIPLIERS.high[12]);
  });
});

describe("isRisk", () => {
  it("accepts the three risk levels and nothing else", () => {
    expect(isRisk("low")).toBe(true);
    expect(isRisk("medium")).toBe(true);
    expect(isRisk("high")).toBe(true);
    expect(isRisk("extreme")).toBe(false);
    expect(isRisk(undefined)).toBe(false);
  });
});

describe("roundMoney", () => {
  it("rounds to 4 decimal places", () => {
    expect(roundMoney(1.00005)).toBe(1.0001);
    expect(roundMoney(1.00004)).toBe(1);
  });
});
