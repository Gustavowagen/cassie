import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Minus, Plus, Sparkles, X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { GameInfoButton } from "../ui/GameInfoButton";
import { GameInfoPanel } from "../ui/GameInfoPanel";
import type { GameInfoEntry } from "../../lib/gameInfo";
import { formatChips } from "../../lib/utils";
import { playWinChime } from "../../lib/sound";
import { useTumble } from "../../hooks/useTumble";
import { getSlotsDesign } from "../../lib/slotsDesigns";
import { SlotSymbol, SlotsSkinStyles } from "./slotsSkin";
import type {
  SlotSymbolId,
  TumbleBoard,
  TumbleFreeSpinsResult,
  TumbleFreeSpinsSettings,
  TumbleRound,
  TumbleStep,
} from "../../types";

const ROWS = 5;
const COLS = 6;

// Mirrors supabase/functions/tumble/engine.ts's SYMBOLS — a local,
// dependency-free copy (same pattern as Slots/Dice/Roulette) used only to
// render the paytable. The server never trusts anything from here; it
// recomputes the whole round and its payout itself.
interface PaytableRow {
  id: SlotSymbolId;
  threshold: number;
  pay: [number, number, number];
  // Stated rather than derived from the threshold at render time, so the
  // panel can never drift into describing tiers the engine doesn't use.
  rangeLabel: string;
}
const PAYTABLE: PaytableRow[] = [
  { id: "dot", threshold: 15, pay: [0.25, 0.6, 1.5], rangeLabel: "15 · 16 · 17+" },
  { id: "square", threshold: 12, pay: [0.6, 1.5, 4], rangeLabel: "12 · 13 · 14+" },
  { id: "diamond", threshold: 11, pay: [1.2, 3, 8], rangeLabel: "11 · 12 · 13+" },
  { id: "star", threshold: 9, pay: [2.5, 6.5, 18], rangeLabel: "9 · 10 · 11+" },
  { id: "seven", threshold: 8, pay: [6, 16, 50], rangeLabel: "8 · 9 · 10+" },
];
// Mirrors the engine's BASELINE_RTP so displayed pays match what the server
// actually pays at this instance's edge.
const BASELINE_RTP = 1.4081232249959508;
const SYMBOL_IDS: SlotSymbolId[] = ["dot", "square", "diamond", "star", "seven"];

// Animation beats, in ms. Kept here (not in CSS alone) because the replay
// loop awaits them, and the balance may only settle once the whole reveal
// has finished.
const DROP_MS = 520;
// Columns don't drop together — the leftmost lands first and each column to
// its right starts this much later, so a refill sweeps across the board.
const COL_STAGGER_MS = 80;
// What the replay loop actually waits on: the last column starts latest, so
// the whole rain-down is over only after its own drop finishes. Kept under a
// second end to end.
const FALL_MS = DROP_MS + (COLS - 1) * COL_STAGGER_MS;
const HIGHLIGHT_MS = 760;
// A step with an X on the board gets this much longer to highlight instead
// of HIGHLIGHT_MS — the plain win flash reads fine at 760ms, but a multiplier
// hit needs enough time to actually register before it pops.
const X_HIGHLIGHT_MS = 1500;
const POP_MS = 330;
const BANNER_MS = 1500;
// When a round collected an X, the win banner reveals in two beats instead
// of jumping straight to the final number: the raw win first, held long
// enough to actually read it, then the multiplier badge flies up and merges
// into it (see COLLIDE_FLY_MS) — so "50" reads as "10, times 5" rather than
// an arbitrary bigger number appearing out of nowhere.
const INITIAL_WIN_REVEAL_MS = 900;
// How long the ×N badge takes to fly from its spot below the board up into
// the win banner and land, at which point the banner's number updates to
// the true final payout.
const COLLIDE_FLY_MS = 480;
// The gap between rounds in a purchased free-spins batch. A round that paid
// already gets a full BANNER_MS pause so its own win banner has a beat to be
// seen (see handleBuyFreeSpins). A round that didn't hit had no pause at all
// before this — the next spin started the instant it settled — so give it a
// smaller fixed gap too, just enough that a run of misses doesn't blur past
// with zero breathing room between them.
const FREE_SPIN_MISS_GAP_MS = 500;
// How long the end-of-batch total-win summary stays up once the last round's
// own animation (and win banner, if it had one) has finished. Matches
// sl-win-banner's own fade-in/hold/fade-out animation length (see
// SlotsSkinStyles) since the summary reuses that same banner treatment.
const FREE_SPINS_SUMMARY_MS = 2400;
// An X that's collected doesn't just glow in place — it launches out of its
// cell and flies to the running-multiplier counter, landing there is what
// actually ticks the counter up (see flyXToCounter below). Multiple X's in
// the same step launch this far apart so the counter visibly ticks once per
// arrival instead of jumping all at once.
const FLY_STAGGER_MS = 130;
const FLY_MS = 520;
// Extra headroom after the last flyer lands before the step is allowed to
// move on to popping/falling, so the counter's final tick is never cut off.
const FLY_LAND_BUFFER_MS = 250;
// How long the "free spins bought" takeover holds the board before the first
// purchased round starts falling. Also the floor the buy request is held to
// (see handleBuyFreeSpins) so a fast server response can't cut the reveal.
const FS_INTRO_MS = 2200;

// The ladder the special-feature panel's -/+ buttons step through. It prices
// the WHOLE BATCH, not one spin — the player picks what the purchase costs
// and the stake per spin falls out of it (cost / spinsPerPurchase), which is
// how the engine reads it too (see handleBuyFreeSpins in
// supabase/functions/tumble/index.ts). A 1 / 2.5 / 5 progression per decade,
// from FREE_SPINS_MIN_COST_FLOOR up to FREE_SPINS_MAX_COST_CEILING:
// deliberately coarse — a handful of clicks has to be able to cross eight
// orders of magnitude — while still leaving three stops in every decade. The
// instance's own configured min/max narrows it at both ends, see
// costLadderFor.
const COST_LADDER = [
  0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000,
  10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000,
  5_000_000, 10_000_000,
];

// The ladder narrowed to one instance's configured free-spin cost range. The
// configured min and max are always themselves stops — an admin who set
// 40..600 gets 40 · 50 · 100 · 250 · 500 · 600, so both ends of what they
// allowed stay reachable even though neither is on the ladder proper.
function costLadderFor(min: number, max: number): number[] {
  const lo = roundMoney(Math.max(min, COST_LADDER[0]));
  const hi = roundMoney(Math.max(lo, Math.min(max, COST_LADDER[COST_LADDER.length - 1])));
  if (hi <= lo) return [lo];
  return [lo, ...COST_LADDER.filter((v) => v > lo && v < hi), hi];
}

