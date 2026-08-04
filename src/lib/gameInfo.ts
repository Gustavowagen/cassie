export interface GameInfoEntry {
  title: string;
  description: string;
  rules?: string[];
}

export const GAME_INFO: Record<
  "dice" | "plinko" | "blackjack" | "roulette" | "mines" | "slots" | "crash",
  GameInfoEntry
> = {
  dice: {
    title: "Dice",
    description:
      "Pick a target number and bet on whether the roll lands under or over it. The server draws a random result, and the win chance you choose determines your payout multiplier.",
    rules: ["Lower win chance means a higher payout multiplier if you win."],
  },
  plinko: {
    title: "Plinko",
    description:
      "Drop a ball down a 12-row peg board after choosing a risk level. The board itself never changes — risk only changes how extreme the landing multipliers are.",
    rules: [
      "Low risk: smaller edges, a bigger safe middle.",
      "High risk: bigger edges, a smaller safe middle.",
    ],
  },
  blackjack: {
    title: "Blackjack",
    description:
      "Classic blackjack against the dealer. Beat the dealer's hand without going over 21.",
    rules: [
      "Dealer stands on all 17s, including soft 17.",
      "Blackjack (a natural 21) pays 3:2.",
      "Splitting requires an exact rank match — a King and a Queen are both worth 10 but are not a pair; King and King is.",
      "Up to 3 hands total from splitting (an initial split plus one resplit).",
      "Splitting aces deals one card to each hand and ends both immediately — even a resulting 21 does not pay the blackjack bonus.",
      "Double is allowed on any fresh two-card hand, including after a split, except split aces.",
      "Insurance is offered only when the dealer shows an ace, costs half your bet, and pays 2:1 if the dealer has blackjack.",
    ],
  },
  roulette: {
    title: "Roulette",
    description:
      "American wheel with 0 and 00 (38 pockets total). Place bets on individual numbers or broader outside bets.",
    rules: [
      "Straight (single number): 35:1",
      "Split (two numbers): 17:1",
      "Corner (four numbers): 8:1",
      "Dozens / columns: 2:1",
      "Red/black, even/odd, high/low: 1:1",
    ],
  },
  mines: {
    title: "Mines",
    description:
      "Choose how many mines (1-24) are hidden on a 5x5 grid. Each safe tile you reveal raises your multiplier; hitting a mine ends the round with a total loss.",
    rules: ["Cash out any time after revealing at least one safe tile."],
  },
  slots: {
    title: "Slots",
    description:
      "A 5-reel, 5-symbol slot machine. Depending on how this casino has it configured, wins are counted one of two ways.",
    rules: [
      "Single-row mode: 3 or more matching symbols anywhere on the middle row.",
      "Full-board mode: 7 or more matching cells anywhere across all 15 visible cells, with higher counts paying more.",
    ],
  },
  crash: {
    title: "Crash",
    description:
      "A multiplier climbs from 1x once the round starts. Cash out any time to win your bet times the current multiplier.",
    rules: [
      "The crash point is randomly predetermined and hidden.",
      "Missing it before it crashes loses the full bet.",
    ],
  },
};
