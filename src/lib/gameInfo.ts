export interface GameInfoEntry {
  title: string;
  description: string;
  rules?: string[];
}

export const GAME_INFO: Record<
  "dice" | "plinko" | "blackjack" | "roulette" | "mines" | "slots" | "crash" | "tumble" | "olympus",
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
  // Generic fallback only — olympusInfo() below builds the instance-specific
  // entry the game actually shows, for the same reason Tumble does: the
  // payouts listed are scaled by that machine's own house edge.
  olympus: {
    title: "Gates of Olympus",
    description:
      "A cascading 6×5 slot. A symbol pays when eight or more land anywhere on the board, winning symbols are struck away and new ones fall in — and multiplier orbs that land stay standing until the round ends, then multiply everything it paid.",
    rules: [
      "Open a specific machine's info panel for its exact payouts and house edge.",
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

// ----------------------------------------------------------------- olympus

import {
  FREE_SPINS_COUNT,
  MIN_MATCH,
  PAYTABLE,
  SYMBOLS,
  ORB_VALUES,
  edgeScale,
  freeSpinsCostMultiplier,
} from "./olympusEngine";

/** How the paytable panel names each symbol. */
const OLY_SYMBOL_NAMES: Record<string, string> = {
  bolt: "lightning bolt",
  coin: "gold coin",
  helmet: "helmet",
  chalice: "chalice",
  ruby: "red gem",
  amethyst: "purple gem",
  emerald: "green gem",
  sapphire: "blue gem",
};

/** Trims a scaled pay to something readable without pretending to precision. */
const olyPay = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Gates of Olympus's info panel, built for one instance.
 *
 * Every number here is read off the engine rather than written down, so the
 * panel cannot describe a game the server does not run — including the
 * payouts, which move with the machine's own house edge, and the price of a
 * feature buy, which is fixed by the maths rather than by an admin.
 */
export function olympusInfo(houseEdge: number, freeSpinsEnabled: boolean): GameInfoEntry {
  const scale = edgeScale(houseEdge);
  const pays = SYMBOLS.map((id) => {
    const [low, , high] = PAYTABLE[id];
    return `${OLY_SYMBOL_NAMES[id] ?? id} ${olyPay(low * scale)}×–${olyPay(high * scale)}×`;
  }).join(", ");

  return {
    title: "Gates of Olympus",
    description:
      "A 6×5 board where symbols pay by how many land anywhere on it — there are no paylines and position never matters. Winning symbols are struck away, the survivors fall, and fresh ones drop into the gaps; if the new board wins again it pays again, and the cascade runs until nothing qualifies.",
    rules: [
      `Any symbol pays when ${MIN_MATCH} or more of it land anywhere on the board.`,
      `The more that land, the better the rate: ${MIN_MATCH}–9, then 10–11, then 12 or more.`,
      "Symbols are judged independently, so more than one can pay on the same board — all of them pay, and all of them are struck away.",
      "Every cascade in a round pays, and the round's wins add together.",
      `Multiplier orbs (${ORB_VALUES.map((v) => `${v}×`).join(", ")}) drop in like any other symbol, but never count toward a match and never pay on their own. Unlike the symbols they are not struck away — every orb that lands stays standing for the rest of the round.`,
      "When the board finally settles, every orb still standing is added together and the total multiplies everything the round paid. A round that paid nothing collects no orbs at all.",
      `Payouts at this machine's ${(houseEdge * 100).toFixed(0)}% house edge: ${pays} (per ${MIN_MATCH}+ up to 12+).`,
      ...(freeSpinsEnabled
        ? [
            `The feature coin buys ${FREE_SPINS_COUNT} free spins for ${freeSpinsCostMultiplier()}× your chosen stake. Orbs land far more often during them, and — unlike the base game — the multiplier does NOT reset between spins: every orb collected is banked and stays banked for the rest of the batch.`,
            "The bank only pays out on a spin that lands an orb of its own, though. Land one and your win is multiplied by the whole bank, that orb included — a 5× with 20× banked pays 25×. Win with no orb on the board and the win is paid flat, and the bank waits for the next spin that does land one.",
            `The price is what the house edge is taken on, so a batch returns the same ${(
              (1 - houseEdge) *
              100
            ).toFixed(0)}% of its cost that a normal spin returns of its bet.`,
          ]
        : []),
    ],
  };
}
