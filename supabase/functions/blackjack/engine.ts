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
