import { describe, it, expect } from "vitest";
import { calcPayout, validateBets, INSIDE_COMBOS } from "./engine";

describe("straight bets", () => {
  it("pays 36× when the number hits", () => {
    expect(calcPayout(17, { n17: 10 })).toBe(360);
  });
  it("pays nothing when it misses", () => {
    expect(calcPayout(18, { n17: 10 })).toBe(0);
  });
});

describe("split bets", () => {
  it("pays 18× when either covered number hits", () => {
    expect(calcPayout(2, { sp_2_3: 10 })).toBe(180);
    expect(calcPayout(3, { sp_2_3: 10 })).toBe(180);
  });
  it("pays nothing on an uncovered number", () => {
    expect(calcPayout(5, { sp_2_3: 10 })).toBe(0);
  });
  it("split ids are canonical (ascending, sp_ prefix)", () => {
    expect(INSIDE_COMBOS.has("sp_2_3")).toBe(true); // 2-3 vertical split
    expect(INSIDE_COMBOS.has("sp_3_6")).toBe(true); // 3-6 horizontal split
  });
});

describe("corner bets", () => {
  it("pays 9× when any of the four covered numbers hits", () => {
    for (const n of [2, 3, 5, 6]) {
      expect(calcPayout(n, { cn_2_3_5_6: 10 })).toBe(90);
    }
  });
  it("pays nothing on an uncovered number", () => {
    expect(calcPayout(1, { cn_2_3_5_6: 10 })).toBe(0);
  });
});

describe("zero results never win inside combos", () => {
  it("0 and 00 pay nothing on split/corner bets", () => {
    expect(calcPayout(0, { sp_2_3: 10, cn_2_3_5_6: 10 })).toBe(0);
    expect(calcPayout(37, { sp_2_3: 10, cn_2_3_5_6: 10 })).toBe(0);
  });
});

describe("validateBets", () => {
  it("accepts valid split/corner ids", () => {
    expect(validateBets({ sp_2_3: 5, cn_2_3_5_6: 5 })).toEqual({ sp_2_3: 5, cn_2_3_5_6: 5 });
  });
  it("rejects a geometrically invalid split (non-adjacent numbers)", () => {
    expect(() => validateBets({ sp_1_36: 5 })).toThrow(/Unknown bet/);
  });
  it("rejects a corner that does not exist on the board", () => {
    expect(() => validateBets({ cn_1_2_3_4: 5 })).toThrow(/Unknown bet/);
  });
});

describe("combo counts match a double-zero board (1–36 body)", () => {
  it("has 57 splits and 22 corners", () => {
    const splits = [...INSIDE_COMBOS.keys()].filter((k) => k.startsWith("sp_"));
    const corners = [...INSIDE_COMBOS.keys()].filter((k) => k.startsWith("cn_"));
    // 3 rows × 11 horizontal + 2 seams × 12 vertical = 33 + 24 = 57 splits.
    expect(splits.length).toBe(57);
    // 2 seams × 11 interior vertices = 22 corners.
    expect(corners.length).toBe(22);
  });
});
