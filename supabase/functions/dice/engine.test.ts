import { describe, it, expect } from "vitest";
import {
  rollValue,
  winChanceFor,
  multiplierFor,
  isWin,
  roundMoney,
  HOUSE_EDGE,
  MIN_WIN_CHANCE,
  MAX_WIN_CHANCE,
} from "./engine";

describe("winChanceFor", () => {
  it("under: win chance equals the target", () => {
    expect(winChanceFor(30, "under")).toBe(30);
  });
  it("over: win chance is 100 minus the target", () => {
    expect(winChanceFor(30, "over")).toBe(70);
  });
});

describe("multiplierFor", () => {
  it("applies the house edge to the fair 100/winChance multiplier", () => {
    expect(multiplierFor(50)).toBeCloseTo(98 / 50, 10);
  });
  it("at MIN_WIN_CHANCE gives the maximum multiplier", () => {
    expect(multiplierFor(MIN_WIN_CHANCE)).toBeCloseTo(98 / 1, 10);
  });
  it("at MAX_WIN_CHANCE gives the minimum multiplier", () => {
    expect(multiplierFor(MAX_WIN_CHANCE)).toBeCloseTo(98 / 95, 10);
  });
  it("HOUSE_EDGE is 2%", () => {
    expect(HOUSE_EDGE).toBe(0.02);
  });
});

describe("isWin", () => {
  it("under: wins strictly below the target", () => {
    expect(isWin(29.99, 30, "under")).toBe(true);
    expect(isWin(30, 30, "under")).toBe(false);
    expect(isWin(30.01, 30, "under")).toBe(false);
  });
  it("over: wins strictly above the target", () => {
    expect(isWin(30.01, 30, "over")).toBe(true);
    expect(isWin(30, 30, "over")).toBe(false);
    expect(isWin(29.99, 30, "over")).toBe(false);
  });
});

describe("rollValue", () => {
  it("floors to 2 decimal places and stays within [0, 100)", () => {
    expect(rollValue(() => 0)).toBe(0);
    expect(rollValue(() => 0.9999999)).toBe(99.99);
    expect(rollValue(() => 0.123456)).toBe(12.34);
  });
});

describe("roundMoney", () => {
  it("rounds to 4 decimal places", () => {
    expect(roundMoney(1.00005)).toBe(1.0001);
    expect(roundMoney(1.00004)).toBe(1);
  });
});
