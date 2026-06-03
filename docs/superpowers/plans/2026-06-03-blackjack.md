# Blackjack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-authoritative Blackjack as the first playable game — owners enable it from the Games tab, members play single-player vs. the dealer with a modern casino UI.

**Architecture:** A pure TypeScript blackjack **engine** (no I/O, injected RNG) holds all rules and is unit-tested. A Supabase **edge function** wraps the engine, persists hidden round state in a `blackjack_rounds` table (no client RLS access), and mutates balances/transactions. The React client only renders sanitized state and submits intent, so the shoe and dealer hole card are never exposed.

**Tech Stack:** Vite + React 18 + TypeScript, Zustand, Supabase (Postgres + Edge Functions/Deno), Tailwind, vitest (engine tests).

**Reference spec:** `docs/superpowers/specs/2026-06-03-blackjack-design.md`

---

## File Structure

**New**
- `supabase/functions/blackjack/engine.ts` — pure rules engine (shoe, hands, moves, dealer, settle, sanitize).
- `supabase/functions/blackjack/engine.test.ts` — vitest unit tests for the engine.
- `supabase/functions/blackjack/index.ts` — Deno edge function: auth, persistence, balance/transactions, routing to engine.
- `supabase/migrations/011_blackjack_rounds.sql` — hidden round-state table + RLS lockdown.
- `src/hooks/useGames.ts` — list game types, enable/disable casino games (owner).
- `src/hooks/useBlackjack.ts` — invoke the edge function; hold client state.
- `src/components/games/Blackjack.tsx` — the casino table UI.

**Modified**
- `package.json` — add vitest + `test` script.
- `src/types/index.ts` — `CasinoGame`, `BlackjackState` (client view) types.
- `src/pages/CasinoDashboard.tsx` — owner enable grid + member launch + inline game render.

**Engine type contract (defined in Task 3, used everywhere):**

```ts
export type Rank = "A"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"10"|"J"|"Q"|"K";
export type Suit = "S"|"H"|"D"|"C";
export interface Card { rank: Rank; suit: Suit }

export type Move = "hit"|"stand"|"double"|"split"|"insurance";
export type Status = "player_turn"|"dealer_turn"|"complete";
export type Outcome = "win"|"lose"|"push"|"blackjack";

export interface PlayerHand {
  cards: Card[];
  bet: number;          // stake on this hand (doubled hands hold 2x)
  doubled: boolean;
  isSplitAces: boolean; // hands created by splitting aces (one card only, no BJ)
  done: boolean;
  outcome?: Outcome;
  payout?: number;      // total chips RETURNED to player for this hand (stake incl.); 0 = loss
}

export interface RoundState {
  shoe: Card[];             // remaining cards — never sent to client
  dealer: Card[];           // full dealer hand — hole card hidden until dealer_turn
  hands: PlayerHand[];
  activeHand: number;
  baseBet: number;
  insuranceBet: number;
  insuranceResolved: boolean;
  insurancePayout: number;  // chips returned for insurance (0 if none/lost)
  status: Status;
}

export type Rng = () => number; // returns a float in [0, 1)
```

**Sanitized client view (defined in Task 10, mirrored in `src/types`):**

```ts
export interface BlackjackHandView {
  cards: Card[];
  value: number;
  bet: number;
  doubled: boolean;
  outcome?: Outcome;
  payout?: number;
}
export interface BlackjackState {
  roundId: string;
  status: Status;
  dealer: { cards: Card[]; value: number | null; hidden: boolean };
  hands: BlackjackHandView[];
  activeHand: number;
  legalActions: Move[];
  insuranceOffered: boolean;
  balance: number;
}
```

---

## Task 1: Add vitest tooling

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: vitest added to devDependencies, no errors.

- [ ] **Step 2: Add a test script**

In `package.json` `scripts`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Verify vitest runs (no tests yet)**

Run: `npx vitest run`
Expected: exits cleanly reporting "No test files found" (acceptable for now).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for engine tests"
```

---

## Task 2: Engine — card values & hand totals

**Files:**
- Create: `supabase/functions/blackjack/engine.ts`
- Test: `supabase/functions/blackjack/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `supabase/functions/blackjack/engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: FAIL — cannot import from `./engine` (module/exports missing).

- [ ] **Step 3: Implement the engine basics**

Create `supabase/functions/blackjack/engine.ts`:

```ts
export type Rank = "A"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"10"|"J"|"Q"|"K";
export type Suit = "S"|"H"|"D"|"C";
export interface Card { rank: Rank; suit: Suit }

export type Move = "hit"|"stand"|"double"|"split"|"insurance";
export type Status = "player_turn"|"dealer_turn"|"complete";
export type Outcome = "win"|"lose"|"push"|"blackjack";

export interface PlayerHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  isSplitAces: boolean;
  done: boolean;
  outcome?: Outcome;
  payout?: number;
}

export interface RoundState {
  shoe: Card[];
  dealer: Card[];
  hands: PlayerHand[];
  activeHand: number;
  baseBet: number;
  insuranceBet: number;
  insuranceResolved: boolean;
  insurancePayout: number;
  status: Status;
}

export type Rng = () => number;

export const RANKS: Rank[] = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
export const SUITS: Suit[] = ["S","H","D","C"];

export function cardValue(card: Card): number {
  if (card.rank === "A") return 11;
  if (card.rank === "K" || card.rank === "Q" || card.rank === "J" || card.rank === "10") return 10;
  return parseInt(card.rank, 10);
}

export function handValue(cards: Card[]): { value: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card.rank === "A") aces++;
  }
  // Demote aces from 11 to 1 while busting.
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  const soft = aces > 0 && total <= 21; // an ace still counts as 11
  return { value: total, soft };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).value === 21;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).value > 21;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: PASS (all cases above).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/blackjack/engine.ts supabase/functions/blackjack/engine.test.ts
