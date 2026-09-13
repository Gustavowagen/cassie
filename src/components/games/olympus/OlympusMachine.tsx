import { useCallback, useEffect, useRef, useState } from "react";
import {
  COLS,
  FREE_SPINS_COUNT,
  ROWS,
  isOrb,
  makeRng,
  playRound,
  type OlyBoard,
  type OlyFreeSpinsBatch,
  type OlyStep,
  type OlympusRound,
  type Pos,
} from "../../../lib/olympusEngine";
import { OlyOrbArt, OlySymbolArt } from "./olympusArt";
import { OlympusBetStepper } from "./OlympusBetStepper";
import { OlympusBuyButton } from "./OlympusBuyButton";
import { OlympusSpinButton } from "./OlympusSpinButton";

// The board and its cascade replay.
//
// The machine decides nothing about a round: it asks for one, gets a fully
// resolved OlympusRound back, and plays it as animation beats. Who resolves it
// is the caller's business — Olympus.tsx hands it the edge function's
// response. The machine never goes near a balance itself; the caller settles
// the authoritative one when onSettled fires, once the reveal is actually
// over.

// --- animation beats, in ms -------------------------------------------------
// Held here rather than only in CSS because the replay loop awaits them.
const DROP_MS = 500;
/** Columns land left to right, so a refill sweeps across the board. */
const COL_STAGGER_MS = 70;
const FALL_MS = DROP_MS + (COLS - 1) * COL_STAGGER_MS;
/** How long winning symbols stay lit before they pop. */
const HIGHLIGHT_MS = 820;
/** Zeus's strike and the orb's charge-up, before it is collected. */
const STRIKE_MS = 1150;
const FLY_MS = 560;
/** Orbs launch this far apart so the counter ticks once per arrival. */
const FLY_STAGGER_MS = 150;
const POP_MS = 320;
/** Beat between the board settling and the win banner arriving. */
const SETTLE_MS = 340;
const COUNT_UP_MS = 900;
/** The free-spins card holds the board this long before the first spin drops. */
const INTRO_MS = 1900;
/** Between free spins: long enough to read a win banner, brief after a loss. */
const BATCH_WIN_HOLD_MS = 1700;
const BATCH_GAP_MS = 260;
/** The closing free-spins banner lingers longer than a single spin's. */
const SUMMARY_MS = 4200;

