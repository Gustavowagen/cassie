import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { GameInfoButton } from "../ui/GameInfoButton";
import { GameInfoPanel } from "../ui/GameInfoPanel";
import { formatChips } from "../../lib/utils";
import { useOlympus } from "../../hooks/useOlympus";
import { olympusInfo } from "../../lib/gameInfo";
import {
  DEFAULT_HOUSE_EDGE,
  freeSpinsCost as priceOfBatch,
  roundMoney,
  type OlyFreeSpinsBatch,
  type OlympusRound,
} from "../../lib/olympusEngine";
import { OLY_ART } from "./olympus/olympusAssets";
import { OlyLogo, OlympusDefs } from "./olympus/olympusArt";
import { OlympusMachine } from "./olympus/OlympusMachine";

// Gates of Olympus, as a casino game.
//
// This file owns the scene and everything around the cabinet: the header
// chrome, the balance, the stake ladder bounded by the instance's own bet
// limits, and the calls to the edge function. The cabinet itself — board,
// cascade replay, controls — is OlympusMachine's.
//
// It fills the viewport rather than sitting in the dashboard's modal the way
// the quick games do: it is mounted by the /casino/:slug/play/:gameId route
// (src/pages/CasinoGame.tsx), which is the whole page.
//
// Zeus and the temple are rendered here rather than inside OlympusMachine:
// the machine reports a strike and the scene decides how he answers, so the
// board never reaches into him.

const TOP_FRAME = OLY_ART.zeusFrames.length - 1;
/** Beat between frames on the way up — quick, so four frames read as one lift. */
const RAISE_STEP_MS = 80;
/** How long the trident stays overhead, through the orb's charge-up. */
const HOLD_MS = 1400;
/** Beat between frames on the way down; slower, so he lowers it rather than drops it. */
const LOWER_STEP_MS = 120;

/**
 * The stake ladder the bet coins walk, before the instance's limits narrow it.
 * A 1 / 2 / 5 progression per decade across the full range a casino_games row
 * can be configured to (0.001 up to 10,000,000): coarse enough that a handful
 * of clicks crosses ten orders of magnitude, but with three stops in every
 * decade. Same reasoning as Tumble's COST_LADDER, which solves the same
 * problem for its purchase price.
 */
const STAKE_LADDER = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50,
  100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000,
  500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000,
];

/**
 * The ladder narrowed to one instance's bet limits. Both limits are always
 * themselves stops, so an admin who set 40..600 gets 40 · 50 · 100 · 200 · 500
 * · 600 and both ends of what they allowed stay reachable even though neither
 * is on the ladder proper.
 */
export function stakeLadderFor(min: number, max: number): number[] {
  const lo = roundMoney(Math.max(min, STAKE_LADDER[0]));
  const hi = roundMoney(Math.max(lo, Math.min(max, STAKE_LADDER[STAKE_LADDER.length - 1])));
  if (hi <= lo) return [lo];
  return [lo, ...STAKE_LADDER.filter((v) => v > lo && v < hi), hi];
}

