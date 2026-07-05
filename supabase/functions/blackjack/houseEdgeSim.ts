// One-off Monte Carlo simulation of the production blackjack engine to estimate
// house edge under basic strategy. Not part of the test suite — run manually:
//   node --experimental-strip-types supabase/functions/blackjack/houseEdgeSim.ts [rounds]
import {
  startRound,
  applyMove,
  legalActions,
  buildShoe,
  shuffle,
  cardValue,
  handValue,
  type RoundState,
  type PlayerHand,
  type Move,
  type Rng,
} from "./engine.ts";

function mulberry32(seed: number): Rng {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Basic strategy for 6-deck, dealer-stands-soft-17, double-after-split, resplit
// to 3 hands, no surrender, insurance always declined.

function shouldSplit(pairVal: number, up: number): boolean {
  switch (pairVal) {
    case 11: return true; // A,A
    case 2: case 3: return up >= 2 && up <= 7;
    case 4: return up === 5 || up === 6;
    case 5: return false;
    case 6: return up >= 2 && up <= 6;
    case 7: return up >= 2 && up <= 7;
    case 8: return true;
    case 9: return (up >= 2 && up <= 6) || up === 8 || up === 9;
    case 10: return false;
    default: return false;
  }
}

function hardMove(value: number, up: number, canDouble: boolean): Move {
  if (value <= 8) return "hit";
  if (value === 9) return canDouble && up >= 3 && up <= 6 ? "double" : "hit";
  if (value === 10) return canDouble && up >= 2 && up <= 9 ? "double" : "hit";
  if (value === 11) return canDouble ? "double" : "hit";
  if (value === 12) return up >= 4 && up <= 6 ? "stand" : "hit";
  if (value >= 13 && value <= 16) return up >= 2 && up <= 6 ? "stand" : "hit";
  return "stand";
}

function softMove(value: number, up: number, canDouble: boolean): Move {
  if (value <= 12) return "hit"; // unsplittable A,A edge case
  if (value === 13 || value === 14) return canDouble && (up === 5 || up === 6) ? "double" : "hit";
  if (value === 15 || value === 16) return canDouble && up >= 4 && up <= 6 ? "double" : "hit";
  if (value === 17) return canDouble && up >= 3 && up <= 6 ? "double" : "hit";
  if (value === 18) {
    if (canDouble && up >= 3 && up <= 6) return "double";
    if (up === 2 || up === 7 || up === 8) return "stand";
    return "hit";
  }
  return "stand"; // 19, 20, 21
}

function decide(hand: PlayerHand, up: number, legal: Move[]): Move {
  const canDouble = legal.includes("double");
  const canSplit = legal.includes("split");
  if (canSplit && hand.cards.length === 2 && shouldSplit(cardValue(hand.cards[0]), up)) {
    return "split";
  }
  const { value, soft } = handValue(hand.cards);
  const move = soft ? softMove(value, up, canDouble) : hardMove(value, up, canDouble);
  return legal.includes(move) ? move : "hit";
}

function playRound(rng: Rng): RoundState {
  let state = startRound({ shoe: shuffle(buildShoe(), rng), bet: 1 });
  while (state.status === "player_turn") {
    const legal = legalActions(state);
    const hand = state.hands[state.activeHand];
    const up = cardValue(state.dealer[0]);
    state = applyMove(state, decide(hand, up, legal));
  }
  return state;
}

const ROUNDS = Number(process.argv[2] ?? 1_000_000);
const SEED = Number(process.argv[3] ?? 0xc0ffee);
const rng = mulberry32(SEED);

let totalWagered = 0;
let totalReturned = 0;
let totalHands = 0;
let wins = 0, losses = 0, pushes = 0, blackjacks = 0, busts = 0;
let doubles = 0, splitEvents = 0;
let netSum = 0;
let netSumSq = 0;

const t0 = Date.now();
for (let i = 0; i < ROUNDS; i++) {
  const state = playRound(rng);

  let roundWagered = state.insuranceBet;
  let roundReturned = state.insurancePayout;
  for (const h of state.hands) {
    totalHands++;
    roundWagered += h.bet;
    roundReturned += h.payout ?? 0;
    if (h.doubled) doubles++;
    if (handValue(h.cards).value > 21) busts++;
    switch (h.outcome) {
      case "win": wins++; break;
      case "lose": losses++; break;
      case "push": pushes++; break;
      case "blackjack": blackjacks++; break;
    }
  }
  if (state.hands.length > 1) splitEvents += state.hands.length - 1;

  totalWagered += roundWagered;
  totalReturned += roundReturned;
  const net = roundReturned - roundWagered;
  netSum += net;
  netSumSq += net * net;
}
const elapsedMs = Date.now() - t0;

const rounds = ROUNDS;
const avgWagerPerRound = totalWagered / rounds;
const meanNet = netSum / rounds;
const variance = netSumSq / rounds - meanNet * meanNet;
const stdevNet = Math.sqrt(variance);
const seNet = stdevNet / Math.sqrt(rounds);
const houseEdge = -meanNet / avgWagerPerRound;
const houseEdgeSE = seNet / avgWagerPerRound;
const ci95 = 1.96 * houseEdgeSE;

console.log(JSON.stringify({
  rounds,
  totalHands,
  elapsedMs,
  roundsPerSec: Math.round((rounds / elapsedMs) * 1000),
  totalWagered,
  totalReturned,
  netPlayerResult: netSum,
  houseEdgePct: houseEdge * 100,
  houseEdgeCI95Pct: ci95 * 100,
  outcomes: { wins, losses, pushes, blackjacks, busts },
  doubles,
  splitEvents,
  avgWagerPerRound,
}, null, 2));