git commit -m "feat(blackjack): card values and hand totals"
```

---

## Task 3: Engine — build & shuffle the shoe

**Files:**
- Modify: `supabase/functions/blackjack/engine.ts`
- Modify: `supabase/functions/blackjack/engine.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `engine.test.ts`:

```ts
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
    // Deterministic rng: always 0 -> Fisher-Yates picks index 0 each step.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: FAIL — `buildShoe`/`shuffle`/`NUM_DECKS` not exported.

- [ ] **Step 3: Implement shoe build & shuffle**

Append to `engine.ts`:

```ts
export const NUM_DECKS = 6;

export function buildShoe(numDecks: number = NUM_DECKS): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ rank, suit });
      }
    }
  }
  return shoe;
}

// Fisher-Yates using injected rng; returns a new array, does not mutate input.
export function shuffle(cards: Card[], rng: Rng): Card[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/blackjack/engine.ts supabase/functions/blackjack/engine.test.ts
git commit -m "feat(blackjack): build and shuffle the shoe"
```

---

## Task 4: Engine — start a round (deal + 10-upcard peek)

**Files:**
- Modify: `supabase/functions/blackjack/engine.ts`
- Modify: `supabase/functions/blackjack/engine.test.ts`

Note: `startRound` takes a *pre-shuffled* shoe so tests can stack the deck. Cards are dealt from the **front** of the shoe array (`shift`). When the dealer's upcard is a 10-value, the dealer peeks immediately; when it is an Ace, peeking is deferred until the insurance decision (Task 6). Player blackjack with no dealer blackjack settles immediately.

- [ ] **Step 1: Write failing tests**

Append to `engine.test.ts`:

```ts
import { startRound } from "./engine";

// Build a shoe whose FRONT cards are dealt in order: P1, D1(up), P2, D2(hole), ...
function stacked(order: Card[]): Card[] {
  return [...order, ...buildShoe()]; // remaining real cards behind the stacked front
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
    expect(s.hands[0].payout).toBe(2500); // 3:2 -> stake 1000 + 1500
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: FAIL — `startRound` not exported.

- [ ] **Step 3: Implement startRound + settlement helpers**

Append to `engine.ts`:

```ts
function draw(state: RoundState): Card {
  const card = state.shoe.shift();
  if (!card) throw new Error("shoe empty");
  return card;
}

function dealerHasBlackjack(state: RoundState): boolean {
  return isBlackjack(state.dealer);
}

// Compute outcome + payout for every hand and mark the round complete.
// Assumes dealer hand is final. payout = chips returned to the player (stake incl.).
export function settle(state: RoundState): RoundState {
  const dealerBJ = isBlackjack(state.dealer);
  const dealerVal = handValue(state.dealer).value;
  const dealerBust = dealerVal > 21;

  for (const hand of state.hands) {
    const playerBJ = isBlackjack(hand.cards) && !hand.isSplitAces && state.hands.length === 1;
    const playerVal = handValue(hand.cards).value;
    if (playerVal > 21) {
      hand.outcome = "lose";
      hand.payout = 0;
    } else if (playerBJ && dealerBJ) {
      hand.outcome = "push";
      hand.payout = hand.bet;
    } else if (playerBJ) {
      hand.outcome = "blackjack";
      hand.payout = Math.floor(hand.bet * 2.5); // stake + 3:2
    } else if (dealerBJ) {
      hand.outcome = "lose";
      hand.payout = 0;
    } else if (dealerBust || playerVal > dealerVal) {
      hand.outcome = "win";
      hand.payout = hand.bet * 2;
    } else if (playerVal < dealerVal) {
      hand.outcome = "lose";
      hand.payout = 0;
    } else {
      hand.outcome = "push";
      hand.payout = hand.bet;
    }
  }

  // Insurance pays 2:1 when the dealer has blackjack.
  state.insurancePayout = state.insuranceBet > 0 && dealerBJ ? state.insuranceBet * 3 : 0;
  state.status = "complete";
  return state;
}

export function startRound(opts: { shoe: Card[]; bet: number }): RoundState {
  const state: RoundState = {
    shoe: [...opts.shoe],
    dealer: [],
    hands: [{
      cards: [],
      bet: opts.bet,
      doubled: false,
      isSplitAces: false,
      done: false,
    }],
    activeHand: 0,
    baseBet: opts.bet,
    insuranceBet: 0,
    insuranceResolved: false,
    insurancePayout: 0,
    status: "player_turn",
  };

  // Deal order: player, dealer(up), player, dealer(hole).
  state.hands[0].cards.push(draw(state));
  state.dealer.push(draw(state));
  state.hands[0].cards.push(draw(state));
  state.dealer.push(draw(state));

  const upcard = state.dealer[0];
  const playerBJ = isBlackjack(state.hands[0].cards);

  // Dealer peeks on a 10-value upcard right away. (Ace upcard defers to the
  // insurance decision in applyMove.)
  if (cardValue(upcard) === 10 && dealerHasBlackjack(state)) {
    return settle(state);
  }
  if (playerBJ) {
    return settle(state);
  }
  return state;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/blackjack/engine.ts supabase/functions/blackjack/engine.test.ts
git commit -m "feat(blackjack): deal, peek on ten upcard, settlement math"
```

---

## Task 5: Engine — legal actions

**Files:**
- Modify: `supabase/functions/blackjack/engine.ts`
- Modify: `supabase/functions/blackjack/engine.test.ts`

`legalActions` reports what the active hand may do. Balance affordability is NOT checked here (the edge function does that); this is pure rule legality.

- [ ] **Step 1: Write failing tests**

Append to `engine.test.ts`:

```ts
import { legalActions } from "./engine";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: FAIL — `legalActions` not exported.

- [ ] **Step 3: Implement legalActions**

Append to `engine.ts`:

```ts
function sameRankValue(a: Card, b: Card): boolean {
  // 10/J/Q/K are all ten-value and count as a pair.
  return cardValue(a) === cardValue(b);
}

export function legalActions(state: RoundState): Move[] {
  if (state.status !== "player_turn") return [];
  const hand = state.hands[state.activeHand];
  if (!hand || hand.done) return [];

  const actions: Move[] = ["hit", "stand"];
  const fresh = hand.cards.length === 2;

  if (fresh && !hand.isSplitAces) {
    actions.push("double"); // double after split allowed; affordability checked by caller
  }
  if (
    fresh &&
    sameRankValue(hand.cards[0], hand.cards[1]) &&
    state.hands.length < 4
  ) {
    actions.push("split");
  }
  if (
    !state.insuranceResolved &&
    cardValue(state.dealer[0]) === 11 && // ace upcard
    state.hands.length === 1 &&
    state.activeHand === 0 &&
    hand.cards.length === 2
  ) {
    actions.push("insurance");
  }
  return actions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/blackjack/engine.ts supabase/functions/blackjack/engine.test.ts
git commit -m "feat(blackjack): legal action computation"
```

---

## Task 6: Engine — apply hit/stand/double + hand advance + dealer play

**Files:**
- Modify: `supabase/functions/blackjack/engine.ts`
- Modify: `supabase/functions/blackjack/engine.test.ts`

`applyMove` validates the move against `legalActions`, mutates a **copy** of state, advances to the next unfinished hand, and — when all hands are done — reveals the dealer, plays out (stand on all 17s), and settles. Insurance/split handled in Task 7 (the function will already route those moves but the branches are filled in then; for this task implement hit/stand/double and the dealer/advance machinery).

- [ ] **Step 1: Write failing tests**

Append to `engine.test.ts`:

```ts
import { applyMove } from "./engine";

describe("applyMove: hit/stand/double + dealer", () => {
  it("hit adds a card; bust loses the hand", () => {
    // player 9+8=17, hit a K -> 27 bust. Dealer 7,6.
    const shoe = stacked([c("9"), c("7","H"), c("8"), c("6","H"), c("K")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "hit");
    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).toBe("lose");
  });

  it("stand passes to the dealer, who stands on all 17", () => {
    // player 10+9=19. dealer 10,7 = 17 stands. player wins.
    const shoe = stacked([c("10"), c("10","H"), c("9"), c("7","H")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "stand");
    expect(s.status).toBe("complete");
    expect(s.dealer.length).toBe(2);
    expect(s.hands[0].outcome).toBe("win");
    expect(s.hands[0].payout).toBe(2000);
  });

  it("dealer draws until 17 then stands", () => {
    // player 10+9=19. dealer 5,6=11, draws next card 9 -> 20, beats player.
    const shoe = stacked([c("10"), c("5","H"), c("9"), c("6","H"), c("9","D")]);
    const s = applyMove(startRound({ shoe, bet: 1000 }), "stand");
    expect(handValue(s.dealer).value).toBe(20);
    expect(s.hands[0].outcome).toBe("lose");
  });

  it("double draws exactly one card, doubles the bet, ends the hand", () => {
    // player 5+6=11, double draws 9 -> 20. dealer 10,7=17. win pays 2x doubled bet.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: FAIL — `applyMove` not exported.

- [ ] **Step 3: Implement applyMove (hit/stand/double), advance, dealer play**

Append to `engine.ts`:

```ts
function clone(state: RoundState): RoundState {
  return {
    ...state,
    shoe: [...state.shoe],
    dealer: [...state.dealer],
    hands: state.hands.map((h) => ({ ...h, cards: [...h.cards] })),
  };
}

// Dealer reveals and draws until reaching 17+ (stands on all 17, incl. soft).
function playDealer(state: RoundState): void {
  const anyLive = state.hands.some((h) => handValue(h.cards).value <= 21);
  if (anyLive) {
    while (handValue(state.dealer).value < 17) {
      state.dealer.push(draw(state));
    }
  }
}

// Move to the next unfinished hand; if none remain, run the dealer and settle.
function advance(state: RoundState): RoundState {
  const next = state.hands.findIndex((h, i) => i > state.activeHand && !h.done);
  if (next !== -1) {
    state.activeHand = next;
    // A split hand that already holds a card and is a split-ace is auto-done.
    return state;
  }
  // No more player hands: dealer's turn.
  state.status = "dealer_turn";
  playDealer(state);
  return settle(state);
}

export function applyMove(prev: RoundState, move: Move, _handIndex?: number): RoundState {
  if (!legalActions(prev).includes(move)) {
    throw new Error(`illegal move: ${move}`);
  }
  const state = clone(prev);
  const hand = state.hands[state.activeHand];

  switch (move) {
    case "hit": {
      hand.cards.push(draw(state));
      if (isBust(hand.cards)) {
        hand.done = true;
        return advance(state);
      }
      return state;
    }
    case "stand": {
      hand.done = true;
      return advance(state);
    }
    case "double": {
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(draw(state));
      hand.done = true;
      return advance(state);
    }
    case "split":
    case "insurance":
      // Implemented in Task 7.
      return applySplitOrInsurance(state, move);
  }
}
```

Also add a temporary stub so the file compiles until Task 7 fills it in:

```ts
function applySplitOrInsurance(_state: RoundState, _move: Move): RoundState {
  throw new Error("not implemented");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: PASS (split/insurance tests not added yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/blackjack/engine.ts supabase/functions/blackjack/engine.test.ts
git commit -m "feat(blackjack): hit/stand/double, hand advance, dealer play"
```

---

## Task 7: Engine — split, resplit, and insurance (with ace-upcard peek)

**Files:**
- Modify: `supabase/functions/blackjack/engine.ts`
- Modify: `supabase/functions/blackjack/engine.test.ts`

Replace the `applySplitOrInsurance` stub. Splitting creates two hands, each receiving one fresh card. Split aces get exactly one card and are marked done (and a resulting 21 is NOT a blackjack — `settle` already guards via `isSplitAces`). Insurance sets the side bet then triggers the deferred ace-upcard peek; declining insurance (choosing any other first move on an ace upcard) also triggers the peek.

- [ ] **Step 1: Write failing tests**

Append to `engine.test.ts`:

```ts
describe("split", () => {
  it("splits a pair into two hands, each dealt a card; play continues on hand 0", () => {
    // player 8,8 ; dealer 9,7. split -> hand0 gets 3, hand1 gets 2 (from shoe front).
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
    // Both 21 but NOT blackjack -> dealer 9,7=16 draws... ensure no 3:2 payout.
    expect(s.status).toBe("complete");
    expect(s.hands[0].outcome).not.toBe("blackjack");
  });
});

describe("insurance", () => {
  it("taking insurance on dealer blackjack pays 2:1 and ends the round", () => {
    // dealer A,K = blackjack. player 9,8=17.
    const shoe = stacked([c("9"), c("A","H"), c("8"), c("K","H")]);
    let s = startRound({ shoe, bet: 1000 });
    expect(legalActions(s)).toContain("insurance");
    s = applyMove(s, "insurance");
    expect(s.status).toBe("complete");
    expect(s.insuranceBet).toBe(500);
    expect(s.insurancePayout).toBe(1500); // 500 stake + 2:1
    expect(s.hands[0].outcome).toBe("lose");
  });

  it("declining (hitting) on an ace upcard peeks; no dealer BJ continues play", () => {
    // dealer A,5 (no BJ). player 9,8=17, hit -> draw 2 -> 19.
    const shoe = stacked([c("9"), c("A","H"), c("8"), c("5","H"), c("2","D")]);
    let s = startRound({ shoe, bet: 1000 });
    s = applyMove(s, "hit");
    expect(s.insuranceResolved).toBe(true);
    expect(s.status).toBe("player_turn");
    expect(handValue(s.hands[0].cards).value).toBe(19);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: FAIL — split/insurance throw "not implemented".

- [ ] **Step 3: Implement split + insurance and wire the ace peek**

Replace the `applySplitOrInsurance` stub in `engine.ts` with:

```ts
function applySplitOrInsurance(state: RoundState, move: Move): RoundState {
  if (move === "insurance") {
    state.insuranceBet = Math.floor(state.baseBet / 2);
    state.insuranceResolved = true;
    return resolveAcePeek(state); // dealer peeks; may end the round
  }
  // move === "split"
  const hand = state.hands[state.activeHand];
  const [first, second] = hand.cards;
  const splittingAces = first.rank === "A";

  const handA: PlayerHand = {
    cards: [first],
    bet: state.baseBet,
    doubled: false,
    isSplitAces: splittingAces,
    done: false,
  };
  const handB: PlayerHand = {
    cards: [second],
    bet: state.baseBet,
    doubled: false,
    isSplitAces: splittingAces,
    done: false,
  };
  // Replace the active hand with the two split hands, preserving order.
  state.hands.splice(state.activeHand, 1, handA, handB);

  // Deal one card to each new hand.
  handA.cards.push(draw(state));
  handB.cards.push(draw(state));

  if (splittingAces) {
    handA.done = true;
    handB.done = true;
  }
  // Stay on handA if it can still act; otherwise advance.
  if (handA.done) {
    return advance(state);
  }
  return state;
}

// Called once the insurance decision is made on an ace upcard.
function resolveAcePeek(state: RoundState): RoundState {
  if (cardValue(state.dealer[0]) === 11 && isBlackjack(state.dealer)) {
    return settle(state);
  }
  return state;
}
```

Then update `applyMove` so that **declining** insurance (any first move on an ace upcard) also triggers the peek. In `applyMove`, immediately after `const hand = state.hands[state.activeHand];`, insert:

```ts
  // Ace-upcard peek: the first non-insurance action closes the insurance
  // window and the dealer peeks. If the dealer has blackjack, the round ends
  // before the player's move takes effect.
  if (
    move !== "insurance" &&
    !state.insuranceResolved &&
    cardValue(state.dealer[0]) === 11
  ) {
    state.insuranceResolved = true;
    const peeked = resolveAcePeek(state);
    if (peeked.status === "complete") return peeked;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: PASS (all engine tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/blackjack/engine.ts supabase/functions/blackjack/engine.test.ts
git commit -m "feat(blackjack): split, resplit, insurance, ace peek"
```

---

## Task 8: Engine — sanitize to client view

**Files:**
- Modify: `supabase/functions/blackjack/engine.ts`
- Modify: `supabase/functions/blackjack/engine.test.ts`

`sanitize` produces the client-safe view: the shoe is dropped, and during `player_turn` only the dealer upcard is shown (`hidden: true`, `value: null`).

- [ ] **Step 1: Write failing tests**

Append to `engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: FAIL — `sanitize` not exported.

- [ ] **Step 3: Implement sanitize + view types**

Append to `engine.ts`:

```ts
export interface BlackjackHandView {
  cards: Card[];
  value: number;
  bet: number;
  doubled: boolean;
  outcome?: Outcome;
  payout?: number;
}

export interface BlackjackState {
  roundId: string;
  status: Status;
  dealer: { cards: Card[]; value: number | null; hidden: boolean };
  hands: BlackjackHandView[];
  activeHand: number;
  legalActions: Move[];
  insuranceOffered: boolean;
  balance: number;
}

export function sanitize(state: RoundState, roundId: string, balance: number): BlackjackState {
  const hideHole = state.status === "player_turn";
  const dealerCards = hideHole ? state.dealer.slice(0, 1) : state.dealer;
  return {
    roundId,
    status: state.status,
    dealer: {
      cards: dealerCards,
      value: hideHole ? null : handValue(state.dealer).value,
      hidden: hideHole,
    },
    hands: state.hands.map((h) => ({
      cards: h.cards,
      value: handValue(h.cards).value,
      bet: h.bet,
      doubled: h.doubled,
      outcome: h.outcome,
      payout: h.payout,
    })),
    activeHand: state.activeHand,
    legalActions: legalActions(state),
    insuranceOffered: legalActions(state).includes("insurance"),
    balance,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/blackjack/engine.test.ts`
Expected: PASS (full engine suite green).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/blackjack/engine.ts supabase/functions/blackjack/engine.test.ts
git commit -m "feat(blackjack): sanitize server state to client view"
```

---

## Task 9: Migration — hidden round-state table

**Files:**
- Create: `supabase/migrations/011_blackjack_rounds.sql`

The table has **no** RLS policies for the anon/authenticated roles, so the shoe and hole card are unreachable through the public API. Only the edge function (service role, which bypasses RLS) reads/writes it.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/011_blackjack_rounds.sql`:

```sql
create table public.blackjack_rounds (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  status text not null default 'player_turn',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast lookup of a user's active round in a casino.
create index blackjack_rounds_active_idx
  on public.blackjack_rounds (casino_id, user_id, status);

-- RLS on with NO policies: the anon/authenticated roles get zero access.
-- The edge function uses the service role key, which bypasses RLS.
alter table public.blackjack_rounds enable row level security;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool:
- name: `011_blackjack_rounds`
- query: the SQL above.

Expected: success; `blackjack_rounds` appears in `list_tables`.

- [ ] **Step 3: Verify the table is locked down**

Using the app's anon client context (or MCP `execute_sql` as the authenticated role), confirm a `select * from blackjack_rounds` returns no rows / permission denied for non-service roles. With service role it is accessible.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/011_blackjack_rounds.sql
git commit -m "feat(blackjack): hidden round-state table with RLS lockdown"
```

---

## Task 10: Edge function — auth, persistence, balance, routing

**Files:**
- Create: `supabase/functions/blackjack/index.ts`

The function authenticates the caller from the JWT, loads/creates round state, calls the engine, persists hidden state, mutates `casino_members.balance`, logs `transactions`, and returns the sanitized view. It uses two Supabase clients: one bound to the caller's JWT (to identify the user and read membership under RLS) and a service-role client (to touch `blackjack_rounds` and apply balance changes).

- [ ] **Step 1: Implement the function**

Create `supabase/functions/blackjack/index.ts`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startRound,
  applyMove,
  sanitize,
  buildShoe,
  shuffle,
  type RoundState,
  type Move,
} from "./engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

// Total chips the player paid in for a round (for transaction accounting).
function totalStaked(state: RoundState): number {
  return state.hands.reduce((sum, h) => sum + h.bet, 0) + state.insuranceBet;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: auth } = await userClient.auth.getUser();
    const user = auth.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json();

    if (body.action === "start") {
      const { casino_id, bet } = body as { casino_id: string; bet: number };

      // Membership + balance (RLS-scoped to the caller).
      const { data: member } = await userClient
        .from("casino_members")
        .select("balance")
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .single();
      if (!member) return json({ error: "You are not a member of this casino" }, 403);

      const { data: gt } = await admin
        .from("game_types")
        .select("min_bet, max_bet")
        .eq("id", "blackjack")
        .single();
      if (!Number.isInteger(bet) || bet < gt!.min_bet || bet > gt!.max_bet) {
        return json({ error: `Bet must be between ${gt!.min_bet} and ${gt!.max_bet}` }, 400);
      }
      if (bet > member.balance) return json({ error: "Insufficient balance" }, 400);

      // One active round at a time.
      await admin
        .from("blackjack_rounds")
        .delete()
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .neq("status", "complete");

      const state = startRound({ shoe: shuffle(buildShoe(), rng), bet });

      // Deduct the stake now; credit any immediate (blackjack/peek) payout.
      let balance = member.balance - bet;
      if (state.status === "complete") {
        const credited = state.hands.reduce((s, h) => s + (h.payout ?? 0), 0) + state.insurancePayout;
        balance += credited;
      }

      const { data: round } = await admin
        .from("blackjack_rounds")
        .insert({ casino_id, user_id: user.id, state, status: state.status })
        .select("id")
        .single();

      await admin.from("casino_members").update({ balance })
        .eq("casino_id", casino_id).eq("user_id", user.id);
      await admin.from("transactions").insert({
        casino_id, user_id: user.id, amount: -bet, balance_after: member.balance - bet,
        game_type_id: "blackjack", description: "Blackjack bet",
      });
      if (state.status === "complete") {
        await admin.from("transactions").insert({
          casino_id, user_id: user.id,
          amount: balance - (member.balance - bet), balance_after: balance,
          game_type_id: "blackjack", description: "Blackjack payout",
        });
      }

      return json(sanitize(state, round!.id, balance));
    }

    if (body.action === "action") {
      const { round_id, move } = body as { round_id: string; move: Move };

      const { data: round } = await admin
        .from("blackjack_rounds")
        .select("*")
        .eq("id", round_id)
        .eq("user_id", user.id)
        .single();
      if (!round) return json({ error: "Round not found" }, 404);
      if (round.status === "complete") return json({ error: "Round already finished" }, 400);

      const prev = round.state as RoundState;
      const stakedBefore = totalStaked(prev);

      let next: RoundState;
      try {
        next = applyMove(prev, move);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }

      // Additional stake required by double/split/insurance.
      const extraStake = totalStaked(next) - stakedBefore;

      const { data: member } = await admin
        .from("casino_members").select("balance")
        .eq("casino_id", round.casino_id).eq("user_id", user.id).single();
      if (extraStake > member!.balance) {
        return json({ error: "Insufficient balance for that move" }, 400);
      }

      let balance = member!.balance - extraStake;
      if (extraStake > 0) {
        await admin.from("transactions").insert({
          casino_id: round.casino_id, user_id: user.id,
          amount: -extraStake, balance_after: balance,
          game_type_id: "blackjack", description: `Blackjack ${move}`,
        });
      }
      if (next.status === "complete") {
        const credited = next.hands.reduce((s, h) => s + (h.payout ?? 0), 0) + next.insurancePayout;
        balance += credited;
        await admin.from("transactions").insert({
          casino_id: round.casino_id, user_id: user.id,
          amount: credited, balance_after: balance,
          game_type_id: "blackjack", description: "Blackjack payout",
        });
      }

      await admin.from("blackjack_rounds")
        .update({ state: next, status: next.status, updated_at: new Date().toISOString() })
        .eq("id", round_id);
      await admin.from("casino_members").update({ balance })
        .eq("casino_id", round.casino_id).eq("user_id", user.id);

      return json(sanitize(next, round_id, balance));
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Deploy the function**

Deploy via the Supabase MCP `deploy_edge_function` tool:
- name: `blackjack`
- entrypoint: `index.ts`
- files: `index.ts` and `engine.ts` (both from `supabase/functions/blackjack/`).

Expected: deploy succeeds; function listed by `list_edge_functions`.

- [ ] **Step 3: Smoke-test the deployed function**

With a valid user JWT (copy from the running app's session, or via MCP), invoke `start` with a real `casino_id` you are a member of and `bet: 500`. Confirm the JSON response contains `hands`, a single-card `dealer`, `legalActions`, and `balance` — and **no** `shoe`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/blackjack/index.ts
git commit -m "feat(blackjack): edge function with auth, persistence, balance"
```

---

## Task 11: Types — CasinoGame & client state

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the types**

Append to `src/types/index.ts`:

```ts
export interface CasinoGame {
  casino_id: string;
  game_type_id: string;
  is_active: boolean;
}

// Mirror of the edge function's sanitized output (engine.ts BlackjackState).
export type Rank = "A"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"10"|"J"|"Q"|"K";
export type Suit = "S"|"H"|"D"|"C";
export interface Card { rank: Rank; suit: Suit }
export type Move = "hit"|"stand"|"double"|"split"|"insurance";
export type BlackjackStatus = "player_turn"|"dealer_turn"|"complete";
export type BlackjackOutcome = "win"|"lose"|"push"|"blackjack";

export interface BlackjackHandView {
  cards: Card[];
  value: number;
  bet: number;
  doubled: boolean;
  outcome?: BlackjackOutcome;
  payout?: number;
}
export interface BlackjackState {
  roundId: string;
  status: BlackjackStatus;
  dealer: { cards: Card[]; value: number | null; hidden: boolean };
  hands: BlackjackHandView[];
  activeHand: number;
  legalActions: Move[];
  insuranceOffered: boolean;
  balance: number;
}
```

- [ ] **Step 2: Verify the type-check passes**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(blackjack): client-side game types"
```

---

## Task 12: Hook — useGames (list types, enable/disable)

**Files:**
- Create: `src/hooks/useGames.ts`

- [ ] **Step 1: Implement the hook**

Create `src/hooks/useGames.ts`:

```ts
import { supabase } from "../lib/supabase";
import type { GameType, CasinoGame } from "../types";

export function useGames() {
  async function listGameTypes(): Promise<GameType[]> {
    const { data, error } = await supabase.from("game_types").select("*").order("name");
    if (error) throw error;
    return (data ?? []) as GameType[];
  }

  async function listCasinoGames(casinoId: string): Promise<CasinoGame[]> {
    const { data, error } = await supabase
      .from("casino_games")
      .select("*")
      .eq("casino_id", casinoId);
    if (error) throw error;
    return (data ?? []) as CasinoGame[];
  }

  async function enableGame(casinoId: string, gameTypeId: string): Promise<void> {
    const { error } = await supabase
      .from("casino_games")
      .upsert({ casino_id: casinoId, game_type_id: gameTypeId, is_active: true });
    if (error) throw error;
  }

  async function disableGame(casinoId: string, gameTypeId: string): Promise<void> {
    const { error } = await supabase
      .from("casino_games")
      .delete()
      .eq("casino_id", casinoId)
      .eq("game_type_id", gameTypeId);
    if (error) throw error;
  }

  return { listGameTypes, listCasinoGames, enableGame, disableGame };
}
```

- [ ] **Step 2: Verify the type-check passes**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGames.ts
git commit -m "feat(blackjack): useGames hook for enabling casino games"
```

---

## Task 13: Hook — useBlackjack (invoke edge function)

**Files:**
- Create: `src/hooks/useBlackjack.ts`

- [ ] **Step 1: Implement the hook**

Create `src/hooks/useBlackjack.ts`:

```ts
import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { BlackjackState, Move } from "../types";

export function useBlackjack(casinoId: string | undefined) {
  const [state, setState] = useState<BlackjackState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("blackjack", { body });
    setLoading(false);
    if (error) {
      // supabase-js returns non-2xx as FunctionsHttpError; the JSON { error }
      // body lives on error.context (a Response), not on `data`.
      let message = error.message;
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const parsed = await ctx.json();
          if (parsed?.error) message = parsed.error as string;
        } catch {
          /* keep the default message */
        }
      }
      setError(message);
      throw new Error(message);
    }
    setState(data as BlackjackState);
    return data as BlackjackState;
  }, []);

  const start = useCallback(
    (bet: number) => invoke({ action: "start", casino_id: casinoId, bet }),
    [invoke, casinoId]
  );

  const act = useCallback(
    (move: Move) => {
      if (!state) throw new Error("No active round");
      return invoke({ action: "action", round_id: state.roundId, move });
    },
    [invoke, state]
  );

  const reset = useCallback(() => setState(null), []);

  return { state, loading, error, start, act, reset };
}
```

- [ ] **Step 2: Verify the type-check passes**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBlackjack.ts
git commit -m "feat(blackjack): useBlackjack hook calling the edge function"
```

---

## Task 14: UI — Blackjack table component

**Files:**
- Create: `src/components/games/Blackjack.tsx`

REQUIRED SUB-SKILL for this task: invoke `frontend-design:frontend-design` to drive the visual quality. The component must be distinctive and polished (felt table, dealt-card animation, chip selector), not generic. Below is the functional contract and a working baseline; the design skill elevates the aesthetics on top of it.

**Props:** `{ casinoId: string; balance: number; minBet: number; maxBet: number; onExit: () => void }`

**Behaviour:**
- Betting view when there is no active round (`state === null` or `status === "complete"`): chip buttons to build a bet (respect min/max and `balance`), "Deal" calls `start(bet)`.
- Active-round view: render dealer area (face-down hole card when `dealer.hidden`), each player hand with its cards and value, highlight `activeHand`, and show action buttons strictly from `state.legalActions`. Disable controls while `loading`.
- Result view when `status === "complete"`: show each hand's `outcome`/`payout`, a result banner, and "New hand" (calls `reset()` back to betting).
- Use `formatChips` from `../../lib/utils` for balance display; cards show rank + suit glyph (♠♥♦♣) with red for H/D.

- [ ] **Step 1: Implement the component (functional baseline; design skill enhances)**

Create `src/components/games/Blackjack.tsx`:

```tsx
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "../ui/button";
import { useBlackjack } from "../../hooks/useBlackjack";
import { formatChips } from "../../lib/utils";
import type { Card, Move } from "../../types";

const SUIT_GLYPH: Record<Card["suit"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const CHIP_VALUES = [100, 500, 1000, 5000];
const ACTION_LABEL: Record<Move, string> = {
  hit: "Hit", stand: "Stand", double: "Double", split: "Split", insurance: "Insurance",
};

function PlayingCard({ card, faceDown }: { card?: Card; faceDown?: boolean }) {
  if (faceDown || !card) {
    return (
      <div className="h-24 w-16 rounded-lg bg-gradient-to-br from-indigo-700 to-purple-900 border border-white/20 shadow-lg" />
    );
  }
  const red = card.suit === "H" || card.suit === "D";
  return (
    <div className="h-24 w-16 rounded-lg bg-white shadow-lg flex flex-col items-center justify-center font-bold">
      <span className={red ? "text-red-600" : "text-gray-900"}>{card.rank}</span>
      <span className={`text-2xl ${red ? "text-red-600" : "text-gray-900"}`}>{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}

export function Blackjack({
  casinoId, balance, minBet, maxBet, onExit,
}: {
  casinoId: string; balance: number; minBet: number; maxBet: number; onExit: () => void;
}) {
  const { state, loading, error, start, act, reset } = useBlackjack(casinoId);
  const [bet, setBet] = useState(minBet);

  const betting = !state || state.status === "complete";
  const liveBalance = state?.balance ?? balance;

  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-gradient-to-b from-emerald-900 to-emerald-950 text-white min-h-[60vh] p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onExit} className="flex items-center gap-1 text-white/70 hover:text-white text-sm">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <span className="rounded-full bg-black/30 px-3 py-1 text-sm font-semibold">
          {formatChips(liveBalance)} chips
        </span>
      </div>

      {error && <p className="text-red-300 text-sm text-center mb-4">{error}</p>}

      {/* Dealer */}
      <div className="text-center mb-8">
        <p className="text-white/60 text-xs uppercase tracking-wide mb-2">
          Dealer {state && !state.dealer.hidden && state.dealer.value != null ? `· ${state.dealer.value}` : ""}
        </p>
        <div className="flex justify-center gap-2 min-h-[6rem]">
          {state?.dealer.cards.map((card, i) => <PlayingCard key={i} card={card} />)}
          {state?.dealer.hidden && <PlayingCard faceDown />}
        </div>
      </div>

      {/* Player hands */}
      <div className="flex flex-wrap justify-center gap-6 mb-8">
        {state?.hands.map((hand, i) => (
          <div
            key={i}
            className={`rounded-xl p-3 ${i === state.activeHand && state.status === "player_turn" ? "ring-2 ring-yellow-400" : ""}`}
          >
            <div className="flex gap-2">
              {hand.cards.map((card, j) => <PlayingCard key={j} card={card} />)}
            </div>
            <p className="text-center mt-2 text-sm">
              {hand.value}{hand.outcome ? ` · ${hand.outcome}` : ""}
              {hand.outcome && hand.payout ? ` (+${formatChips(hand.payout)})` : ""}
            </p>
          </div>
        ))}
      </div>

      {/* Controls */}
      {betting ? (
        <div className="text-center space-y-4">
          <p className="text-lg font-semibold">Place your bet: {formatChips(bet)}</p>
          <div className="flex justify-center flex-wrap gap-2">
            {CHIP_VALUES.map((v) => (
              <button
                key={v}
                onClick={() => setBet((b) => Math.min(maxBet, Math.min(liveBalance, b + v)))}
                className="h-12 w-12 rounded-full bg-yellow-400 text-emerald-950 font-bold text-xs shadow-lg hover:scale-105 transition-transform"
              >
                {formatChips(v)}
              </button>
            ))}
            <button onClick={() => setBet(minBet)} className="h-12 px-3 rounded-full bg-white/20 text-sm">Clear</button>
          </div>
          <Button
            disabled={loading || bet < minBet || bet > liveBalance}
            onClick={() => { reset(); start(bet); }}
            className="bg-yellow-400 text-emerald-950 hover:bg-yellow-300"
          >
            {loading ? "Dealing..." : state?.status === "complete" ? "New hand" : "Deal"}
          </Button>
        </div>
      ) : (
        <div className="flex justify-center flex-wrap gap-2">
          {state!.legalActions.map((move) => (
            <Button key={move} disabled={loading} onClick={() => act(move)}>
              {ACTION_LABEL[move]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the type-check passes**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Polish with the frontend-design skill**

Invoke `frontend-design:frontend-design` and refine `Blackjack.tsx`: add card deal-in animation (CSS transition/keyframes), a richer felt texture/vignette, chip stack visuals, and a result banner. Keep the functional contract (legalActions-driven buttons, loading guards) intact.

- [ ] **Step 4: Commit**

```bash
git add src/components/games/Blackjack.tsx
git commit -m "feat(blackjack): casino table UI"
```

---

## Task 15: Wire into CasinoDashboard (owner enable grid + member launch)

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx`

Replace the owner `GamesPlaceholder` with an enable/disable grid, and replace the member `GamesPlaceholder` with a launcher that opens `Blackjack` inline. Both rely on `useGames`.

- [ ] **Step 1: Add imports and game state**

At the top of `src/pages/CasinoDashboard.tsx`, add imports:

```tsx
import { useGames } from "../hooks/useGames";
import { Blackjack } from "../components/games/Blackjack";
import type { GameType, CasinoGame } from "../types";
```

Inside `CasinoDashboard`, after the existing `useState` declarations, add:

```tsx
const { listGameTypes, listCasinoGames, enableGame, disableGame } = useGames();
const [gameTypes, setGameTypes] = useState<GameType[]>([]);
const [casinoGames, setCasinoGames] = useState<CasinoGame[]>([]);
const [activeGame, setActiveGame] = useState<string | null>(null);

useEffect(() => {
  if (!currentCasino) return;
  listGameTypes().then(setGameTypes);
  listCasinoGames(currentCasino.id).then(setCasinoGames);
}, [currentCasino?.id]);

const enabledIds = new Set(casinoGames.map((g) => g.game_type_id));

async function toggleGame(id: string, enabled: boolean) {
  if (!currentCasino) return;
  if (enabled) await disableGame(currentCasino.id, id);
  else await enableGame(currentCasino.id, id);
  setCasinoGames(await listCasinoGames(currentCasino.id));
}
```

- [ ] **Step 2: Replace the owner GamesPlaceholder call**

Find the line `{activeTab === "games" && <GamesPlaceholder />}` and replace with:

```tsx
{activeTab === "games" && (
  <OwnerGamesTab
    gameTypes={gameTypes}
    enabledIds={enabledIds}
    onToggle={toggleGame}
  />
)}
```

- [ ] **Step 3: Replace the member GamesPlaceholder call**

Find `{isMember && !isOwner && <GamesPlaceholder />}` and replace with:

```tsx
{isMember && !isOwner && (
  activeGame === "blackjack" && currentCasino ? (
    <Blackjack
      casinoId={currentCasino.id}
      balance={membership?.balance ?? 0}
      minBet={500}
      maxBet={100000}
      onExit={() => setActiveGame(null)}
    />
  ) : (
    <MemberGamesTab
      gameTypes={gameTypes.filter((g) => enabledIds.has(g.id))}
      onPlay={(id) => setActiveGame(id)}
    />
  )
)}
```

- [ ] **Step 4: Add the two presentational components**

Replace the existing `GamesPlaceholder` function with these (delete `GamesPlaceholder`):

```tsx
function OwnerGamesTab({
  gameTypes, enabledIds, onToggle,
}: {
  gameTypes: GameType[];
  enabledIds: Set<string>;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  if (gameTypes.length === 0)
    return <p className="text-muted-foreground text-sm">Loading games...</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {gameTypes.map((g) => {
        const on = enabledIds.has(g.id);
        return (
          <div key={g.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold">{g.name}</p>
              <p className="text-sm text-muted-foreground">{g.description}</p>
            </div>
            <Button variant={on ? "secondary" : "default"} size="sm" onClick={() => onToggle(g.id, on)}>
              {on ? "Enabled" : "Enable"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function MemberGamesTab({
  gameTypes, onPlay,
}: {
  gameTypes: GameType[];
  onPlay: (id: string) => void;
}) {
  if (gameTypes.length === 0)
    return (
      <div className="rounded-xl bg-card border border-border p-10 text-center text-muted-foreground">
        No games yet — check back after the owner enables them.
      </div>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {gameTypes.map((g) => (
        <button
          key={g.id}
          onClick={() => g.id === "blackjack" && onPlay(g.id)}
          disabled={g.id !== "blackjack"}
          className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary transition-colors disabled:opacity-50"
        >
          <p className="font-semibold">{g.name}</p>
          <p className="text-sm text-muted-foreground">{g.description}</p>
          <span className="text-xs text-primary mt-2 inline-block">
            {g.id === "blackjack" ? "Play now →" : "Coming soon"}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Verify the type-check + build**

Run: `npx tsc -b`
Expected: no errors (the now-unused `GamesPlaceholder` must be deleted, or `noUnusedLocals` fails).

- [ ] **Step 6: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "feat(blackjack): wire games tab — owner enable grid, member launch"
```

---

## Task 16: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full engine test suite**

Run: `npx vitest run`
Expected: all engine tests pass.

- [ ] **Step 2: Build the app**

Run: `npm run build`
Expected: clean build, no type errors.

- [ ] **Step 3: Manual play-through**

Run `npm run dev`. As an owner, open a casino → Games tab → Enable Blackjack. As a member (a second account that has joined), open the casino → Games → Play Blackjack. Verify:
- A hand deals; only one dealer card is visible.
- Hit/Stand/Double/Split/Insurance appear only when legal.
- Balance decreases on bet and updates on settle (realtime).
- A blackjack pays 3:2; a normal win pays 1:1; pushes refund.

- [ ] **Step 4: Confirm the shoe is never exposed**

In browser devtools → Network, inspect the `blackjack` function responses during `player_turn`. Confirm there is no `shoe` field and the dealer array has exactly one card.

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(blackjack): address verification findings"
```

---

## Self-Review Notes

- **Spec coverage:** server-authoritative logic (Tasks 4–10, 10/edge), hidden shoe/hole card (Tasks 9, 10, 16.4), 3:2 + S17 + peek + insurance + split/double/resplit (Tasks 4–7), owner enable UI (Task 15), member play UI (Tasks 14–15), transactions + balance (Task 10), realtime balance (existing `useBalance`, exercised in 16.3).
- **Bet bounds:** UI passes `minBet=500/maxBet=100000` matching the seeded `game_types` row; the edge function re-validates against `game_types` (authoritative).
- **Type consistency:** `RoundState`, `PlayerHand`, `Move`, `BlackjackState`, `sanitize(state, roundId, balance)`, `applyMove(state, move)`, `startRound({shoe, bet})` are used identically across engine, edge function, and client.
