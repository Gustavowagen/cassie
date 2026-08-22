import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
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
  TumbleOrb,
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
const BASELINE_RTP = 1.070847083099;
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
const POP_MS = 330;
const ORB_MS = 520;
const BANNER_MS = 1500;

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
// Used only when a parent hasn't wired the freeSpins prop yet — CasinoDashboard
// passes the real resolved settings in Task 7 of the free-spins plan.
const DEFAULT_FREE_SPINS: TumbleFreeSpinsSettings = {
  enabled: false,
  minBet: 1,
  maxBet: 100,
  spinsPerPurchase: 10,
};
function randomBoard(): TumbleBoard {
  return Array.from({ length: COLS }, () => Array.from({ length: ROWS }, randomSymbolId));
}
const cellKey = (col: number, row: number) => `${col}:${row}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// How many cells each column loses on this step. The engine refills a column
// from the top, so the next board's fresh cells are exactly rows
// [0, poppedInColumn) — which is what drives the rain-down animation.
function poppedPerColumn(step: TumbleStep): number[] {
  const counts = Array<number>(COLS).fill(0);
  for (const win of step.wins) for (const p of win.positions) counts[p.col]++;
  return counts;
}

interface Props {
  casinoId: string;
  gameId: string;
  houseEdge: number;
  design?: string;
  freeSpins?: TumbleFreeSpinsSettings;
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
  freeSpins = DEFAULT_FREE_SPINS,
  balance: initialBalance,
  minBet,
  maxBet,
  onExit,
}: Props) {
  const { loading, spin, buyFreeSpins } = useTumble(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [freeSpinBetText, setFreeSpinBetText] = useState(String(freeSpins.minBet));
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState<{ index: number; total: number } | null>(null);

  const [board, setBoard] = useState<TumbleBoard>(randomBoard);
  const [lit, setLit] = useState<Set<string>>(() => new Set());
  const [popping, setPopping] = useState<Set<string>>(() => new Set());
  const [falling, setFalling] = useState<Set<string>>(() => new Set());
  const [orbs, setOrbs] = useState<TumbleOrb[]>([]);
  const [runningPay, setRunningPay] = useState(0);
  const [tumbleCount, setTumbleCount] = useState(0);
  const [settled, setSettled] = useState<{ payout: number; multiplier: number } | null>(null);
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

  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;
  const freeSpinBet = Math.max(0, parseFloat(freeSpinBetText) || 0);
  const freeSpinCost = roundMoney(freeSpinBet * freeSpins.spinsPerPurchase);
  const freeSpinBetValid =
    freeSpins.enabled &&
    freeSpinBet >= freeSpins.minBet &&
    freeSpinBet <= freeSpins.maxBet &&
    freeSpinCost <= localBalance;
  const busy = loading || animating;

  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  function resetRound() {
    setLit(new Set());
    setPopping(new Set());
    setFalling(new Set());
    setOrbs([]);
    setRunningPay(0);
    setTumbleCount(0);
    setSettled(null);
  }

  // Replays the server's already-decided round as an animation. Nothing here
  // computes an outcome — every board, win, orb and pay comes from the
  // response.
  async function replay(round: TumbleRound, token: number) {
    const alive = () => runId.current === token;

    // Opening board rains in from the top.
    const opening = round.steps[0]?.board ?? round.finalBoard;
    setBoard(opening);
    setFalling(new Set(opening.flatMap((_, c) => opening[c].map((_, r) => cellKey(c, r)))));
    await sleep(FALL_MS);
    if (!alive()) return;
    setFalling(new Set());

    let collectedOrbs: TumbleOrb[] = [];
    let paid = 0;

    for (let i = 0; i < round.steps.length; i++) {
      const step = round.steps[i];

      // 1. Light up every winning cell and bank this step's pay.
      setLit(new Set(step.wins.flatMap((w) => w.positions.map((p) => cellKey(p.col, p.row)))));
      paid = roundMoney(paid + step.pay);
      setRunningPay(paid);
      setTumbleCount(i);
      await sleep(HIGHLIGHT_MS);
      if (!alive()) return;

      // 2. Any orbs this step dropped land on the board and join the round's
      //    running multiplier.
      if (step.orbs.length > 0) {
        collectedOrbs = [...collectedOrbs, ...step.orbs];
        setOrbs(collectedOrbs);
        await sleep(ORB_MS);
        if (!alive()) return;
      }

      // 3. Winning cells pop.
      setPopping(new Set(step.wins.flatMap((w) => w.positions.map((p) => cellKey(p.col, p.row)))));
      await sleep(POP_MS);
      if (!alive()) return;
      setLit(new Set());
      setPopping(new Set());

      // 4. Survivors fall and fresh symbols rain into the gaps.
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
    }

    return collectedOrbs;
  }

  // Plays one already-resolved round's cascade animation, then credits that
  // round's own payout into local balance and shows its win banner — the
  // shared per-round contract a manual spin (below) and each round of a
  // purchased free-spin batch (handleBuyFreeSpins) both use. Nothing here
  // computes an outcome; `round` and `bet` are already decided server-side.
  async function playOutRound(round: TumbleRound, bet: number, token: number) {
    resetRound();
    await replay(round, token);
    if (runId.current !== token) return;

    const payout = payoutFor(round, bet);
    if (payout > 0) {
      setLocalBalance((b) => roundMoney(b + payout));
      setSettled({ payout, multiplier: round.multiplier });
      playWinChime();
      setTimeout(() => {
        if (runId.current === token) setSettled(null);
      }, BANNER_MS + 400);
    }
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
    setAnimating(true);

    const token = ++runId.current;
    const cost = freeSpinCost;
    // Same "deduct before the reveal" rule as a manual spin, extended to
    // cover the whole prepaid batch at once — the balance must never spoil
    // any individual spin's outcome ahead of that spin's own animation.
    setLocalBalance((b) => roundMoney(b - cost));

    let result: TumbleFreeSpinsResult;
    try {
      result = await buyFreeSpins(freeSpinBet);
    } catch (err) {
      if (runId.current === token) {
        setLocalBalance((b) => roundMoney(b + cost)); // roll the deduction back
        setFormError(err instanceof Error ? err.message : "Failed to buy free spins");
        setAnimating(false);
      }
      return;
    }
    if (runId.current !== token) return;

    for (let i = 0; i < result.rounds.length; i++) {
      setFreeSpinsRemaining({ index: i + 1, total: result.rounds.length });
      await playOutRound(result.rounds[i], result.bet, token);
      if (runId.current !== token) return;
    }

    setFreeSpinsRemaining(null);
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
        "Multiplier orbs can drop on any paying tumble. All orbs collected in a round add up and multiply the round's whole win — orbs never pay on their own.",
        `This machine's house edge is ${(houseEdge * 100).toFixed(0)}%, already applied to the payouts shown.`,
        ...(freeSpins.enabled
          ? [
              `Buy ${freeSpins.spinsPerPurchase} free spins for a stake between ${formatChips(
                freeSpins.minBet
              )} and ${formatChips(freeSpins.maxBet)} chips — each spin plays out with the exact same odds as a normal spin.`,
            ]
          : []),
      ],
    }),
    [houseEdge, freeSpins]
  );

  const orbTotal = orbs.reduce((sum, o) => sum + o.value, 0);
  const showMultiplier = orbTotal > 0;

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
                <label className="text-xs text-muted-foreground">Free Spins</label>
                <input
                  type="number"
                  min={0}
                  value={freeSpinBetText}
                  onChange={(e) => setFreeSpinBetText(e.target.value)}
                  disabled={busy}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Min {formatChips(freeSpins.minBet)} · Max {formatChips(freeSpins.maxBet)} per spin
                </p>
                <Button
                  onClick={handleBuyFreeSpins}
                  disabled={!freeSpinBetValid || busy}
                  variant="outline"
                  className="w-full mt-2"
                >
                  Buy {freeSpins.spinsPerPurchase} Free Spins — {formatChips(freeSpinCost)}
                </Button>
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
            <div className={`tm-board sl-reels-wrap ${activeDesign.themeClass}`}>
              <div className="tm-grid">
                {board.map((col, c) => (
                  <div className="tm-col" key={c}>
                    {col.map((symbol, r) => {
                      const key = cellKey(c, r);
                      const classes = [
                        "sl-cell",
                        "tm-cell",
                        lit.has(key) ? "sl-lit" : "",
                        popping.has(key) ? "tm-pop" : "",
                        falling.has(key) ? "tm-fall" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <div
                          className={classes}
                          key={r}
                          style={{ "--fall-row": r, "--fall-col": c } as CSSProperties}
                        >
                          <SlotSymbol design={activeDesign} id={symbol} />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {orbs.map((orb, i) => (
                <div
                  className="tm-orb"
                  key={`${orb.col}:${orb.row}:${i}`}
                  style={
                    {
                      left: `calc(var(--pad) + ${orb.col} * (var(--cell) + var(--gap)) + var(--cell) / 2)`,
                      top: `calc(var(--pad) + ${orb.row} * (var(--cell) + var(--gap)) + var(--cell) / 2)`,
                    } as CSSProperties
                  }
                >
                  ×{orb.value}
                </div>
              ))}

              {settled && (
                <div className="sl-win-banner">
                  <div className="sl-win-label">
                    {settled.multiplier > 1 ? `WIN ×${settled.multiplier}` : "WIN"}
                  </div>
                  <div className="sl-win-amount">{formatChips(settled.payout)}</div>
                </div>
              )}
            </div>

            <div className="flex h-6 items-center gap-3 text-sm">
              {freeSpinsRemaining && (
                <span className="font-semibold text-muted-foreground">
                  Free Spin {freeSpinsRemaining.index} of {freeSpinsRemaining.total}
                </span>
              )}
              {runningPay > 0 && (
                <span className="font-semibold tabular-nums">
                  {displayX(runningPay)}× {tumbleCount > 0 && <span className="text-muted-foreground">· {tumbleCount + 1} tumbles</span>}
                </span>
              )}
              {showMultiplier && <span className="tm-mult-badge">×{orbTotal}</span>}
            </div>
          </div>
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
      .tm-cell { border-radius: 10px; background: rgba(0,0,0,0.25); transition: background 160ms ease, box-shadow 160ms ease; }

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

      .tm-orb {
        position: absolute;
        transform: translate(-50%, -50%);
        z-index: 4;
        min-width: 2.4em;
        padding: 4px 8px;
        border-radius: 999px;
        font-weight: 800;
        font-size: 13px;
        text-align: center;
        color: #fff8e1;
        background: radial-gradient(circle at 35% 30%, #ffd76b, #d4820f 70%);
        border: 1px solid rgba(255, 240, 190, 0.85);
        box-shadow: 0 0 12px rgba(255, 190, 70, 0.85), 0 0 28px rgba(255, 150, 40, 0.5);
        animation: tmOrbIn ${ORB_MS}ms cubic-bezier(0.2, 1.5, 0.5, 1) backwards;
      }
      @keyframes tmOrbIn {
        0% { transform: translate(-50%, -180%) scale(0.3); opacity: 0; }
        60% { opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
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
      }

      @media (prefers-reduced-motion: reduce) {
        .tm-cell.tm-fall, .tm-cell.tm-pop, .tm-orb { animation-duration: 1ms; }
        .tm-cell.tm-fall { animation-delay: 0ms; }
        .sl-win-banner { animation: none; }
      }
    `}</style>
  );
}
