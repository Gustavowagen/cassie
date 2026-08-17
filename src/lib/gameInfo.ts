export interface GameInfoEntry {
  title: string;
  description: string;
  rules?: string[];
}

export const GAME_INFO: Record<
  "dice" | "plinko" | "blackjack" | "roulette" | "mines" | "slots" | "crash" | "tumble",
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
  // Generic fallback only — Slots.tsx builds an instance-specific
  // GameInfoEntry instead (board size and win rule vary per casino
  // configuration, so a single static description can't state exact
  // reel/row counts or thresholds without being wrong for most instances).
  slots: {
    title: "Slots",
    description:
      "A slot machine whose board size and win rule are configured per casino. Wins are counted either along the middle row or across the whole board, depending on setup.",
    rules: ["Open a specific slot machine's info panel for its exact board size, win rule, and thresholds."],
  },
  // Generic fallback only — Tumble.tsx builds an instance-specific
  // GameInfoEntry instead, because the payouts it lists are scaled by the
  // machine's own house edge and a static description would be wrong for
  // most instances.
  tumble: {
    title: "Tumble",
    description:
      "A cascading 5×6 slot. Symbols pay by how many land anywhere on the board, winning symbols pop, and fresh ones rain down — if the new board wins again, it pays again.",
    rules: [
      "Open a specific machine's info panel for its exact counts, payouts, and house edge.",
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