// Ladder/stake display. formatChips's fixed 4 decimals are pure noise on a
// ladder whose stops are whole numbers or one or two decimals — "0.1000" and
// "10,000,000.0000" both read worse than the number actually is. Same
// thousands grouping, but only the decimals the number really has.
function formatStake(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

// The ladder stop one step up (dir 1) or down (dir -1) from `current`,
// clamped at both ends. `current` is always already a stop, but the nearest
// -stop search keeps this correct if the instance's range (and so the
// ladder) changes underneath a stake the player already picked.
function stepLadder(current: number, dir: 1 | -1, ladder: number[]): number {
  let index = 0;
  let closest = Infinity;
  ladder.forEach((v, i) => {
    const d = Math.abs(v - current);
    if (d < closest) {
      closest = d;
      index = i;
    }
  });
  return ladder[Math.min(ladder.length - 1, Math.max(0, index + dir))];
}

function edgeScale(houseEdge: number): number {
  return (1 - houseEdge) / BASELINE_RTP;
}
function displayX(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
// Mirrors supabase/functions/tumble/engine.ts's payoutFor — used to credit
// each round's own payout locally as it finishes animating (see
// playOutRound below). Never used to decide an outcome, only to read one
// already-decided by the server.
function payoutFor(round: TumbleRound, bet: number): number {
  return roundMoney(bet * round.totalMultiplier);
}
function randomSymbolId(): SlotSymbolId {
  return SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
}
// What a casino_games row's settings.freeSpins can actually look like: the
// current cost-based shape, or a config saved before 2026-08-30 carrying
// minBet/maxBet (which bounded the per-spin stake back then). Every field is
// optional because this is raw jsonb — nothing has validated it yet.
type StoredFreeSpins = Partial<TumbleFreeSpinsSettings & { minBet: number; maxBet: number }>;

// Normalises that raw shape into the one the component uses, reading the
// legacy names as costs. Mirrors resolveFreeSpinsSettings in
// supabase/functions/tumble/engine.ts, which is the authority — this only
// decides what the panel offers, never what a purchase is allowed to cost.
function resolveFreeSpins(raw: StoredFreeSpins | undefined): TumbleFreeSpinsSettings {
  return {
    enabled: raw?.enabled === true,
    minCost: raw?.minCost ?? raw?.minBet ?? DEFAULT_FREE_SPINS.minCost,
    maxCost: raw?.maxCost ?? raw?.maxBet ?? DEFAULT_FREE_SPINS.maxCost,
    spinsPerPurchase: raw?.spinsPerPurchase ?? DEFAULT_FREE_SPINS.spinsPerPurchase,
  };
}

// The floor a row with nothing usable stored falls back to.
const DEFAULT_FREE_SPINS: TumbleFreeSpinsSettings = {
  enabled: false,
  minCost: 0.1,
  maxCost: 1000,
  spinsPerPurchase: 10,
};
function randomBoard(): TumbleBoard {
  return Array.from({ length: COLS }, () => Array.from({ length: ROWS }, randomSymbolId));
}
const cellKey = (col: number, row: number) => `${col}:${row}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Forces a real, painted "settled" frame before the caller continues. Without
// this, clearing `falling` and lighting the next win happen back to back with
// no yield between them, so React (and the browser) can fold both into a
// single commit/paint — the next win's highlight then lands in the same
// frame the fall is still resolving in, instead of only once the board is
// genuinely at rest and visible. Double rAF: the first callback fires before
// the NEXT paint (so the settled frame may not have painted yet), the second
// fires after that paint has happened.
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// How many cells each column loses on this step. The engine refills a column
// from the top, so the next board's fresh cells are exactly rows
// [0, poppedInColumn) — which is what drives the rain-down animation. Every X
// currently on the board pops alongside the winning cells (see engine.ts's
// tumble()), so it counts here too.
function poppedPerColumn(step: TumbleStep): number[] {
  const counts = Array<number>(COLS).fill(0);
  for (const win of step.wins) for (const p of win.positions) counts[p.col]++;
  step.board.forEach((col, c) =>
    col.forEach((cell) => {
      if (typeof cell !== "string") counts[c]++;
    })
  );
  return counts;
}

// Positions (and values) of every X cell currently on the board, for
// lighting/popping them alongside the step's winning symbols and for flying
// each one's value to the counter individually.
function xPositions(board: TumbleBoard): { col: number; row: number; value: number }[] {
  const out: { col: number; row: number; value: number }[] = [];
  board.forEach((col, c) =>
    col.forEach((cell, r) => {
      if (typeof cell !== "string") out.push({ col: c, row: r, value: cell.value });
    })
  );
  return out;
}

// One X in flight from its cell to the running-multiplier counter. x/y and
// dx/dy are real viewport pixels read off the DOM at launch time (see
// flyXToCounter), not layout guesses — the board's cell size is a responsive
// clamp() and the counter sits in an unrelated part of the layout, so there's
// no fixed offset between them to hard-code.
interface FlyingX {
  id: number;
  value: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  delayMs: number;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// The ×N multiplier badge's one-time flight from below the board up into the
// win banner, at the end of a round that collected an X — see COLLIDE_FLY_MS.
// x/y and dx/dy are real viewport pixels read off the DOM at launch time,
// same reasoning as FlyingX above.
interface CollideFlight {
  value: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

interface Props {
  casinoId: string;
  gameId: string;
  houseEdge: number;
  design?: string;
  freeSpins?: StoredFreeSpins;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Tumble({
  casinoId,
  gameId,
  houseEdge,
  design,
  freeSpins: storedFreeSpins,
  balance: initialBalance,
  minBet,
  maxBet,
  onExit,
}: Props) {
  const freeSpins = resolveFreeSpins(storedFreeSpins);
  const { loading, spin, buyFreeSpins } = useTumble(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  // The special-feature buy panel, and the takeover that plays over the board
  // once a batch has actually been bought (see FS_INTRO_MS).
  const [showFeatureBuy, setShowFeatureBuy] = useState(false);
  const [featureIntro, setFeatureIntro] = useState<{ spins: number } | null>(null);
  // The batch price is picked with -/+ only, so it's a ladder stop rather
  // than free text — there's no invalid value to type and nothing to parse.
  const [freeSpinCostPick, setFreeSpinCostPick] = useState(
    () => costLadderFor(freeSpins.minCost, freeSpins.maxCost)[0]
  );
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState<{ index: number; total: number } | null>(null);
  // The batch's running total win, ticking up as each round settles. Non-null
  // for exactly as long as a batch is playing — including at 0, so the
  // counter is there to watch from the first spin rather than appearing out
  // of nowhere on the first hit. Deliberately NOT touched by resetRound,
  // which runs per round inside the batch.
  const [freeSpinsTotal, setFreeSpinsTotal] = useState<number | null>(null);
  const [freeSpinsSummary, setFreeSpinsSummary] = useState<{ total: number } | null>(null);

  const [board, setBoard] = useState<TumbleBoard>(randomBoard);
  const [lit, setLit] = useState<Set<string>>(() => new Set());
  // Cells currently showing the distinct "X collected" glow — separate from
  // `lit` (which is the plain win-symbol highlight) so an X hit always gets
  // its own unmistakable treatment, including the trailing sweep in replay()
  // below where there's no winning symbol lit alongside it at all.
  const [xHit, setXHit] = useState<Set<string>>(() => new Set());
  const [popping, setPopping] = useState<Set<string>>(() => new Set());
  const [falling, setFalling] = useState<Set<string>>(() => new Set());
  const [flyers, setFlyers] = useState<FlyingX[]>([]);
  const [runningPay, setRunningPay] = useState(0);
  const [runningMultiplier, setRunningMultiplier] = useState(0);
  const [tumbleCount, setTumbleCount] = useState(0);
  const [settled, setSettled] = useState<{ payout: number; multiplier: number } | null>(null);
  // Set only while the ×N badge is mid-flight into the win banner (see
  // playOutRound) — a separate element from `flyers` above since this one
  // flies from the multiplier badge to the banner, not from a cell to the
  // badge, and there's ever only one in flight at a time.
  const [collideFlight, setCollideFlight] = useState<CollideFlight | null>(null);
  const [animating, setAnimating] = useState(false);

  const activeDesign = useMemo(() => getSlotsDesign(design), [design]);
  const scale = useMemo(() => edgeScale(houseEdge), [houseEdge]);

  // Cancels an in-flight replay when the component unmounts, so timers never
  // write to a dead component.
  const runId = useRef(0);
  useEffect(() => {
    return () => {
      runId.current++;
    };
  }, []);

  // The game's own Modal is dismissible={false}, so Escape is unbound while
  // Tumble is open — the feature panel takes it for itself while it's up.
  useEffect(() => {
    if (!showFeatureBuy) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowFeatureBuy(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showFeatureBuy]);

  // DOM handles for measuring real on-screen positions — a flying X's start
  // and end points depend on the board's responsive cell size and the
  // counter's actual layout position, neither of which can be computed from
  // props/state alone.
  const boardRef = useRef<HTMLDivElement>(null);
  const multBadgeRef = useRef<HTMLSpanElement>(null);
  const winBannerRef = useRef<HTMLDivElement>(null);
  const flyIdRef = useRef(0);

  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;
  const costLadder = useMemo(
    () => costLadderFor(freeSpins.minCost, freeSpins.maxCost),
    [freeSpins.minCost, freeSpins.maxCost]
  );
  // Clamped rather than stored clamped, so a price the player already picked
  // stays valid if an admin narrows the instance's range mid-session.
  const freeSpinCost = Math.min(Math.max(freeSpinCostPick, costLadder[0]), costLadder[costLadder.length - 1]);
  // What that price buys per spin — derived, never picked. Left unrounded to
  // match the server, which divides the charged price by the spin count
  // exactly (see handleBuyFreeSpins in supabase/functions/tumble/index.ts);
  // only its display is rounded.
  const freeSpinBet = freeSpinCost / freeSpins.spinsPerPurchase;
  const canStakeDown = freeSpinCost > costLadder[0];
  const canStakeUp = freeSpinCost < costLadder[costLadder.length - 1];
  // The price itself can't be out of range (it only ever comes off the
  // ladder), so affording the batch is the only thing left to check.
  const freeSpinBetValid = freeSpins.enabled && freeSpinCost > 0 && freeSpinCost <= localBalance;
  const busy = loading || animating;

  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  function stepFreeSpinCost(dir: 1 | -1) {
    setFreeSpinCostPick(stepLadder(freeSpinCost, dir, costLadder));
  }

  function resetRound() {
    setLit(new Set());
    setXHit(new Set());
    setPopping(new Set());
    setFalling(new Set());
    setFlyers([]);
    setCollideFlight(null);
    setRunningPay(0);
    setRunningMultiplier(0);
    setTumbleCount(0);
    setSettled(null);
    setFreeSpinsSummary(null);
  }

  // Launches one flying element per collected X, from its cell's real screen
  // position to the counter's, staggered so each lands (and ticks the
  // counter up) separately. Fire-and-forget from the caller's perspective —
  // replay() waits out its own step timing independently, sized to always
  // cover the full staggered flight below (see FLY_LAND_BUFFER_MS).
  function flyXToCounter(xPos: { col: number; row: number; value: number }[], token: number) {
    const boardEl = boardRef.current;
    const badgeEl = multBadgeRef.current;
    if (!boardEl || !badgeEl || xPos.length === 0) return;
    const badgeCenter = rectCenter(badgeEl.getBoundingClientRect());

    xPos.forEach((p, i) => {
      const cellEl = boardEl.querySelector<HTMLElement>(`[data-cell-key="${cellKey(p.col, p.row)}"]`);
      if (!cellEl) return;
      const start = rectCenter(cellEl.getBoundingClientRect());
      const delayMs = i * FLY_STAGGER_MS;
      const id = ++flyIdRef.current;
      setFlyers((prev) => [
        ...prev,
        { id, value: p.value, x: start.x, y: start.y, dx: badgeCenter.x - start.x, dy: badgeCenter.y - start.y, delayMs },
      ]);
      setTimeout(() => {
        if (runId.current !== token) return;
        setFlyers((prev) => prev.filter((f) => f.id !== id));
        setRunningMultiplier((m) => roundMoney(m + p.value));
      }, delayMs + FLY_MS);
    });
  }

  // How long a step must wait for its X's to finish flying (0 if it has
  // none) before it's safe to pop/fall onward.
  function xFlightWaitMs(count: number): number {
    if (count === 0) return 0;
    return (count - 1) * FLY_STAGGER_MS + FLY_MS + FLY_LAND_BUFFER_MS;
  }

  // Replays the server's already-decided round as an animation. Nothing here
  // computes an outcome — every board, win, X and pay comes from the
  // response. `bet` is only used to turn the engine's ×-multiplier pay into
  // the chip amount shown live next to the running ×N counter (see
  // runningPay below) — it must match whatever bet actually bought this
  // round (manual spin or a free-spin round's own bet), not necessarily the
  // bet currently sitting in the input.
  async function replay(round: TumbleRound, bet: number, token: number) {
    const alive = () => runId.current === token;

    // Opening board rains in from the top.
    const opening = round.steps[0]?.board ?? round.finalBoard;
    setBoard(opening);
    setFalling(new Set(opening.flatMap((_, c) => opening[c].map((_, r) => cellKey(c, r)))));
    await sleep(FALL_MS);
    if (!alive()) return;
    setFalling(new Set());
    // Let the settled, unlit board actually paint before the first
    // highlight — otherwise React can batch "falling cleared" and "win lit"
    // into the same commit, so the highlight can land before the fall has
    // visibly finished (see nextFrame's comment above).
    await nextFrame();
    if (!alive()) return;

    let paid = 0;

    for (let i = 0; i < round.steps.length; i++) {
      const step = round.steps[i];
      const winPositions = step.wins.flatMap((w) => w.positions.map((p) => cellKey(p.col, p.row)));
      const xPosDetailed = xPositions(step.board);
      const xPos = xPosDetailed.map((p) => cellKey(p.col, p.row));

      // 1. Light up every winning cell; any X riding along gets its own,
      //    slower, unmistakable "collected" glow (see .tm-x-hit) and launches
      //    toward the counter — landing there (not this moment) is what
      //    actually ticks the running multiplier up, see flyXToCounter.
      setLit(new Set(winPositions));
      setXHit(new Set(xPos));
      paid = roundMoney(paid + step.pay);
      // Shown as a chip amount, not the raw ×-multiplier, so it always reads
      // as the same win the banner (settled.payout) will show — see the
      // comment on runningPay's render below.
      setRunningPay(roundMoney(bet * paid));
      setTumbleCount(i);
      flyXToCounter(xPosDetailed, token);
      const highlightMs = xPos.length > 0 ? Math.max(X_HIGHLIGHT_MS, xFlightWaitMs(xPos.length)) : HIGHLIGHT_MS;
      await sleep(highlightMs);
      if (!alive()) return;

      // 2. Winning cells and any X pop together.
      setPopping(new Set([...winPositions, ...xPos]));
      await sleep(POP_MS);
      if (!alive()) return;
      setLit(new Set());
      setXHit(new Set());
      setPopping(new Set());

      // 3. Survivors fall and fresh symbols rain into the gaps.
      const nextBoard = round.steps[i + 1]?.board ?? round.finalBoard;
      const dropped = poppedPerColumn(step);
      setBoard(nextBoard);
      setFalling(
        new Set(
          dropped.flatMap((n, c) => Array.from({ length: n }, (_, r) => cellKey(c, r)))
        )
      );
      await sleep(FALL_MS);
      if (!alive()) return;
      setFalling(new Set());
      // Same reasoning as the opening board: force the settled frame to
      // paint before the next step's win (if any) gets highlighted, so a
      // second-tumble win never flashes on while its shapes are still
      // visibly mid-fall.
      await nextFrame();
      if (!alive()) return;
    }

    // A winning tumble's own refill can drop a fresh X with no further win to
    // sweep it up as a step — the engine still counts it (see playRound in
    // engine.ts), so give it the same collected glow here before the round
    // settles. Nothing pops: this really is the resting board the player
    // keeps looking at, so the X stays put once collected.
    if (round.steps.length > 0) {
      const trailingDetailed = xPositions(round.finalBoard);
      const trailingKeys = trailingDetailed.map((p) => cellKey(p.col, p.row));
      if (trailingKeys.length > 0) {
        setXHit(new Set(trailingKeys));
        flyXToCounter(trailingDetailed, token);
        await sleep(Math.max(X_HIGHLIGHT_MS, xFlightWaitMs(trailingDetailed.length)));
        if (!alive()) return;
        setXHit(new Set());
      }
    }
  }

  // Plays one already-resolved round's cascade animation, then credits that
  // round's own payout into local balance and shows its win banner — the
  // shared per-round contract a manual spin (below) and each round of a
  // purchased free-spin batch (handleBuyFreeSpins) both use. Nothing here
  // computes an outcome; `round` and `bet` are already decided server-side.
  // Returns this round's payout (0 if it didn't pay) so a caller looping
  // over multiple rounds — handleBuyFreeSpins — can tell whether a banner
  // was actually shown and needs a beat to be seen before moving on.
  async function playOutRound(round: TumbleRound, bet: number, token: number): Promise<number> {
    resetRound();
    await replay(round, bet, token);
    if (runId.current !== token) return 0;

    const payout = payoutFor(round, bet);
    if (payout > 0) {
      // A round that swept up an X reveals in two beats instead of jumping
      // straight to the final number: the raw win first (what basePay alone
      // is worth), held long enough to read, then the ×N badge flies up from
      // below the board and merges into it — see INITIAL_WIN_REVEAL_MS and
      // COLLIDE_FLY_MS. A round with no X has nothing to collide with, so it
      // keeps the single-step reveal.
      if (round.multiplier > 1) {
        const initialWin = roundMoney(bet * round.basePay);
        setSettled({ payout: initialWin, multiplier: 1 });
        await sleep(INITIAL_WIN_REVEAL_MS);
        if (runId.current !== token) return 0;

        const badgeEl = multBadgeRef.current;
        const bannerEl = winBannerRef.current;
        if (badgeEl && bannerEl) {
          const start = rectCenter(badgeEl.getBoundingClientRect());
          const end = rectCenter(bannerEl.getBoundingClientRect());
          setCollideFlight({ value: round.multiplier, x: start.x, y: start.y, dx: end.x - start.x, dy: end.y - start.y });
        }
        await sleep(COLLIDE_FLY_MS);
        if (runId.current !== token) return 0;
        setCollideFlight(null);
        // Consumed into the banner it just landed on — clearing it here
        // (rather than waiting for the next resetRound) hides the badge the
        // instant the merge lands instead of leaving a stale "×N" sitting
        // below the board next to the now-combined total.
        setRunningMultiplier(0);
        setSettled({ payout, multiplier: round.multiplier });
      } else {
        setSettled({ payout, multiplier: round.multiplier });
      }

      setLocalBalance((b) => roundMoney(b + payout));
      playWinChime();
      setTimeout(() => {
        if (runId.current === token) setSettled(null);
      }, BANNER_MS + 400);
    }
    return payout;
  }

  async function handleSpin() {
    if (!betValid || busy) return;
    setFormError(null);
    resetRound();
    setAnimating(true);

    const token = ++runId.current;
    // The outcome is already decided when the bet is placed but revealed
    // through the cascade, so the bet leaves the balance immediately and the
    // server's authoritative balance is only applied once the reveal ends —
    // otherwise the balance would spoil the result mid-animation.
    setLocalBalance((b) => roundMoney(b - bet));

    let result;
    try {
      result = await spin(bet);
    } catch (err) {
      if (runId.current === token) {
        setLocalBalance((b) => roundMoney(b + bet)); // roll the deduction back
        setFormError(err instanceof Error ? err.message : "Failed to place bet");
        setAnimating(false);
      }
      return;
    }
    if (runId.current !== token) return;

    await playOutRound(result.round, bet, token);
    if (runId.current !== token) return;

    setLocalBalance(result.balance);
    setAnimating(false);
  }

  async function handleBuyFreeSpins() {
    if (!freeSpinBetValid || busy) return;
    setFormError(null);
    setShowFeatureBuy(false);
    resetRound();
    setAnimating(true);

    const token = ++runId.current;
    const cost = freeSpinCost;
    // Same "deduct before the reveal" rule as a manual spin, extended to
    // cover the whole prepaid batch at once — the balance must never spoil
    // any individual spin's outcome ahead of that spin's own animation.
    setLocalBalance((b) => roundMoney(b - cost));

    // The purchase takes over the board immediately, so buying reads as a
    // real event on the machine rather than a panel that just closed. It
    // plays while the request is still in flight and is held to its full
    // FS_INTRO_MS below however fast the server answers, so the batch never
    // starts falling before the player has seen what they bought.
    const introStart = Date.now();
    setFeatureIntro({ spins: freeSpins.spinsPerPurchase });
    setFreeSpinsTotal(0);
    // Below the md breakpoint the controls stack above the board, so the buy
    // button and the board it plays on can't both be on screen — bring the
    // board to the player, otherwise the reveal (and the batch behind it)
    // happens somewhere they aren't looking.
    boardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

    let result: TumbleFreeSpinsResult;
    try {
      result = await buyFreeSpins(freeSpinCost);
    } catch (err) {
      if (runId.current === token) {
        setFeatureIntro(null);
        setFreeSpinsTotal(null);
        setLocalBalance((b) => roundMoney(b + cost)); // roll the deduction back
        setFormError(err instanceof Error ? err.message : "Failed to buy free spins");
        setAnimating(false);
      }
      return;
    }
    if (runId.current !== token) return;

    await sleep(Math.max(0, FS_INTRO_MS - (Date.now() - introStart)));
    if (runId.current !== token) return;
    setFeatureIntro(null);

    let totalWin = 0;
    for (let i = 0; i < result.rounds.length; i++) {
      setFreeSpinsRemaining({ index: i + 1, total: result.rounds.length });
      const payout = await playOutRound(result.rounds[i], result.bet, token);
      if (runId.current !== token) return;
      totalWin = roundMoney(totalWin + payout);
      // playOutRound has just credited this round's payout and put its win
      // banner up, so the counter ticks on the same beat the round pays.
      setFreeSpinsTotal(totalWin);

      // Give a paid round's win banner an actual beat on screen before the
      // next round's playOutRound wipes it via resetRound() — otherwise
      // React coalesces the two state updates and the banner never paints.
      // A round that didn't pay has no banner to protect, but still gets a
      // short gap so a run of misses doesn't blur past with no pacing at all.
      const hasNext = i + 1 < result.rounds.length;
      if (hasNext) {
        await sleep(payout > 0 ? BANNER_MS : FREE_SPIN_MISS_GAP_MS);
        if (runId.current !== token) return;
      }
    }

    // Let the final round's own win banner (if it had one) hold its moment —
    // playOutRound schedules its own dismissal — before swapping it for the
    // batch's total-win summary. A batch that never paid has nothing to sum
    // up, so it skips straight to clearing (same "no banner on a loss" rule
    // as everywhere else).
    if (totalWin > 0) {
      await sleep(BANNER_MS);
      if (runId.current !== token) return;
      // The last round's own win banner (if it had one) dismisses itself on
      // its own timeout — clear it explicitly rather than racing it, so the
      // two banners never render on top of each other.
      setSettled(null);
      setFreeSpinsSummary({ total: totalWin });
      await sleep(FREE_SPINS_SUMMARY_MS);
      if (runId.current !== token) return;
      setFreeSpinsSummary(null);
    }

    setFreeSpinsRemaining(null);
    setFreeSpinsTotal(null);
    setLocalBalance(result.balance);
    setAnimating(false);
  }

  const tumbleInfo: GameInfoEntry = useMemo(
    () => ({
      title: "Tumble",
      description:
        "A 5×6 board where symbols pay by how many land anywhere on the board — there are no paylines. Winning symbols pop, the survivors fall, and fresh symbols rain into the gaps. If the new board wins again it pays again, and the cascade keeps going until nothing qualifies.",
      rules: [
        "Every symbol has its own count to hit: " +
          PAYTABLE.map((p) => `${p.threshold}× ${p.id}`).join(", ") + ".",
        "A rarer symbol needs fewer of itself to pay, but still lands a winning count less often than a commoner one.",
        "Symbols are judged independently, so several can pay on the same board — all of them pay, and all of them pop.",
        "Every tumble in a round pays, and the round's wins add together.",
        "A ×2–×25 multiplier symbol can drop into any cell, just like the other symbols. Whenever a tumble pays, every one of these currently on the board is swept up and its value added to the round's running multiplier — several on the same tumble add together (a ×10 and a ×2 combine into ×12). It's the only way to multiply a win; it never pays on its own.",
        `This machine's house edge is ${(houseEdge * 100).toFixed(0)}%, already applied to the payouts shown.`,
        ...(freeSpins.enabled
          ? [
              `Buy Special Feature opens the feature panel, where a batch of ${freeSpins.spinsPerPurchase} free spins can be bought for a total price you set with − and + between ${formatStake(
                freeSpins.minCost
              )} and ${formatStake(freeSpins.maxCost)} chips. That price divided by ${freeSpins.spinsPerPurchase} is the stake each spin plays for, and every spin plays out with the exact same odds as a normal spin.`,
            ]
          : []),
      ],
    }),
    // Depends on the resolved values, not the object — resolveFreeSpins
    // returns a fresh one every render.
    [houseEdge, freeSpins.enabled, freeSpins.minCost, freeSpins.maxCost, freeSpins.spinsPerPurchase]
  );

  // Hidden the instant the badge launches into the win banner (not only once
  // it lands and runningMultiplier resets) so there's never a moment where
  // the same value is visible both sitting below the board and mid-flight.
  const showMultiplier = runningMultiplier > 0 && !collideFlight;

  return (
    <div
      className="relative bg-card rounded-2xl overflow-hidden flex flex-col h-screen h-[var(--app-vvh,100dvh)] sm:h-[min(92vh,800px)]"
      style={{ width: "min(96vw, 1360px)" }}
    >
      <SlotsSkinStyles />
      <TumbleStyles />
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Tumble · {activeDesign.name}</p>
          <p className="text-xs text-muted-foreground">Balance: {formatChips(localBalance)} chips</p>
        </div>
        <div className="flex items-center gap-3">
          <BackdropToggleButton />
          <MuteButton />
          <GameInfoButton active={showInfo} onClick={() => setShowInfo((v) => !v)} />
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
            Exit
          </button>
        </div>
      </div>

      {showInfo ? (
        <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
          <GameInfoPanel info={tumbleInfo} onBack={() => setShowInfo(false)} />
        </div>
      ) : (
        <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-auto overscroll-contain">
          <div className="flex flex-col gap-3 p-4 md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border">
            <div>
              <label className="text-xs text-muted-foreground">Bet Amount</label>
              <input
                type="number"
                min={0}
                value={betText}
                onChange={(e) => setBetText(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => adjustBet(0.5)}
                  disabled={busy}
                  className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
                >
                  ½
                </button>
                <button
                  type="button"
                  onClick={() => adjustBet(2)}
                  disabled={busy}
                  className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
                >
                  2×
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Min {formatChips(minBet)} · Max {formatChips(maxBet)}
              </p>
            </div>

            <Button onClick={handleSpin} disabled={!betValid || busy} className="w-full">
              {busy ? "Spinning…" : "Spin"}
            </Button>
            {formError && <p className="text-xs text-destructive">{formError}</p>}

            {freeSpins.enabled && (
              <div className="pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowFeatureBuy(true)}
                  disabled={busy}
                  className="tm-feature-cta w-full"
                >
                  <Sparkles className="h-4 w-4 shrink-0" />
                  Buy Special Feature
                </button>
              </div>
            )}

            <div className="mt-1">
              <p className="text-xs font-semibold text-muted-foreground">
                Paytable (count · count · count+)
              </p>
              <div className="mt-2 space-y-1.5">
                {PAYTABLE.map((row) => (
                  <div key={row.id} className="flex items-center gap-2 text-xs">
                    <span className="sl-sym-mini">
                      <SlotSymbol design={activeDesign} id={row.id} />
                    </span>
                    <span className="w-24 shrink-0 text-muted-foreground">{row.rangeLabel}</span>
                    <span className="ml-auto font-semibold tabular-nums">
                      {row.pay.map((p) => `${displayX(p * scale)}×`).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Counts are cells anywhere on the board. House edge {(houseEdge * 100).toFixed(0)}%.
              </p>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-3 p-4">
            <div ref={boardRef} className={`tm-board sl-reels-wrap ${activeDesign.themeClass}`}>
              <div className="tm-grid">
                {board.map((col, c) => (
                  <div className="tm-col" key={c}>
                    {col.map((cell, r) => {
                      const key = cellKey(c, r);
                      const isXHit = xHit.has(key) && typeof cell !== "string";
                      const classes = [
                        "sl-cell",
                        "tm-cell",
                        lit.has(key) ? "sl-lit" : "",
                        isXHit ? "tm-x-hit" : "",
                        popping.has(key) ? "tm-pop" : "",
                        falling.has(key) ? "tm-fall" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <div
                          className={classes}
                          key={r}
                          data-cell-key={key}
                          style={{ "--fall-row": r, "--fall-col": c } as CSSProperties}
                        >
                          {typeof cell === "string" ? (
                            <SlotSymbol design={activeDesign} id={cell} />
                          ) : (
                            <span className="tm-x-sym">×{cell.value}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {settled && (
                <div ref={winBannerRef} className="sl-win-banner">
                  <div className="sl-win-label">
                    {settled.multiplier > 1 ? `WIN ×${settled.multiplier}` : "WIN"}
                  </div>
                  {/* Keyed by payout so the element remounts (replaying the
                      pop) both when the amount first appears and again when
                      it jumps from the initial win to the collided total —
                      see tm-win-amount-pop and playOutRound. */}
                  <div key={settled.payout} className="sl-win-amount tm-win-amount-pop">
                    {formatChips(settled.payout)}
                  </div>
                </div>
              )}
              {featureIntro && (
                <div className="tm-fs-intro">
                  <div className="tm-fs-intro-rays" />
                  <div className="tm-fs-intro-body">
                    <div className="tm-fs-intro-kicker">Feature Purchased</div>
                    <div className="tm-fs-intro-count">{featureIntro.spins}</div>
                    <div className="tm-fs-intro-title">FREE SPINS</div>
                    <div className="tm-fs-intro-stake">{formatStake(freeSpinBet)} per spin</div>
                    <div className="tm-fs-intro-sub">Get ready…</div>
                  </div>
                </div>
              )}
              {freeSpinsSummary && (
                <div className="sl-win-banner">
                  <div className="sl-win-label">FREE SPINS TOTAL WIN</div>
                  <div className="sl-win-amount">{formatChips(freeSpinsSummary.total)}</div>
                </div>
              )}
            </div>

            {/* Wraps rather than fixing a height: during a batch this row
                carries the spin counter and the running total on top of the
                per-round pay and multiplier, which is more than fits on one
                line on a phone. */}
            <div className="flex min-h-6 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-sm">
              {freeSpinsRemaining && (
                <span className="font-semibold text-muted-foreground">
                  Free Spin {freeSpinsRemaining.index} of {freeSpinsRemaining.total}
                </span>
              )}
              {freeSpinsTotal !== null && (
                <span className="tm-fs-total">
                  <span className="tm-fs-total-label">Total win</span>
                  {/* Keyed by value so it remounts and replays the punch on
                      every tick — see tm-win-amount-pop. */}
                  <span key={freeSpinsTotal} className="tm-fs-total-amount tm-win-amount-pop">
                    {formatChips(freeSpinsTotal)}
                  </span>
                </span>
              )}
              {runningPay > 0 && (
                <span className="font-semibold tabular-nums">
                  {formatChips(runningPay)} {tumbleCount > 0 && <span className="text-muted-foreground">· {tumbleCount + 1} tumbles</span>}
                </span>
              )}
              {/* Always mounted (visibility toggled via class) so its real
                  screen position is measurable the instant the very first X
                  of a round needs somewhere to fly to — see flyXToCounter. */}
              <span
                ref={multBadgeRef}
                className={`tm-mult-badge ${showMultiplier ? "" : "tm-mult-badge-hidden"}`}
              >
                ×{runningMultiplier}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* The special-feature buy panel. A plain overlay inside the game card
          rather than a nested <Modal>: Tumble is already rendered inside one,
          and a second portal would fight it over the body scroll lock and the
          Escape handler. */}
      {showFeatureBuy && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setShowFeatureBuy(false)}
          />
          <div className="tm-feature-panel relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-bold">Special Feature</p>
              <button
                type="button"
                onClick={() => setShowFeatureBuy(false)}
                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              <div className="tm-feature-banner">
                <span className="tm-feature-banner-count">{freeSpins.spinsPerPurchase}</span>
                <span className="tm-feature-banner-title">FREE SPINS</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {freeSpins.spinsPerPurchase} spins played back to back for the price you set, on
                exactly the same odds as a normal spin. The whole batch is paid for up front.
              </p>

              <label className="mt-4 block text-xs font-semibold text-muted-foreground">
                Total cost
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => stepFreeSpinCost(-1)}
                  disabled={!canStakeDown || busy}
                  className="tm-stake-step"
                  aria-label="Lower cost"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="tm-stake-value">{formatStake(freeSpinCost)}</div>
                <button
                  type="button"
                  onClick={() => stepFreeSpinCost(1)}
                  disabled={!canStakeUp || busy}
                  className="tm-stake-step"
                  aria-label="Raise cost"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Min {formatStake(costLadder[0])} · Max {formatStake(costLadder[costLadder.length - 1])}
              </p>

              {/* The stake per spin isn't picked any more, it's what the
                  chosen price works out to — shown so the price still reads
                  as a bet, not just a number. */}
              <div className="mt-4 flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2.5">
                <span className="text-xs font-semibold text-muted-foreground">Buys</span>
                <span className="text-sm font-bold tabular-nums">
                  {freeSpins.spinsPerPurchase} × {formatStake(freeSpinBet)}
                </span>
              </div>

              <Button
                onClick={handleBuyFreeSpins}
                disabled={!freeSpinBetValid || busy}
                className="mt-3 w-full"
              >
                Buy {freeSpins.spinsPerPurchase} Free Spins — {formatStake(freeSpinCost)}
              </Button>
              {freeSpinCost > localBalance && (
                <p className="mt-2 text-center text-xs text-destructive">
                  Not enough chips — balance is {formatChips(localBalance)}.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {flyers.map((f) => (
        <div
          key={f.id}
          className="tm-flyer"
          style={
            {
              left: f.x,
              top: f.y,
              "--dx": `${f.dx}px`,
              "--dy": `${f.dy}px`,
              animationDelay: `${f.delayMs}ms`,
            } as CSSProperties
          }
        >
          ×{f.value}
        </div>
      ))}

      {collideFlight && (
        <div
          className="tm-collide-flyer"
          style={
            {
              left: collideFlight.x,
              top: collideFlight.y,
              "--dx": `${collideFlight.dx}px`,
              "--dy": `${collideFlight.dy}px`,
            } as CSSProperties
          }
        >
          ×{collideFlight.value}
        </div>
      )}
    </div>
  );
}

function TumbleStyles() {
  return (
    <style>{`
      .tm-board {
        /* 30 cells is a lot of board, so cells are smaller than Slots' and
           still grow with the viewport, capped so they stay proportioned on
           a 4K screen. */
        --cell: clamp(46px, 5.2vw, 92px);
        --gap: 8px;
        --pad: 14px;
      }
      /* Below the md breakpoint the controls stack above the board, so the
         board gets the modal's full width — but six columns at the clamp
         floor still overflow a phone. Scale cells with the viewport instead
         of flooring them, and tighten the gap/padding to match. */
      @media (max-width: 767px) {
        .tm-board { --cell: clamp(36px, 12vw, 60px); --gap: 5px; --pad: 8px; }
      }
      .tm-grid { display: flex; gap: var(--gap); }
      .tm-col { display: flex; flex-direction: column; gap: var(--gap); }
      .tm-cell { position: relative; border-radius: 10px; background: rgba(0,0,0,0.25); transition: background 160ms ease, box-shadow 160ms ease; }

      /* Fresh symbols rain in from above the board. Each cell starts one row
         higher than its own position so a full refill looks like a column of
         symbols dropping together rather than every cell sliding the same
         distance. Columns are staggered left to right, so the board fills in a
         sweep instead of all at once; 'backwards' holds each column above the
         board until its own turn comes. */
      @keyframes tmFall {
        0% { transform: translateY(calc(-1 * (var(--fall-row) + 1) * (var(--cell) + var(--gap)))); opacity: 0; }
        60% { opacity: 1; }
        100% { transform: translateY(0); opacity: 1; }
      }
      .tm-cell.tm-fall {
        animation: tmFall ${DROP_MS}ms cubic-bezier(0.34, 1.4, 0.64, 1) backwards;
        animation-delay: calc(var(--fall-col) * ${COL_STAGGER_MS}ms);
      }

      @keyframes tmPop {
        0% { transform: scale(1); opacity: 1; }
        45% { transform: scale(1.18); }
        100% { transform: scale(0.2); opacity: 0; }
      }
      .tm-cell.tm-pop { animation: tmPop ${POP_MS}ms ease-in forwards; }

      /* The multiplier symbol drops into a cell like any other — same fall
         and pop animations above apply to it unchanged — so it only needs
         its own look, not its own motion. */
      .tm-x-sym {
        width: 78%;
        height: 78%;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-weight: 800;
        font-size: clamp(11px, 1.7vw, 15px);
        color: #fff8e1;
        background: radial-gradient(circle at 35% 30%, #ffd76b, #d4820f 70%);
        border: 1px solid rgba(255, 240, 190, 0.85);
        box-shadow: 0 0 10px rgba(255, 190, 70, 0.75), 0 0 22px rgba(255, 150, 40, 0.4);
      }

      /* The distinct "X collected" treatment — deliberately its own look and
         its own (longer) pacing, so a multiplier hit reads as its own event
         rather than blending into the plain win-symbol highlight. Runs for
         X_HIGHLIGHT_MS, whether the X pops right after (mid-cascade) or just
         sits there (the trailing sweep once the round settles). */
      .tm-cell.tm-x-hit { animation: tmXGlow ${X_HIGHLIGHT_MS}ms ease-in-out; z-index: 2; }
      .tm-cell.tm-x-hit .tm-x-sym { animation: tmXPulse ${X_HIGHLIGHT_MS}ms ease-in-out; }
      @keyframes tmXGlow {
        0%, 100% { box-shadow: none; background: rgba(0,0,0,0.25); }
        12%, 50% { box-shadow: 0 0 0 3px rgba(255,214,110,0.95), 0 0 26px 8px rgba(255,170,40,0.8); background: rgba(255,190,60,0.16); }
        31%, 69% { box-shadow: 0 0 0 1px rgba(255,214,110,0.45), 0 0 12px 3px rgba(255,170,40,0.4); background: rgba(255,190,60,0.08); }
      }
      @keyframes tmXPulse {
        0%, 100% { transform: scale(1); filter: brightness(1) saturate(1); }
        12%, 50% { transform: scale(1.4); filter: brightness(1.7) saturate(1.4); }
        31%, 69% { transform: scale(1.12); filter: brightness(1.25) saturate(1.15); }
      }
      /* The collected X's value launches out of its cell and travels to the
         running-multiplier counter — a real fixed-position element (see the
         .tm-flyer map in Tumble's JSX), not a CSS-only effect, since its
         start (the cell) and end (the counter) are two unrelated parts of
         the layout whose real screen positions are only known at launch
         time (see flyXToCounter). --dx/--dy are that measured delta. */
      .tm-flyer {
        position: fixed;
        transform: translate(-50%, -50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 3px 9px;
        border-radius: 999px;
        font-weight: 800;
        font-size: clamp(12px, 1.8vw, 16px);
        color: #fff8e1;
        background: radial-gradient(circle at 35% 30%, #ffd76b, #d4820f 70%);
        box-shadow: 0 0 10px rgba(255, 190, 70, 0.85), 0 0 22px rgba(255, 150, 40, 0.5);
        pointer-events: none;
        white-space: nowrap;
        z-index: 60;
        animation: tmXFly ${FLY_MS}ms cubic-bezier(0.32, 0, 0.6, 1) both;
      }
      @keyframes tmXFly {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        65% { opacity: 1; }
        100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3); opacity: 0; }
      }

      .tm-mult-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 10px;
        border-radius: 999px;
        font-weight: 800;
        font-size: 13px;
        color: #fff8e1;
        background: radial-gradient(circle at 35% 30%, #ffd76b, #d4820f 70%);
        box-shadow: 0 0 12px rgba(255, 190, 70, 0.6);
        transition: opacity 160ms ease;
      }
      /* Kept mounted (not conditionally rendered) at 0, rather than removed
         from the DOM — a flyer needs a real target rect to fly to from the
         moment the very first X of a round is hit, see flyXToCounter. */
      .tm-mult-badge-hidden { opacity: 0; }

      /* The ×N badge's one-time flight from below the board up into the win
         banner, at the end of a round that collected an X — a real
         fixed-position element (see the collideFlight render in Tumble's
         JSX), same reasoning as .tm-flyer above: the badge and the banner
         are two unrelated parts of the layout whose real screen positions
         are only known at launch time (see playOutRound). Sized up from
         .tm-flyer since this is the single payoff moment for the whole
         round, not one of several running tallies. */
      .tm-collide-flyer {
        position: fixed;
        transform: translate(-50%, -50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px 12px;
        border-radius: 999px;
        font-weight: 800;
        font-size: clamp(15px, 2.2vw, 20px);
        color: #fff8e1;
        background: radial-gradient(circle at 35% 30%, #ffd76b, #d4820f 70%);
        box-shadow: 0 0 12px rgba(255, 190, 70, 0.9), 0 0 26px rgba(255, 150, 40, 0.55);
        pointer-events: none;
        white-space: nowrap;
        z-index: 60;
        animation: tmXFly ${COLLIDE_FLY_MS}ms cubic-bezier(0.32, 0, 0.6, 1) both;
      }

      /* --- Special feature: the sidebar CTA, the buy panel, and the
         takeover that plays on the board once a batch is bought. All three
         share the same gold treatment as the X multiplier symbol, so the
         feature reads as one thing across the machine. --- */
      .tm-feature-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 9px 12px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.02em;
        color: #3a2100;
        background: linear-gradient(135deg, #ffe082, #ffb31f 55%, #e08c0c);
        border: 1px solid rgba(255, 240, 190, 0.7);
        box-shadow: 0 0 14px rgba(255, 180, 60, 0.35);
        transition: transform 120ms ease, box-shadow 160ms ease, filter 160ms ease;
      }
      .tm-feature-cta:hover:not(:disabled) { box-shadow: 0 0 22px rgba(255, 180, 60, 0.6); filter: brightness(1.06); }
      .tm-feature-cta:active:not(:disabled) { transform: scale(0.97); }
      .tm-feature-cta:disabled { opacity: 0.5; filter: saturate(0.6); }

      .tm-feature-panel { animation: tmPanelIn 220ms cubic-bezier(0.34, 1.4, 0.64, 1) both; }
      @keyframes tmPanelIn {
        0% { transform: translateY(10px) scale(0.96); opacity: 0; }
        100% { transform: translateY(0) scale(1); opacity: 1; }
      }

      .tm-feature-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 14px 12px;
        border-radius: 12px;
        color: #fff8e1;
        background: radial-gradient(circle at 30% 20%, rgba(255, 215, 107, 0.35), rgba(0, 0, 0, 0.35)), #241703;
        border: 1px solid rgba(255, 214, 110, 0.5);
        box-shadow: inset 0 0 24px rgba(255, 170, 40, 0.22);
      }
      .tm-feature-banner-count {
        font-size: 30px;
        font-weight: 900;
        line-height: 1;
        color: #ffd76b;
        text-shadow: 0 0 16px rgba(255, 180, 60, 0.7);
      }
      .tm-feature-banner-title {
        font-size: 15px;
        font-weight: 900;
        letter-spacing: 0.22em;
        color: #ffe9a8;
      }

      .tm-stake-step {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 10px;
        border: 1px solid rgba(255, 214, 110, 0.45);
        color: #ffd76b;
        background: rgba(255, 190, 60, 0.1);
        transition: background 140ms ease, transform 120ms ease;
      }
      .tm-stake-step:hover:not(:disabled) { background: rgba(255, 190, 60, 0.22); }
      .tm-stake-step:active:not(:disabled) { transform: scale(0.92); }
      .tm-stake-step:disabled { opacity: 0.35; }
      .tm-stake-value {
        flex: 1;
        min-width: 0;
        text-align: center;
        font-variant-numeric: tabular-nums;
        font-weight: 800;
        /* The ladder spans 0.1 to 10,000,000 — clamp rather than fix the size
           so the widest stop still fits the panel on a phone. */
        font-size: clamp(13px, 3.6vw, 19px);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* The batch's running total win. Deliberately quieter than the win
         banner and the ×N badge — it's a tally that sits there for the whole
         batch, not a payoff moment, so it reads as a counter rather than
         competing with each round's own win. */
      .tm-fs-total {
        display: inline-flex;
        align-items: center;
        /* Wide enough that the amount's tick punch (tm-win-amount-pop scales
           to 1.18 about its centre) can never graze the label. */
        gap: 10px;
        padding: 2px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 214, 110, 0.35);
        background: rgba(255, 190, 60, 0.08);
        white-space: nowrap;
      }
      .tm-fs-total-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 233, 168, 0.7);
      }
      .tm-fs-total-amount {
        font-size: 13px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: #ffd76b;
      }

      /* The purchase takeover: covers the board for FS_INTRO_MS so a bought
         batch is unmistakably announced before it starts playing. */
      .tm-fs-intro {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 14px;
        background: radial-gradient(circle at 50% 50%, rgba(92, 52, 0, 0.82), rgba(0, 0, 0, 0.93));
        animation: tmFsIntroIn 260ms ease-out both;
      }
      @keyframes tmFsIntroIn { from { opacity: 0; } to { opacity: 1; } }

      .tm-fs-intro-rays {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 170%;
        aspect-ratio: 1;
        transform: translate(-50%, -50%);
        background: repeating-conic-gradient(from 0deg, rgba(255, 200, 90, 0.22) 0deg 7deg, transparent 7deg 20deg);
        -webkit-mask-image: radial-gradient(circle, #000 8%, transparent 60%);
        mask-image: radial-gradient(circle, #000 8%, transparent 60%);
        animation: tmFsRays 12s linear infinite;
      }
      @keyframes tmFsRays { to { transform: translate(-50%, -50%) rotate(360deg); } }

      .tm-fs-intro-body { position: relative; text-align: center; padding: 0 12px; }
      .tm-fs-intro-kicker {
        font-size: clamp(9px, 1.2vw, 12px);
        font-weight: 800;
        letter-spacing: 0.3em;
        color: rgba(255, 233, 168, 0.75);
        animation: tmFsFadeUp 420ms ease-out both;
      }
      .tm-fs-intro-count {
        margin-top: 4px;
        font-size: clamp(44px, 8vw, 88px);
        font-weight: 900;
        line-height: 1;
        color: #ffd76b;
        text-shadow: 0 0 30px rgba(255, 180, 60, 0.75), 0 0 60px rgba(255, 140, 30, 0.4);
        animation: tmFsPunch 640ms cubic-bezier(0.2, 1.5, 0.5, 1) 80ms both;
      }
      .tm-fs-intro-title {
        font-size: clamp(16px, 2.8vw, 30px);
        font-weight: 900;
        letter-spacing: 0.26em;
        color: #ffe9a8;
        text-shadow: 0 0 20px rgba(255, 180, 60, 0.6);
        animation: tmFsPunch 640ms cubic-bezier(0.2, 1.5, 0.5, 1) 220ms both;
      }
      .tm-fs-intro-stake {
        margin-top: 10px;
        font-size: clamp(11px, 1.5vw, 15px);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: rgba(255, 248, 225, 0.9);
        animation: tmFsFadeUp 460ms ease-out 420ms both;
      }
      .tm-fs-intro-sub {
        margin-top: 6px;
        font-size: clamp(10px, 1.3vw, 13px);
        font-weight: 700;
        letter-spacing: 0.2em;
        color: rgba(255, 240, 205, 0.7);
        animation: tmFsFadeUp 460ms ease-out 620ms both, tmFsPulse 1200ms ease-in-out 1080ms infinite;
      }
      @keyframes tmFsPunch {
        0% { transform: scale(0.4); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes tmFsFadeUp {
        0% { transform: translateY(8px); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }
      @keyframes tmFsPulse {
        0%, 100% { opacity: 0.45; }
        50% { opacity: 1; }
      }

      /* Punches the win amount when it appears — including the moment it
         jumps from the initial (pre-X) win to the collided total, since the
         element remounts (see the key={settled.payout} in Tumble's JSX) and
         replays this each time. */
      .tm-win-amount-pop { animation: tmAmountPop 380ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      @keyframes tmAmountPop {
        0% { transform: scale(0.7); }
        60% { transform: scale(1.18); }
        100% { transform: scale(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .tm-cell.tm-fall, .tm-cell.tm-pop, .tm-cell.tm-x-hit, .tm-cell.tm-x-hit .tm-x-sym, .tm-flyer, .tm-collide-flyer, .tm-win-amount-pop {
          animation-duration: 1ms;
        }
        .tm-cell.tm-fall { animation-delay: 0ms; }
        /* The purchase takeover still has to be *seen* for its full hold, so
           only its motion is dropped — the panel/text simply appear. */
        .tm-feature-panel, .tm-fs-intro, .tm-fs-intro-kicker, .tm-fs-intro-count,
        .tm-fs-intro-title, .tm-fs-intro-stake, .tm-fs-intro-sub {
          animation-duration: 1ms;
          animation-delay: 0ms;
        }
        .tm-fs-intro-rays { animation: none; }
        .tm-fs-intro-sub { animation-iteration-count: 1; }
        .sl-win-banner { animation: none; }
      }
    `}</style>
  );
}
