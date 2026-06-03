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
import { startRound } from "./engine";

// Build a shoe whose FRONT cards are dealt in order: P1, D1(up), P2, D2(hole), ...
function stacked(order: Card[]): Card[] {
  return [...order, ...buildShoe()];
}

describe("startRound", () => {
  it("deals two cards each, player gets index 0 and 2", () => {
    const shoe = stacked([c("9"), c("7","H"), c("8"), c("6","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(s.hands[0].cards).toEqual([c("9"), c("8")]);
    expect(s.dealer).toEqual([c("7","H"), c("6","H")]);
    expect(s.baseBet).toBe(1000);
    expect(s.status).toBe("player_turn");
  });

  it("settles immediately when player has blackjack and dealer does not", () => {
    const shoe = stacked([c("A"), c("5","H"), c("K"), c("6","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).toBe("blackjack");
    expect(s.hands[0].payout).toBe(2500);
  });

  it("peeks on a 10 upcard and ends the round on dealer blackjack", () => {
    const shoe = stacked([c("9"), c("K","H"), c("8"), c("A","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).toBe("lose");
    expect(s.hands[0].payout).toBe(0);
  });

  it("both blackjack pushes", () => {
    const shoe = stacked([c("A"), c("K","H"), c("K"), c("A","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).toBe("push");
    expect(s.hands[0].payout).toBe(1000);
  });
});

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

import { legalActions } from "./engine";
import { applyMove } from "./engine";

describe("legalActions", () => {
  it("hit/stand/double on a fresh two-card hand", () => {
    const shoe = stacked([c("9"), c("7","H"), c("8"), c("6","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(legalActions(s).sort()).toEqual(["double","hit","stand"]);
  });

  it("offers split on a matching pair", () => {
    const shoe = stacked([c("8"), c("7","H"), c("8","D"), c("6","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(legalActions(s)).toContain("split");
  });

  it("treats all ten-value cards as a splittable pair", () => {
    const shoe = stacked([c("K"), c("7","H"), c("10","D"), c("6","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(legalActions(s)).toContain("split");
  });

  it("offers insurance only on an ace upcard, as the first decision", () => {
    const shoe = stacked([c("9"), c("A","H"), c("8"), c("5","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(legalActions(s)).toContain("insurance");
  });

  it("returns nothing once the round is complete", () => {
    const shoe = stacked([c("A"), c("5","H"), c("K"), c("6","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(legalActions(s)).toEqual([]);
  });
});

describe("applyMove: hit/stand/double + dealer", () => {
  it("hit adds a card; bust loses the hand", () => {
    const shoe = stacked([c("9"), c("7","H"), c("8"), c("6","H"), c("K")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "hit");
    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).toBe("lose");
  });

  it("stand passes to the dealer, who stands on all 17", () => {
    const shoe = stacked([c("10"), c("10","H"), c("9"), c("7","H")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "stand");
    expect(s.status).toBe("complete");
    expect(s.dealer.length).toBe(2);
    expect(s.hands[0].outcome).toBe("win");
    expect(s.hands[0].payout).toBe(2000);
  });

  it("dealer draws until 17 then stands", () => {
    const shoe = stacked([c("10"), c("5","H"), c("9"), c("6","H"), c("9","D")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "stand");
    expect(handValue(s.dealer).value).toBe(20);
    expect(s.hands[0].outcome).toBe("lose");
  });

  it("double draws exactly one card, doubles the bet, ends the hand", () => {
    const shoe = stacked([c("5"), c("10","H"), c("6"), c("7","H"), c("9","D")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "double");
    expect(s.hands[0].bet).toBe(2000);
    expect(s.hands[0].cards.length).toBe(3);
    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).toBe("win");
    expect(s.hands[0].payout).toBe(4000);
  });

  it("rejects an illegal move", () => {
    const shoe = stacked([c("5"), c("10","H"), c("6"), c("7","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(() => applyMove(s, "insurance")).toThrow();
  });
});
