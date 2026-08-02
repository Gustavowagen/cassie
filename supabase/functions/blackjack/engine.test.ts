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

  it("does not offer split on mismatched ten-value cards (K + 10 is not a pair)", () => {
    const shoe = stacked([c("K"), c("7","H"), c("10","D"), c("6","H")]);
    const s = startRound({ shoe, bet: 1000 });
    expect(legalActions(s)).not.toContain("split");
  });

  it("offers split on matching ten-value cards (K + K)", () => {
    const shoe = stacked([c("K"), c("7","H"), c("K","D"), c("6","H")]);
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

  it("keeps hit and double on a soft 21 (split hand draws to ace-ten)", () => {
    const shoe = stacked([c("K"), c("7","H"), c("K","D"), c("6","H"), c("A","C"), c("2","D")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "split");
    expect(s.hands[0].cards).toEqual([c("K"), c("A","C")]);
    expect(legalActions(s).sort()).toEqual(["double","hit","stand"]);
  });

  it("drops hit, double and split on a hard 21", () => {
    const shoe = stacked([c("7"), c("2","H"), c("7","D"), c("6","H"), c("7","C")]);
    let s = startRound({ shoe, bet: 1000 });
    s = applyMove(s, "hit"); // 7 + 7 + 7 = hard 21
    expect(handValue(s.hands[0].cards)).toEqual({ value: 21, soft: false });
    expect(legalActions(s)).toEqual(["stand"]);
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

describe("split", () => {
  it("splits a pair into two hands, each dealt a card; play continues on hand 0", () => {
    const shoe = stacked([c("8"), c("9","H"), c("8","D"), c("7","H"), c("3"), c("2","D")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "split");
    expect(s.hands.length).toBe(2);
    expect(s.hands[0].cards).toEqual([c("8"), c("3")]);
    expect(s.hands[1].cards).toEqual([c("8","D"), c("2","D")]);
    expect(s.hands[0].bet).toBe(1000);
    expect(s.hands[1].bet).toBe(1000);
    expect(s.activeHand).toBe(0);
    expect(s.status).toBe("player_turn");
  });

  it("split aces get one card each and are done immediately", () => {
    const shoe = stacked([c("A"), c("9","H"), c("A","D"), c("7","H"), c("K"), c("Q","D")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "split");
    expect(s.hands.length).toBe(2);
    expect(s.hands[0].cards.length).toBe(2);
    expect(s.hands[1].cards.length).toBe(2);
    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).not.toBe("blackjack");
  });

  it("pays the blackjack bonus for a two-card 21 on a split (non-ace) hand", () => {
    const shoe = stacked([
      c("10"), c("2","H"), c("10","D"), c("6","H"),
      c("A","C"), c("9","D"),
    ]);
    let s = applyMove(startRound({ shoe, bet: 1000 }), "split");
    expect(s.hands[0].cards).toEqual([c("10"), c("A","C")]);
    expect(s.hands[1].cards).toEqual([c("10","D"), c("9","D")]);

    s = applyMove(s, "stand"); // stand on hand 0's soft 21
    expect(s.activeHand).toBe(1);
    s = applyMove(s, "stand"); // stand on hand 1

    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).toBe("blackjack");
    expect(s.hands[0].payout).toBe(2500);
  });
});

describe("insurance", () => {
  it("taking insurance on dealer blackjack pays 2:1 and ends the round", () => {
    const shoe = stacked([c("9"), c("A","H"), c("8"), c("K","H")]);
    let s = startRound({ shoe, bet: 1000 });
    expect(legalActions(s)).toContain("insurance");
    s = applyMove(s, "insurance");
    expect(s.status).toBe("complete");
    expect(s.insuranceBet).toBe(500);
    expect(s.insurancePayout).toBe(1500);
    expect(s.hands[0].outcome).toBe("lose");
  });

  it("declining (hitting) on an ace upcard peeks; no dealer BJ continues play", () => {
    const shoe = stacked([c("9"), c("A","H"), c("8"), c("5","H"), c("2","D")]);
    let s = startRound({ shoe, bet: 1000 });
    s = applyMove(s, "hit");
    expect(s.insuranceResolved).toBe(true);
    expect(s.status).toBe("player_turn");
    expect(handValue(s.hands[0].cards).value).toBe(19);
  });
});

import { sanitize } from "./engine";

describe("sanitize", () => {
  it("hides the dealer hole card and value during player_turn", () => {
    const shoe = stacked([c("9"), c("7","H"), c("8"), c("6","H")]);
    const s = startRound({ shoe, bet: 1000 });
    const view = sanitize(s, "round-1", 5000);
    expect(view.dealer.cards).toEqual([c("7","H")]);
    expect(view.dealer.hidden).toBe(true);
    expect(view.dealer.value).toBeNull();
    expect(view.hands[0].value).toBe(17);
    expect(view.legalActions.sort()).toEqual(["double","hit","stand"]);
    expect(view.balance).toBe(5000);
    expect((view as unknown as { shoe?: unknown }).shoe).toBeUndefined();
  });

  it("reveals the full dealer hand once complete", () => {
    const shoe = stacked([c("10"), c("10","H"), c("9"), c("7","H")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "stand");
    const view = sanitize(s, "round-1", 5000);
    expect(view.dealer.hidden).toBe(false);
    expect(view.dealer.cards.length).toBe(2);
    expect(view.dealer.value).toBe(17);
  });
});
