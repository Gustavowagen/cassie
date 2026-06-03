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
