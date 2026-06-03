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
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  const soft = aces > 0 && total <= 21;
  return { value: total, soft };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).value === 21;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards).value > 21;
}

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
      hand.payout = Math.floor(hand.bet * 2.5);
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

  state.insurancePayout = state.insuranceBet > 0 && dealerBJ ? state.insuranceBet * 3 : 0;
  state.status = "complete";
  return state;
}

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
    actions.push("double");
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
    cardValue(state.dealer[0]) === 11 &&
    state.hands.length === 1 &&
    state.activeHand === 0 &&
    hand.cards.length === 2
  ) {
    actions.push("insurance");
  }
  return actions;
}

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
    return state;
  }
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
      return applySplitOrInsurance(state, move);
  }
}

function applySplitOrInsurance(state: RoundState, move: Move): RoundState {
  if (move === "insurance") {
    state.insuranceBet = Math.floor(state.baseBet / 2);
    state.insuranceResolved = true;
    return resolveAcePeek(state);
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
  state.hands.splice(state.activeHand, 1, handA, handB);

  handA.cards.push(draw(state));
  handB.cards.push(draw(state));

  if (splittingAces) {
    handA.done = true;
    handB.done = true;
  }
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

  state.hands[0].cards.push(draw(state));
  state.dealer.push(draw(state));
  state.hands[0].cards.push(draw(state));
  state.dealer.push(draw(state));

  const upcard = state.dealer[0];
  const playerBJ = isBlackjack(state.hands[0].cards);

  if (cardValue(upcard) === 10 && dealerHasBlackjack(state)) {
    return settle(state);
  }
  if (playerBJ) {
    return settle(state);
  }
  return state;
}

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
