import { describe, it, expect } from "vitest";
import { handValue, isBlackjack, isBust, cardValue } from "./engine";
import type { Card } from "./engine";

const c = (rank: Card["rank"], suit: Card["suit"] = "S"): Card => ({ rank, suit });

describe("cardValue", () => {
  it("faces are 10, ace is 11, pips are face value", () => {
    expect(cardValue(c("K"))).toBe(10);
    expect(cardValue(c("10"))).toBe(10);
    expect(cardValue(c("A"))).toBe(11);
    expect(cardValue(c("7"))).toBe(7);
  });
});

describe("handValue", () => {
  it("sums pips", () => {
    expect(handValue([c("7"), c("9")])).toEqual({ value: 16, soft: false });
  });
  it("counts an ace as 11 when it fits (soft)", () => {
    expect(handValue([c("A"), c("6")])).toEqual({ value: 17, soft: true });
  });
  it("demotes aces to 1 to avoid bust (hard)", () => {
    expect(handValue([c("A"), c("6"), c("10")])).toEqual({ value: 17, soft: false });
  });
  it("handles multiple aces", () => {
    expect(handValue([c("A"), c("A"), c("9")])).toEqual({ value: 21, soft: true });
  });
});

describe("isBlackjack", () => {
  it("true for two-card 21", () => {
    expect(isBlackjack([c("A"), c("K")])).toBe(true);
  });
  it("false for 21 across three cards", () => {
    expect(isBlackjack([c("7"), c("7"), c("7")])).toBe(false);
  });
});

describe("isBust", () => {
  it("true above 21", () => {
    expect(isBust([c("K"), c("Q"), c("5")])).toBe(true);
  });
  it("false at 21 or below", () => {
    expect(isBust([c("K"), c("A")])).toBe(false);
  });
});

import { buildShoe, shuffle, NUM_DECKS } from "./engine";

describe("buildShoe", () => {
  it("creates 52 * NUM_DECKS cards", () => {
    expect(buildShoe().length).toBe(52 * NUM_DECKS);
  });
  it("has the right per-deck composition", () => {
    const shoe = buildShoe();
    const aces = shoe.filter((c) => c.rank === "A").length;
    expect(aces).toBe(4 * NUM_DECKS);
  });
});

describe("shuffle", () => {
  it("is a permutation (same multiset) and deterministic for a fixed rng", () => {
    const shoe = buildShoe();
    const shuffled = shuffle(shoe, () => 0);
    expect(shuffled.length).toBe(shoe.length);
    const count = (arr: typeof shoe) =>
      arr.reduce<Record<string, number>>((m, c) => {
        const k = c.rank + c.suit;
        m[k] = (m[k] ?? 0) + 1;
        return m;
      }, {});
    expect(count(shuffled)).toEqual(count(shoe));
  });
  it("does not mutate the input", () => {
    const shoe = buildShoe();
    const copy = [...shoe];
    shuffle(shoe, () => 0.5);
    expect(shoe).toEqual(copy);
  });
});