interface Props {
  casinoId: string;
  gameId: string;
  /**
   * Mirrors the edge function's DEFAULT_HOUSE_EDGE fallback
   * (supabase/functions/olympus/engine.ts) for rows whose settings an admin
   * hasn't touched. Display only — the server resolves the edge itself and
   * never trusts this.
   */
  houseEdge: number;
  /** Whether this instance offers the feature buy. */
  freeSpinsEnabled: boolean;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Olympus({
  casinoId,
  gameId,
  houseEdge = DEFAULT_HOUSE_EDGE,
  freeSpinsEnabled,
  balance: initialBalance,
  minBet,
  maxBet,
  onExit,
}: Props) {
  const { spin, buyFreeSpins } = useOlympus(casinoId, gameId);

  const stakes = useMemo(() => stakeLadderFor(minBet, maxBet), [minBet, maxBet]);
  const [betIndex, setBetIndex] = useState(0);
  const bet = stakes[Math.min(betIndex, stakes.length - 1)];

  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  // Zeus's trident.
  const [strikes, setStrikes] = useState(0);
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  const handleStrike = useCallback(() => setStrikes((n) => n + 1), []);

  /**
   * The authoritative balance from the last settled request, parked until the
   * reveal is over.
   *
   * This is the whole of CLAUDE.md's balance rule for a reveal-animated game.
   * The bet comes off the moment it is placed, so the counter never lags the
   * wager; the server's post-round balance — which is what pays any win —
   * lands only when OlympusMachine reports the replay finished. Applied any
   * earlier, the balance would show the win before the board did, which
   * spoils every cascade and every multiplier the animation exists to reveal.
   */
  const pendingBalance = useRef<number | null>(null);

  const applyPending = useCallback(() => {
    if (pendingBalance.current === null) return;
    setLocalBalance(pendingBalance.current);
    pendingBalance.current = null;
  }, []);

  // Deliberately NOT re-synced from the `balance` prop while the game is
  // open. That prop is fed by the realtime casino_members subscription, which
  // fires the moment the edge function writes the new balance — i.e. while the
  // reveal is still playing. Syncing it straight through defeated the whole
  // point of pendingBalance: a bought batch showed its final balance at spin 3
  // of 15, so the counter told the player what the remaining twelve spins were
  // going to do. Seeding once and then driving the value from settled
  // responses is what Tumble and Dice do, for the same reason.

  useEffect(() => {
    if (strikes === 0) return;
    const show = (f: number) => {
      frameRef.current = f;
      setFrame(f);
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    for (let f = frameRef.current + 1; f <= TOP_FRAME; f++) {
      timers.push(setTimeout(() => show(f), at));
      at += RAISE_STEP_MS;
    }
    at += HOLD_MS;
    for (let f = TOP_FRAME - 1; f >= 0; f--) {
      timers.push(setTimeout(() => show(f), at));
      at += LOWER_STEP_MS;
    }
    return () => timers.forEach(clearTimeout);
  }, [strikes]);

  const cost = useMemo(() => priceOfBatch(bet), [bet]);

  const handleSpin = useCallback(
    async (stake: number): Promise<OlympusRound> => {
      setError(null);
      if (stake > localBalance) {
        setError("Not enough chips for that bet");
        throw new Error("insufficient");
      }
      // Deducted unconditionally, before the request is even awaited: the
      // outcome is already decided server-side and the animation is only the
      // reveal, so the stake must leave the counter the instant it is staked.
      setLocalBalance((b) => roundMoney(b - stake));
      try {
        const result = await spin(stake);
        pendingBalance.current = result.balance;
        return result.round;
      } catch (e) {
        // The bet never landed, so roll the optimistic deduction back rather
        // than leaving the player short by a spin that did not happen.
        setLocalBalance((b) => roundMoney(b + stake));
        setError(e instanceof Error ? e.message : "Failed to place bet");
        throw e;
      }
    },
    [spin, localBalance]
  );

  const handleBuy = useCallback(
    async (stake: number): Promise<OlyFreeSpinsBatch> => {
      setError(null);
      const price = priceOfBatch(stake);
      if (price > localBalance) {
        setError(`Free spins cost ${formatChips(price)} chips`);
        throw new Error("insufficient");
      }
      setLocalBalance((b) => roundMoney(b - price));
      try {
        const result = await buyFreeSpins(stake);
        pendingBalance.current = result.balance;
        return result.batch;
      } catch (e) {
        setLocalBalance((b) => roundMoney(b + price));
        setError(e instanceof Error ? e.message : "Failed to buy free spins");
        throw e;
      }
    },
    [buyFreeSpins, localBalance]
  );

  const info = useMemo(() => olympusInfo(houseEdge, freeSpinsEnabled), [houseEdge, freeSpinsEnabled]);

  return (
    <div className="relative bg-card overflow-hidden flex flex-col w-full h-screen h-[var(--app-vvh,100dvh)]">
      <OlympusDefs />
      <SceneStyles />

      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0 relative z-10">
        <div>
          <p className="font-bold text-base">Gates of Olympus</p>
          <p className="text-xs text-muted-foreground">
            Balance: {formatChips(localBalance)} chips
          </p>
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
          <GameInfoPanel info={info} onBack={() => setShowInfo(false)} />
        </div>
      ) : (
        <div className="oly-scene oly-in-page flex-1 min-h-0">
          <div className="oly-backdrop" aria-hidden />
          <div className="oly-veil" aria-hidden />

          <div className="oly-stage">
            <OlympusMachine
              onStrike={handleStrike}
              stakes={stakes}
              betIndex={betIndex}
              onBetIndexChange={setBetIndex}
              onSpin={handleSpin}
              onBuyFreeSpins={freeSpinsEnabled ? handleBuy : undefined}
              freeSpinsCost={freeSpinsEnabled ? cost : undefined}
              onSettled={applyPending}
              formatAmount={formatChips}
            />
          </div>

          <div className="oly-zeus-wrap" aria-hidden>
            <OlyLogo className="oly-logo" />
            {/* All four frames stay mounted and only the current one shows, so
                a frame change is a hard cut between already-decoded images —
                the way a sprite animates. Swapping one src could flash blank
                while the next frame decodes. */}
            <div className="oly-zeus">
              {strikes > 0 && <span className="oly-burst" key={strikes} />}
              {OLY_ART.zeusFrames.map((src, i) => (
                <img
                  key={src}
                  className={[
                    "oly-zeus-img",
                    i === frame ? "oly-zeus-on" : "",
                    i === TOP_FRAME ? "oly-zeus-top" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  src={src}
                  alt=""
                />
              ))}
            </div>
          </div>

          {error && (
            <p className="oly-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SceneStyles() {
  return (
    <style>{`
      /* The scene fills what the header leaves rather than the whole viewport.
         Board and Zeus are one centred lockup, not a centred board with Zeus
         pinned to an edge, which left a dead third of the scene empty at
         desktop widths. */
      .oly-scene { position: relative; width: 100%; overflow: hidden;
        display: flex; align-items: center; justify-content: center; gap: clamp(0px, 1.5vw, 34px);
        padding: clamp(10px, 2vh, 40px) clamp(10px, 1.6vw, 32px); isolation: isolate;
        background: #150a24;
        /* Makes cqh below mean "a percentage of this box", which is the whole
           point of the override that follows. */
        container-type: size; }

      /* OlympusMachine's own --cell is written in vh, which assumes the scene
         is the whole viewport. Here a header sits above it, so a vh-sized
         board runs past the bottom and cuts the controls off — at 1920x1080
         by about 60px. cqh measures the space the board actually has instead
         (the scene declares container-type: size above), so the board fills
         the page at every viewport without ever reaching under the header.
         11.4cqh x 5 rows leaves room for the frame, the plaque above and the
         control bar below. */
      .oly-in-page .oly-machine { --cell: clamp(44px, min(7vw, 11.4cqh), 140px); }

      .oly-backdrop { position: absolute; inset: 0; z-index: -3;
        background: url("${OLY_ART.scene}") center / cover no-repeat;
        filter: brightness(0.6) saturate(1.06); }
      .oly-veil { position: absolute; inset: 0; z-index: -2;
        background:
          radial-gradient(78% 62% at 50% 52%, rgba(28,6,44,0.62) 0%, rgba(28,6,44,0.18) 55%, rgba(28,6,44,0) 100%),
          linear-gradient(180deg, rgba(14,3,26,0.62) 0%, rgba(14,3,26,0) 24%,
            rgba(14,3,26,0) 58%, rgba(11,2,20,0.82) 100%); }

      .oly-stage { position: relative; z-index: 2; flex: 0 1 auto; min-width: 0; }

      .oly-zeus-wrap { position: relative; z-index: 1; flex: 0 0 auto; align-self: stretch;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        gap: clamp(4px, 1vh, 18px); padding: clamp(4px, 1.5vh, 24px) 0; pointer-events: none; }
      .oly-logo { width: clamp(120px, 13vw, 260px); height: auto;
        filter: drop-shadow(0 2px 3px rgba(28,6,0,0.95)) drop-shadow(0 0 16px rgba(24,4,20,0.85))
          drop-shadow(0 6px 22px rgba(20,4,0,0.7)); }

      /* The box is cut to the standing figure: frame one fills only the
         bottom 590px of the 1004px canvas the frames share. The frames are
         anchored to its floor and grow up out of it, so the lifted trident
         rises into the sky rather than the standing pose carrying a tower of
         empty space that would shove the wordmark around. */
      .oly-zeus { position: relative; width: clamp(110px, min(20vw, 26vh), 380px); aspect-ratio: 415 / 590; }
      .oly-zeus-img { position: absolute; bottom: 0; left: 0; width: 100%; height: auto; max-width: none; opacity: 0;
        filter: drop-shadow(6px -2px 10px rgba(255,214,140,0.45)) drop-shadow(-10px 14px 30px rgba(30,4,30,0.7)); }
      .oly-zeus-on { opacity: 1; }

      /* brightness(0) invert(1) crushes the sprite to a pure white silhouette
         through its own alpha, which is what a strike actually looks like.
         Raising brightness instead only washed him out to milk. Every keyframe
         carries the same filter functions in the same order, or the browser
         has nothing to interpolate between. */
      .oly-zeus-top.oly-zeus-on { animation: olyZeusFlash 700ms ease-out; }
      @keyframes olyZeusFlash {
        0% { filter: brightness(0) invert(1) saturate(1)
          drop-shadow(0 0 46px rgba(255,255,255,0.95)) drop-shadow(0 0 66px rgba(150,200,255,0.9)); }
        10% { filter: brightness(1.15) invert(0.35) saturate(0.5)
          drop-shadow(0 0 26px rgba(225,242,255,0.85)) drop-shadow(-6px 10px 26px rgba(30,4,30,0.5)); }
        30% { filter: brightness(1.1) invert(0) saturate(0.95)
          drop-shadow(4px -2px 12px rgba(220,238,255,0.6)) drop-shadow(-10px 14px 30px rgba(30,4,30,0.65)); }
        100% { filter: brightness(1) invert(0) saturate(1)
          drop-shadow(6px -2px 10px rgba(255,214,140,0.45)) drop-shadow(-10px 14px 30px rgba(30,4,30,0.7)); }
      }

      .oly-burst { position: absolute; left: 50%; top: 0; width: 230%; aspect-ratio: 1;
        transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none;
        background: radial-gradient(circle, rgba(255,255,250,1) 0%, rgba(224,240,255,0.95) 15%,
          rgba(140,190,255,0.62) 31%, rgba(70,120,255,0.18) 47%, rgba(50,90,255,0) 64%);
        animation: olyBurst 900ms cubic-bezier(0.1, 0.7, 0.3, 1) forwards; }
      @keyframes olyBurst {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
        8% { opacity: 1; transform: translate(-50%, -50%) scale(0.78); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
      }

      /* Sits over the gold floor at the bottom of the scene. */
      .oly-error { position: absolute; z-index: 4; left: 50%; bottom: clamp(6px, 1.4vh, 18px);
        transform: translateX(-50%); margin: 0; padding: 6px 16px; border-radius: 999px;
        background: rgba(40,6,10,0.92); border: 1px solid #d78a2c;
        font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 600;
        font-size: clamp(11px, 1vw, 14px); color: #ffd8b0; text-align: center;
        max-width: min(90%, 520px); }

      /* Below this the board needs the full width, so the whole Zeus lockup
         steps above it. */
      @media (max-width: 1100px) {
        .oly-zeus-wrap { flex-direction: row; align-self: auto; align-items: flex-end;
          order: -1; padding: 0; margin-bottom: 2px; }
        .oly-scene { flex-direction: column; justify-content: center; gap: clamp(4px, 1.2vh, 14px); }
        .oly-zeus { width: clamp(76px, 14vw, 140px); }
        .oly-logo { width: clamp(110px, 20vw, 190px); }
      }

      /* The lift itself is a handful of hard cuts, not travel, so it stays.
         The flash and the burst are what go. */
      @media (prefers-reduced-motion: reduce) {
        .oly-zeus-top.oly-zeus-on { animation: none; }
        .oly-burst { display: none; }
      }
    `}</style>
  );
}