const keyOf = (p: Pos) => `${p.col}:${p.row}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Rows each cell travels on the next drop; 0 means it stays put. */
function dropsAfter(step: OlyStep): number[][] {
  // Only the winning symbols leave; orbs stay and fall with the survivors, so
  // they are never part of the hole the drop has to close.
  const cleared = new Set(step.wins.flatMap((w) => w.positions).map(keyOf));
  return Array.from({ length: COLS }, (_, col) => {
    const drops = Array<number>(ROWS).fill(0);
    const survivors: number[] = [];
    for (let row = 0; row < ROWS; row++) {
      if (!cleared.has(`${col}:${row}`)) survivors.push(row);
    }
    const gaps = ROWS - survivors.length;
    if (gaps === 0) return drops;
    // Survivors slide down by however many cleared cells sat beneath them.
    survivors.forEach((from, i) => {
      drops[gaps + i] = gaps + i - from;
    });
    // The replacements were stacked above the board, so they all fall the
    // same distance — the size of the hole they are filling.
    for (let row = 0; row < gaps; row++) drops[row] = gaps;
    return drops;
  });
}

const FULL_DROP = Array.from({ length: COLS }, () => Array<number>(ROWS).fill(ROWS));
const NO_DROP = Array.from({ length: COLS }, () => Array<number>(ROWS).fill(0));

interface Flyer {
  id: number;
  value: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

interface View {
  board: OlyBoard;
  drops: number[][];
  lit: Set<string>;
  popping: Set<string>;
  charged: boolean;
  /**
   * Bumped every time a new board lands. It is part of each cell's key, so
   * every drop mounts fresh cells and the fall always replays. Keyed on
   * position alone, a cell that was already mid-"oly-drop" kept the class
   * across the change, the browser never restarted the animation, and the
   * new symbols just appeared in place.
   */
  wave: number;
}

/** Counts a number up when it changes, so a win lands as a climb not a jump. */
function useCountUp(target: number, ms: number) {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      // Ease out, so the last digits settle rather than slam.
      setShown(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  useEffect(() => {
    if (target === 0) fromRef.current = 0;
  }, [target]);
  return target === 0 ? 0 : shown;
}

export interface OlympusMachineProps {
  /**
   * onStrike fires when a multiplier orb charges up — the one moment Zeus
   * lifts his trident. The page decides how he answers; the machine never
   * touches him directly.
   */
  onStrike?: () => void;
  /** The stake ladder the bet coins walk, low to high. */
  stakes: number[];
  betIndex: number;
  onBetIndexChange: (index: number) => void;
  /**
   * Resolves one base-game round. Throwing aborts the spin and leaves the
   * board as it was — the caller is responsible for telling the player why.
   */
  onSpin: (bet: number) => Promise<OlympusRound>;
  /** Omitted when this instance has the feature buy switched off. */
  onBuyFreeSpins?: (bet: number) => Promise<OlyFreeSpinsBatch>;
  /** Shown on the buy coin. Omitted alongside onBuyFreeSpins. */
  freeSpinsCost?: number;
  /**
   * Fires once a replay has completely finished — after the last banner, not
   * when the response arrived. The caller settles the authoritative balance
   * here, so the counter can never jump to the win before the board has shown
   * it (see CLAUDE.md's rule for reveal-animated games).
   */
  onSettled?: () => void;
  /**
   * How every figure on the cabinet is written. Olympus.tsx passes
   * formatChips, so the board agrees to the digit with the balance in the
   * header above it.
   */
  formatAmount: (n: number) => string;
}

/** What the win banner is showing. Chips, already multiplied — not a round. */
interface BannerWin {
  amount: number;
  /** As a bet multiple, which is what picks the banner's tier. */
  multipleOfBet: number;
  /** The total multiplier that produced it, or 0 if none applied. */
  multiplier: number;
}

export function OlympusMachine({
  onStrike,
  stakes,
  betIndex,
  onBetIndexChange,
  onSpin,
  onBuyFreeSpins,
  freeSpinsCost,
  onSettled,
  formatAmount: amount,
}: OlympusMachineProps) {
  const [view, setView] = useState<View>(() => ({
    // Decoration only: a settled board to look at before the first spin. It is
    // played locally on purpose — asking the server for a round nobody bet on
    // would charge for it.
    board: playRound(makeRng(Math.floor(Math.random() * 1e9))).steps.slice(-1)[0].board,
    drops: NO_DROP,
    lit: new Set(),
    popping: new Set(),
    charged: false,
    wave: 0,
  }));
  const [spinning, setSpinning] = useState(false);
  const bet = stakes[Math.min(Math.max(betIndex, 0), stakes.length - 1)];
  const [tumbleWin, setTumbleWin] = useState(0);
  const [multiplier, setMultiplier] = useState(0);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  /**
   * What the banner is paying out. Held as a finished chip amount rather than
   * a round plus a stake: the banner outlives the lock on the bet coins, so
   * anything derived from the live stake would follow a later step of the
   * ladder, and a free spin's pay isn't its round's totalWin anyway (the
   * batch's running multiplier is not the round's own).
   */
  const [result, setResult] = useState<BannerWin | null>(null);
  /** Set while a free-spins batch plays: which spin this is, out of how many. */
  const [batch, setBatch] = useState<{ index: number; total: number } | null>(null);
  const [batchWin, setBatchWin] = useState(0);
  const [intro, setIntro] = useState(false);
  /** The batch's total, shown once the last free spin has settled. */
  const [summary, setSummary] = useState<number | null>(null);

  const cellRefs = useRef(new Map<string, HTMLDivElement | null>());
  const multRef = useRef<HTMLDivElement | null>(null);
  const runToken = useRef(0);
  const flyerId = useRef(0);

  const shownTumble = useCountUp(tumbleWin, 420);
  const shownTotal = useCountUp(result ? result.amount : 0, COUNT_UP_MS);
  const shownBatch = useCountUp(batchWin, 420);
  const shownSummary = useCountUp(summary ?? 0, COUNT_UP_MS);

  // Any in-flight replay must stop when the component goes away, or its
  // timers would keep calling setState on an unmounted tree.
  useEffect(() => () => void runToken.current++, []);

  /** Sends an orb's value across the board to the running multiplier. */
  const launchOrb = useCallback((orb: Pos & { value: number }) => {
    const cell = cellRefs.current.get(keyOf(orb));
    const target = multRef.current;
    if (!cell || !target) return;
    const from = cell.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const id = flyerId.current++;
    setFlyers((f) => [
      ...f,
      {
        id,
        value: orb.value,
        x: from.left + from.width / 2,
        y: from.top + from.height / 2,
        dx: to.left + to.width / 2 - (from.left + from.width / 2),
        dy: to.top + to.height / 2 - (from.top + from.height / 2),
      },
    ]);
    setTimeout(() => setFlyers((f) => f.filter((x) => x.id !== id)), FLY_MS + 60);
  }, []);

  /**
   * Plays one resolved round back as animation beats. A base-game spin and
   * every free spin go through this same replay. Resolves once the board has
   * settled and any win banner is up; the caller decides what happens next.
   *
   * `carry` is the multiplier the counter is already holding when this round
   * starts. It is 0 for a base-game spin — where each round's orbs multiply
   * that round and nothing else — and the batch's running total during free
   * spins, where one multiplier persists across all fifteen and every orb
   * collected keeps multiplying every later win. The replay treats the two
   * identically apart from the number it counts up from.
   *
   * `payout` is what the round actually pays, in chips, and `applied` is the
   * multiplier that produced it. Both have to be passed in rather than read
   * off the round: inside a batch a spin pays its base win times the BANKED
   * total, and only when the spin collected an orb of its own — a spin that
   * pays with none leaves the bank locked and pays flat, at `applied` 0, with
   * the carry still showing on the counter. The round knows nothing about
   * either. Defaults suit a base-game spin, where the round's own orbs are the
   * whole story.
   */
  const replayRound = useCallback(async (
    round: OlympusRound,
    alive: () => boolean,
    carry = 0,
    payout?: number,
    applied?: number,
  ) => {
    setResult(null);
    setTumbleWin(0);
    setMultiplier(carry);

    const steps = round.steps;

    setView((v) => ({
      board: steps[0].board,
      drops: FULL_DROP,
      lit: new Set(),
      popping: new Set(),
      charged: false,
      wave: v.wave + 1,
    }));
    await sleep(FALL_MS);

    let winAcc = 0;

    // The tumble runs all the way out first: every win lights, pays into the
    // running total and drops away, while the orbs stay standing on the board.
    // Nothing is multiplied yet — that is the finale, below.
    for (let i = 0; i < steps.length; i++) {
      if (!alive()) return;
      const step = steps[i];
      if (step.wins.length === 0) break;

      const winning = new Set(step.wins.flatMap((w) => w.positions).map(keyOf));
      setView((v) => ({ ...v, lit: winning }));
      await sleep(HIGHLIGHT_MS);
      if (!alive()) return;

      winAcc += step.stepWin;
      setTumbleWin(winAcc * bet);

      // Only the winners leave. Any orb among them stays put and falls with
      // the survivors into the board below.
      setView((v) => ({ ...v, lit: new Set(), popping: winning }));
      await sleep(POP_MS);
      if (!alive()) return;

      const next = steps[i + 1];
      setView((v) => ({
        board: next.board,
        drops: dropsAfter(step),
        lit: new Set(),
        popping: new Set(),
        charged: false,
        wave: v.wave + 1,
      }));
      await sleep(FALL_MS);
    }

    // The finale: with the board settled and the win already counted, Zeus
    // strikes once and every orb still standing flies to the counter. Only on
    // a round that pays — an orb with nothing to multiply is left uncollected,
    // and the round ends as quietly as any loss.
    const settledOrbs = steps[steps.length - 1].orbs;
    if (settledOrbs.length > 0 && round.baseWin > 0) {
      onStrike?.();
      setView((v) => ({ ...v, charged: true }));
      await sleep(STRIKE_MS);
      if (!alive()) return;
      for (const orb of settledOrbs) {
        launchOrb(orb);
        // The badge in flight is the one that was sitting in the cell, so the
        // cell has to empty as it leaves or the orb reads as two of itself.
        setView((v) => ({ ...v, popping: new Set([...v.popping, keyOf(orb)]) }));
        await sleep(FLY_STAGGER_MS);
        if (!alive()) return;
      }
      await sleep(FLY_MS - FLY_STAGGER_MS);
      if (!alive()) return;
      // Added to what the counter was already holding, not assigned over it:
      // during free spins those arriving orbs join a running total rather
      // than replacing it.
      setMultiplier(carry + settledOrbs.reduce((sum, o) => sum + o.value, 0));
      setView((v) => ({ ...v, charged: false }));
    }

    if (!alive()) return;
    await sleep(SETTLE_MS);
    if (!alive()) return;
    // A losing spin shows nothing at all — the board just goes quiet. Same
    // convention the rest of the games follow (see CLAUDE.md).
    const amount = payout ?? round.totalWin * bet;
    if (amount > 0) {
      setResult({
        amount,
        multipleOfBet: bet > 0 ? amount / bet : 0,
        multiplier: applied ?? carry + round.multiplier,
      });
    }
    setTumbleWin(0);
  }, [bet, launchOrb, onStrike]);

  const handleSpin = useCallback(async () => {
    if (spinning) return;
    const token = ++runToken.current;
    const alive = () => runToken.current === token;

    setSpinning(true);
    setSummary(null);

    let round: OlympusRound;
    try {
      round = await onSpin(bet);
    } catch {
      // The caller has already surfaced why. Unlock and leave the board be —
      // a failed request must not look like a losing spin.
      if (alive()) setSpinning(false);
      return;
    }
    if (!alive()) return;

    await replayRound(round, alive);
    if (!alive()) return;
    setSpinning(false);
    // Only now, with the board settled and the banner up, is the caller told
    // to apply the authoritative balance.
    onSettled?.();
  }, [spinning, bet, onSpin, onSettled, replayRound]);

  /**
   * The feature buy: the whole batch is resolved up front, like a single spin,
   * then played back one spin after another. Both buttons stay locked until
   * the last spin has settled.
   *
   * The multiplier counter deliberately does NOT reset between spins here —
   * it is handed to each replay as `carry` and keeps climbing, which is the
   * whole difference between this and fifteen ordinary spins. What it is worth
   * on any given spin is another matter: the bank only multiplies a spin that
   * collected an orb of its own, which is why each replay is told its
   * `multiplierApplied` separately from the carry it counts up from.
   */
  const handleBuy = useCallback(async () => {
    if (spinning || !onBuyFreeSpins) return;
    const token = ++runToken.current;
    const alive = () => runToken.current === token;

    setSpinning(true);
    setResult(null);
    setSummary(null);
    setMultiplier(0);

    let batchResult: OlyFreeSpinsBatch;
    try {
      batchResult = await onBuyFreeSpins(bet);
    } catch {
      if (alive()) {
        setSpinning(false);
        setBatch(null);
      }
      return;
    }
    if (!alive()) return;

    setIntro(true);
    await sleep(INTRO_MS);
    if (!alive()) return;
    setIntro(false);

    let total = 0;
    setBatchWin(0);
    const spins = batchResult.spins;
    for (let i = 0; i < spins.length; i++) {
      setBatch({ index: i + 1, total: spins.length });
      const spin = spins[i];
      const payout = spin.spinWin * bet;
      await replayRound(spin.round, alive, spin.multiplierBefore, payout, spin.multiplierApplied);
      if (!alive()) return;
      total += payout;
      setBatchWin(total);
      await sleep(payout > 0 ? BATCH_WIN_HOLD_MS : BATCH_GAP_MS);
      if (!alive()) return;
    }

    setResult(null);
    setBatch(null);
    setBatchWin(0);
    setMultiplier(0);
    // A batch that paid nothing ends as quietly as a losing spin.
    if (total > 0) setSummary(total);
    setSpinning(false);
    onSettled?.();
  }, [spinning, bet, onBuyFreeSpins, onSettled, replayRound]);

  const bigWin = result ? result.multipleOfBet : 0;
  const winTier = bigWin >= 200 ? "mega" : bigWin >= 50 ? "big" : bigWin > 0 ? "win" : "";

  return (
    <div className="oly-machine">
      <MachineStyles />

      {/* The plaque above the board: a normal spin's running tumble win, or
          during free spins, which spin this is and what the batch has paid. */}
      {batch ? (
        <div className="oly-plaque oly-plaque-on">
          <span className="oly-plaque-label">
            Free spin {batch.index} / {batch.total}
          </span>
          <span className="oly-plaque-amount">{amount(shownBatch)}</span>
        </div>
      ) : (
        <div className={`oly-plaque ${tumbleWin > 0 ? "oly-plaque-on" : ""}`}>
          <span className="oly-plaque-label">Tumble win</span>
          <span className="oly-plaque-amount">{amount(shownTumble)}</span>
        </div>
      )}

      <div className="oly-frame">
        {/* Rosette bolts pinning the frame at its corners, as on the original
            cabinet art. Purely chrome — they carry no state. */}
        <span className="oly-boss oly-boss-tl" aria-hidden />
        <span className="oly-boss oly-boss-tr" aria-hidden />
        <span className="oly-boss oly-boss-bl" aria-hidden />
        <span className="oly-boss oly-boss-br" aria-hidden />
        <div className="oly-grid">
          {view.board.map((col, c) => (
            <div className="oly-col" key={c}>
              {col.map((cell, r) => {
                const key = `${c}:${r}`;
                const drop = view.drops[c][r];
                return (
                  <div
                    key={`${key}:${view.wave}`}
                    ref={(el) => void cellRefs.current.set(key, el)}
                    className={[
                      "oly-cell",
                      drop > 0 ? "oly-drop" : "",
                      view.lit.has(key) ? "oly-lit" : "",
                      view.popping.has(key) ? "oly-pop" : "",
                      isOrb(cell) ? "oly-cell-orb" : "",
                      isOrb(cell) && view.charged ? "oly-charged" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      {
                        "--drop": drop,
                        "--col": c,
                      } as React.CSSProperties
                    }
                  >
                    {cell === null ? null : isOrb(cell) ? (
                      <OlyOrbArt value={cell.value} />
                    ) : (
                      <OlySymbolArt id={cell} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {result && (
          <div className={`oly-banner oly-banner-${winTier}`} key={`w${flyerId.current}${bigWin}`}>
            <span className="oly-banner-label">
              {bigWin >= 200 ? "Mega win" : bigWin >= 50 ? "Big win" : "Win"}
            </span>
            <span className="oly-banner-amount">{amount(shownTotal)}</span>
            {result.multiplier > 0 && (
              <span className="oly-banner-mult">
                {result.multiplier}x pays {amount(result.amount)}
              </span>
            )}
          </div>
        )}

        {intro && (
          <div className="oly-intro" role="status">
            <span className="oly-intro-count">{FREE_SPINS_COUNT}</span>
            <span className="oly-intro-label">Free spins</span>
            <span className="oly-intro-note">Every x stays for the whole round</span>
          </div>
        )}

        {summary !== null && (
          <div className="oly-banner oly-banner-big oly-banner-summary" key={`s${summary}`}>
            <span className="oly-banner-label">Free spins win</span>
            <span className="oly-banner-amount">{amount(shownSummary)}</span>
          </div>
        )}
      </div>

      {/* Controls. The bet steps through a ladder of stakes and scales every
          readout. The coins lock for as long as a round is playing, so the
          stake cannot move under a spin that was already priced at it. */}
      <div className="oly-controls">
        {onBuyFreeSpins && (
          <OlympusBuyButton
            spins={FREE_SPINS_COUNT}
            price={freeSpinsCost === undefined ? undefined : amount(freeSpinsCost)}
            disabled={spinning}
            onBuy={handleBuy}
          />
        )}

        <OlympusBetStepper
          value={amount(bet)}
          atMin={betIndex === 0}
          atMax={betIndex >= stakes.length - 1}
          disabled={spinning}
          onStep={(dir) =>
            onBetIndexChange(Math.min(stakes.length - 1, Math.max(0, betIndex + dir)))
          }
        />

        <div
          ref={multRef}
          className={`oly-mult ${multiplier > 0 ? "oly-mult-on" : ""}`}
          aria-live="polite"
        >
          <span className="oly-mult-value">{multiplier > 0 ? `${multiplier}x` : "—"}</span>
          <span className="oly-mult-label">Multiplier</span>
        </div>

        <OlympusSpinButton spinning={spinning} charged={view.charged} onSpin={handleSpin} />
      </div>

      {flyers.map((f) => (
        <div
          key={f.id}
          className="oly-flyer"
          style={
            {
              left: f.x,
              top: f.y,
              "--dx": `${f.dx}px`,
              "--dy": `${f.dy}px`,
            } as React.CSSProperties
          }
        >
          <OlyOrbArt value={f.value} />
        </div>
      ))}
    </div>
  );
}

function MachineStyles() {
  return (
    <style>{`
      /* The board grows with the viewport instead of sitting small in the
         middle of a big screen — floors at a usable size on a 375px phone,
         caps before it outgrows a 1920px desktop. */
      /* The vh term budgets for the plaque and control bar stacked above and
         below the board, not just the five rows — capping on rows alone
         overflowed the viewport and put scrollbars on the scene. */
      .oly-machine { --cell: clamp(44px, min(7vw, 11.4vh), 140px); --gap: clamp(4px, 0.5vw, 9px); position: relative; display: flex; flex-direction: column; align-items: center; width: 100%; }

      /* ---------------------------------------------------------- plaque */
      .oly-plaque { position: relative; z-index: 3; display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: clamp(190px, 20vw, 300px); margin-bottom: calc(var(--gap) * -1.6); padding: 5px clamp(20px, 2.4vw, 40px) 9px; border-radius: 0 0 16px 16px; background: linear-gradient(180deg, #5c0f10, #2a0507); border: 2px solid #d78a2c; border-top: none; box-shadow: 0 8px 22px rgba(0,0,0,0.45), inset 0 -2px 10px rgba(0,0,0,0.6); opacity: 0; transform: translateY(-6px); transition: opacity 200ms ease, transform 200ms ease; }
      .oly-plaque-on { opacity: 1; transform: translateY(0); }
      .oly-plaque-label { font-family: Cinzel, Georgia, serif; font-size: clamp(9px, 0.85vw, 13px); letter-spacing: 0.16em; color: #f2c877; }
      .oly-plaque-amount { font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 800; font-size: clamp(17px, 1.9vw, 30px); line-height: 1; color: #fff4d2; text-shadow: 0 0 14px rgba(255,190,80,0.65); }

      /* ----------------------------------------------------------- frame */
      .oly-frame { --frame-pad: clamp(12px, 1.5vw, 28px); position: relative; padding: var(--frame-pad); border-radius: clamp(12px, 1.2vw, 22px);
        border: clamp(9px, 1.05vw, 20px) solid transparent;
        background-origin: border-box;
        background-clip: padding-box, border-box;
        background-image:
          linear-gradient(168deg, #5a2a4d 0%, #3a1630 55%, #2b0f24 100%),
          linear-gradient(150deg, #fdf3c4 0%, #f6c95f 15%, #d78a2c 34%, #8b4415 50%, #d78a2c 66%, #f6c95f 84%, #fdf3c4 100%);
        box-shadow: 0 0 0 2px rgba(77,33,16,0.9), 0 26px 70px -18px rgba(20,4,20,0.9),
          inset 0 0 0 2px rgba(255,243,196,0.45), inset 0 2px 30px rgba(0,0,0,0.6);
      }
      /* Bright inner lip, so the gold band reads as moulded rather than flat. */
      .oly-frame::before { content: ""; position: absolute; inset: clamp(4px, 0.5vw, 9px); border-radius: clamp(8px, 0.9vw, 16px);
        border: 1px solid rgba(255,243,196,0.3); pointer-events: none; }

      .oly-boss { position: absolute; width: clamp(12px, 1.5vw, 28px); height: clamp(12px, 1.5vw, 28px); border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #fff6d4, #f6c95f 42%, #a3541b 100%);
        box-shadow: 0 1px 3px rgba(40,12,4,0.8), inset 0 -2px 4px rgba(90,40,10,0.6); pointer-events: none; z-index: 4; }
      .oly-boss::after { content: ""; position: absolute; inset: 32%; border-radius: 50%; background: rgba(77,33,16,0.55); }
      .oly-boss-tl { top: clamp(-6px, -0.5vw, -3px); left: clamp(-6px, -0.5vw, -3px); }
      .oly-boss-tr { top: clamp(-6px, -0.5vw, -3px); right: clamp(-6px, -0.5vw, -3px); }
      .oly-boss-bl { bottom: clamp(-6px, -0.5vw, -3px); left: clamp(-6px, -0.5vw, -3px); }
      .oly-boss-br { bottom: clamp(-6px, -0.5vw, -3px); right: clamp(-6px, -0.5vw, -3px); }

      /* Refills fall in from above the board, so the grid is clipped along
         its top — at the gold rail's inner edge, which leaves room for the top
         row's glow — and symbols slide out from under the frame instead of
         showing over the sky (and, on a phone, over Zeus). Only the top: the
         other sides stay open so edge badges keep their wings. */
      .oly-grid { display: flex; gap: var(--gap);
        clip-path: inset(calc(-1 * var(--frame-pad)) -100vmax -100vmax -100vmax); }
      .oly-col { display: flex; flex-direction: column; gap: var(--gap); }
      .oly-cell { position: relative; width: var(--cell); height: var(--cell); border-radius: clamp(6px, 0.6vw, 12px);
        background: linear-gradient(160deg, rgba(120,52,102,0.55), rgba(43,15,36,0.75));
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -6px 14px rgba(0,0,0,0.35);
        display: flex; align-items: center; justify-content: center;
        transition: box-shadow 160ms ease, background 160ms ease; }
      .oly-sym { width: 90%; height: 90%; display: block; object-fit: contain; -webkit-user-drag: none; user-select: none;
        filter: drop-shadow(0 3px 6px rgba(0,0,0,0.55)); }
      /* The winged badge is about 3:2, so held inside a square cell its orb
         would shrink to a fraction of the symbols beside it. It is sized past
         the cell instead, and its wings reach out over the gap. */
      .oly-badge { width: 140%; height: auto; max-width: none; }

      /* -------------------------------------------------------- cascade */
      /* One keyframe covers both cases: a survivor sliding down into a gap
         and a replacement falling in from above the board differ only in how
         many rows they travel (--drop). */
      @keyframes olyDrop {
        0% { transform: translateY(calc(-1 * var(--drop) * (var(--cell) + var(--gap)))); }
        100% { transform: translateY(0); }
      }
      .oly-cell.oly-drop { animation: olyDrop ${DROP_MS}ms cubic-bezier(0.36, 1.32, 0.62, 1) backwards; animation-delay: calc(var(--col) * ${COL_STAGGER_MS}ms); }

      .oly-cell.oly-lit { background: radial-gradient(70% 70% at 50% 45%, rgba(255,214,120,0.35), rgba(120,52,102,0.5)); box-shadow: inset 0 0 0 2px #f6c95f, 0 0 22px 4px rgba(255,180,60,0.55); z-index: 2; }
      .oly-cell.oly-lit .oly-sym { animation: olyThrob ${HIGHLIGHT_MS}ms ease-in-out; }
      @keyframes olyThrob {
        0%, 100% { transform: scale(1); filter: drop-shadow(0 3px 5px rgba(0,0,0,0.5)); }
        40% { transform: scale(1.16); filter: drop-shadow(0 0 14px rgba(255,220,130,0.95)); }
      }

      @keyframes olyPop {
        0% { transform: scale(1); opacity: 1; }
        40% { transform: scale(1.22); opacity: 1; }
        100% { transform: scale(0.15); opacity: 0; }
      }
      .oly-cell.oly-pop { animation: olyPop ${POP_MS}ms ease-in forwards; z-index: 2; }

      /* --------------------------------------------------- multiplier orb */
      /* Raised so the wings sit over the neighbouring cells rather than
         under whichever of them comes later in the DOM. */
      .oly-cell-orb { z-index: 1; background: radial-gradient(65% 65% at 50% 45%, rgba(255,180,60,0.28), rgba(43,15,36,0.75)); }
      .oly-cell.oly-charged { box-shadow: inset 0 0 0 2px rgba(255,214,110,0.95), 0 0 34px 10px rgba(255,160,40,0.75); z-index: 3; }
      .oly-cell.oly-charged .oly-sym { animation: olyCharge ${STRIKE_MS}ms ease-in-out infinite; }
      @keyframes olyCharge {
        0%, 100% { transform: scale(1) rotate(0deg); filter: brightness(1); }
        45% { transform: scale(1.3) rotate(-6deg); filter: brightness(1.6) drop-shadow(0 0 18px rgba(255,200,90,1)); }
      }

      /* The badge itself flies to the counter, so the value you watch leave
         the board is the one that lands on the multiplier. */
      .oly-flyer { position: fixed; z-index: 90; width: calc(var(--cell) * 1.3); transform: translate(-50%, -50%); pointer-events: none;
        animation: olyFly ${FLY_MS}ms cubic-bezier(0.4, 0, 0.5, 1) both; }
      .oly-flyer .oly-badge { width: 100%; filter: drop-shadow(0 0 14px rgba(255,190,70,0.85)); }
      @keyframes olyFly {
        0% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
        70% { opacity: 1; }
        100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.35); opacity: 0; }
      }

      /* ----------------------------------------------------- win banner */
      .oly-banner { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; pointer-events: none;
        animation: olyBanner 2600ms cubic-bezier(0.2, 0.85, 0.25, 1) forwards; }
      @keyframes olyBanner {
        0% { opacity: 0; transform: scale(0.72); }
        10% { opacity: 1; transform: scale(1.07); }
        18% { transform: scale(1); }
        84% { opacity: 1; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.02); }
      }
      .oly-banner::before { content: ""; position: absolute; inset: -10%; background: radial-gradient(50% 50% at 50% 50%, rgba(255,190,70,0.45), transparent 72%); }
      .oly-banner-label { position: relative; font-family: Cinzel, Georgia, serif; font-weight: 700; font-size: clamp(13px, 1.5vw, 24px); letter-spacing: 0.2em; color: #ffe9a8; text-shadow: 0 2px 10px rgba(120,40,0,0.9); }
      .oly-banner-amount { position: relative; font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 800; font-size: clamp(38px, 6vw, 108px); line-height: 0.95;
        background: linear-gradient(180deg, #fff7d6 0%, #ffd968 42%, #f0a01e 70%, #ffe89b 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
        filter: drop-shadow(0 3px 0 #7a3606) drop-shadow(0 0 26px rgba(255,180,60,0.75)); }
      .oly-banner-mult { position: relative; font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 700; font-size: clamp(13px, 1.5vw, 24px); letter-spacing: 0.05em; color: #ffdf9a; text-shadow: 0 2px 8px rgba(90,20,0,0.9); }
      .oly-banner-mega .oly-banner-amount { font-size: clamp(44px, 7.4vw, 132px); }
      .oly-banner-mega::before, .oly-banner-big::before { background: radial-gradient(50% 50% at 50% 50%, rgba(255,215,110,0.6), transparent 74%); animation: olyFlare 2600ms ease-out forwards; }
      @keyframes olyFlare { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; } }

      /* ------------------------------------------------ free spins intro */
      /* Covers the board while the batch is dealt, so the first free spin
         drops onto a clean reveal rather than straight after the click. */
      .oly-intro { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; pointer-events: none;
        border-radius: clamp(6px, 0.6vw, 12px);
        background: radial-gradient(60% 55% at 50% 50%, rgba(92,15,16,0.94), rgba(42,5,7,0.88) 70%, rgba(26,4,12,0.74));
        animation: olyIntro ${INTRO_MS}ms cubic-bezier(0.2, 0.85, 0.25, 1) both; }
      @keyframes olyIntro {
        0% { opacity: 0; transform: scale(0.9); }
        14% { opacity: 1; transform: scale(1.03); }
        22% { transform: scale(1); }
        86% { opacity: 1; }
        100% { opacity: 0; }
      }
      .oly-intro-count { font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 800; font-size: clamp(64px, 9vw, 160px); line-height: 0.9;
        background: linear-gradient(180deg, #fff7d6 0%, #ffd968 42%, #f0a01e 70%, #ffe89b 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
        filter: drop-shadow(0 3px 0 #7a3606) drop-shadow(0 0 26px rgba(255,180,60,0.7)); }
      .oly-intro-label { font-family: Cinzel, Georgia, serif; font-weight: 700; font-size: clamp(18px, 2.2vw, 36px); letter-spacing: 0.12em; color: #ffe9a8; text-shadow: 0 2px 10px rgba(120,40,0,0.9); }
      .oly-intro-note { margin-top: 6px; font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 700; font-size: clamp(12px, 1.2vw, 18px); color: #f2c877; }
      .oly-banner-summary, .oly-banner-summary::before { animation-duration: ${SUMMARY_MS}ms; }

      /* ------------------------------------------------------- controls */
      .oly-controls { display: flex; align-items: center; justify-content: center; gap: clamp(14px, 2vw, 40px); margin-top: clamp(12px, 1.4vw, 26px); }
      .oly-readout, .oly-mult { display: flex; flex-direction: column; align-items: center; line-height: 1.05; min-width: clamp(74px, 7vw, 120px); }
      .oly-readout-label, .oly-mult-label { font-family: Cinzel, Georgia, serif; font-size: clamp(9px, 0.8vw, 12px); letter-spacing: 0.16em; color: #e0b878; }
      .oly-readout-value, .oly-mult-value { font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 800; font-size: clamp(18px, 1.9vw, 30px); color: #fff1cd; }
      .oly-mult { padding: 5px clamp(10px, 1vw, 18px); border-radius: 12px; border: 1px solid rgba(246,201,95,0.3); background: rgba(43,15,36,0.55); transition: border-color 200ms ease, box-shadow 200ms ease; }
      .oly-mult-on { border-color: #f6c95f; box-shadow: 0 0 22px rgba(255,180,60,0.55); }
      .oly-mult-on .oly-mult-value { color: #ffd45e; text-shadow: 0 0 16px rgba(255,190,70,0.9); }

      /* The spin medallion and the bet coins carry their own styles — see
         OlympusSpinButton and OlympusBetStepper. The readout classes above are
         shared: the stepper dresses its amount as one of them. */

      @media (max-width: 640px) {
        /* Six cells plus the gaps, frame padding, border and the scene's own
           side padding all have to fit 100vw — 13.4vw per cell overflowed a
           375px screen by about 12px. */
        .oly-machine { --cell: clamp(40px, 12.4vw, 70px); --gap: 4px; }
        .oly-frame { --frame-pad: 8px; border-width: 7px; }
        /* Four items now have to cross a 375px screen — the feature coin, the
           bet group, the multiplier and the medallion — so the gaps and the
           two readouts give up what they can. The bet coins shrink with them;
           see OlympusBetStepper. */
        .oly-controls { gap: 8px; }
        .oly-readout, .oly-mult { min-width: 54px; }
        .oly-mult { padding: 4px 7px; }
      }

      /* Motion here is the whole point of the piece, so reduced motion keeps
         the sequence but drops the travel, scaling and spin. */
      @media (prefers-reduced-motion: reduce) {
        .oly-cell.oly-drop, .oly-cell.oly-pop, .oly-flyer, .oly-banner,
        .oly-cell.oly-lit .oly-sym, .oly-cell.oly-charged .oly-sym {
          animation-duration: 1ms; animation-iteration-count: 1;
        }
        /* Held still for its whole beat rather than collapsed to 1ms, which
           would end it at its faded-out last frame before anyone read it. */
        .oly-intro { animation: none; }
      }
    `}</style>
  );
}
