import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { GameInfoButton } from "../ui/GameInfoButton";
import { GameInfoPanel } from "../ui/GameInfoPanel";
import { GAME_INFO } from "../../lib/gameInfo";
import { formatChips } from "../../lib/utils";
import { useCrash } from "../../hooks/useCrash";
import { playWinChime, playLoseThud } from "../../lib/sound";

// Mirrors supabase/functions/crash/engine.ts — cosmetic only, the server
// independently recomputes and is authoritative at cash-out time.
const GROWTH_RATE = 0.115;
// Mirrors engine.ts's MAX_CRASH_POINT — the crash point can never exceed
// this, so once the live multiplier reaches it the round is guaranteed to
// bust. Auto-trigger the cash-out request at that point rather than letting
// the animation climb forever waiting on a click that can no longer help.
const MAX_MULTIPLIER = 1000;
// The flight-path curve plots elapsed time against the *raw* multiplier
// (not its logarithm), so it renders as a true exponential hockey-stick —
// flat at first, then bending sharply upward — matching real crash-game
// visuals instead of a straight, constant-speed climb.
// Below this multiplier the view window stays fixed, so the initial curve
// is clearly visible rather than over-zoomed-out from the first frame.
const BASE_VIEW_CAP = 4;
const BASE_VIEW_SPAN = Math.log(BASE_VIEW_CAP) / GROWTH_RATE;
// Once the flight runs past the base window, the view keeps expanding so
// the current point always sits at ~78% of the visible track — the rocket
// keeps gently creeping forward for the whole round instead of hitting a
// hard ceiling and freezing.
const VIEW_MARGIN = 0.78;
// Track margins, in % of the scene box, that the flight path is drawn within.
const TRACK_LEFT = 5;
const TRACK_WIDTH = 84;
const TRACK_BOTTOM = 8;
const TRACK_HEIGHT = 76;
const PATH_SAMPLES = 40;
// Starfield parallax: scroll speed (px/sec at 1x) scales with the current
// multiplier the same way the flight path's own vertical speed does, so the
// background visibly streaks past faster as the round climbs. Two layers at
// different speeds/sizes give it depth.
const STAR_NEAR_SPEED = 70;
const STAR_FAR_SPEED = 25;
// Scroll speed keeps scaling with the multiplier up to this point, then
// holds steady — otherwise, since it tracks the same uncapped exponential as
// the flight path, it'd keep accelerating for the whole 1000x auto-cashout
// range and the background would turn into an unreadable blur.
const STAR_SPEED_CAP_MULT = 25;
const STAR_SPEED_CAP_TIME = Math.log(STAR_SPEED_CAP_MULT) / GROWTH_RATE;
const STAR_SCROLL_AT_CAP = (STAR_SPEED_CAP_MULT - 1) / GROWTH_RATE;

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface Props {
  casinoId: string;
  gameId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

// Precomputed particle bursts (deterministic so every celebration/break looks
// intentional rather than random-jittery) — mirrors Dice's CASH_PARTICLES.
const CASH_PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const angle = (i - 4.5) * 16;
  return { angle, dist: 90 + (i % 3) * 45, delay: (i % 5) * 40, spin: i % 2 === 0 ? 240 : -240 };
});
const DEBRIS_PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const angle = (i - 4.5) * 16;
  return { angle, dist: 90 + (i % 3) * 45, delay: (i % 5) * 30, spin: i % 2 === 0 ? 180 : -180 };
});

export function Crash({ casinoId, gameId, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { state, loading, error: reqError, start, cashOut } = useCrash(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [liveMultiplier, setLiveMultiplier] = useState(1);
  const [showInfo, setShowInfo] = useState(false);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [sceneSize, setSceneSize] = useState({ w: 800, h: 500 });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Measures the scene box so the flight path can be drawn in real pixel
  // coordinates (a plain 0-100 viewBox would stretch the stroke and distort
  // the curve on non-square layouts).
  useLayoutEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSceneSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;

  const hasActiveRound = state?.status === "active";
  const isComplete = state?.status === "complete";

  // Live-render the public growth formula while a round is active. Purely
  // cosmetic — the server independently recomputes and is authoritative.
  useEffect(() => {
    if (!hasActiveRound || !state) {
      setLiveMultiplier(1);
      return;
    }
    // Anchor to the client's own clock the instant the round becomes active,
    // rather than the server's absolute `startedAt` timestamp — comparing
    // two different clocks (client Date.now() vs. the server's clock) is
    // unreliable whenever they're skewed, which showed up as a badly
    // desynced multiplier in manual testing. This is purely cosmetic
    // rendering anyway (the server is authoritative at cash-out), so a
    // client-relative timer is both simpler and correct.
    const localStart = Date.now();
    let frame: number;
    function tick() {
      const elapsed = (Date.now() - localStart) / 1000;
      const mult = Math.exp(GROWTH_RATE * elapsed);
      if (mult >= MAX_MULTIPLIER) {
        setLiveMultiplier(MAX_MULTIPLIER);
        handleCashOut();
        return;
      }
      setLiveMultiplier(mult);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hasActiveRound, state]);

  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  async function handleBet() {
    if (loading || hasActiveRound || !betValid) return;
    setFormError(null);
    try {
      const res = await start(bet);
      setLocalBalance(res.balance);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Bet failed");
    }
  }

  async function handleCashOut() {
    if (loading || !state || state.status !== "active") return;
    setFormError(null);
    try {
      const res = await cashOut();
      setLocalBalance(res.balance);
      if (res.outcome === "cashed_out") {
        playWinChime();
      } else {
        playLoseThud();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Cash out failed");
    }
  }

  const currentPayout = state ? roundMoney(state.bet * liveMultiplier) : 0;

  const displayMultiplier = hasActiveRound
    ? liveMultiplier
    : isComplete
    ? state!.outcome === "cashed_out"
      ? state!.cashedOutAt!
      : state!.crashPoint!
    : 1;

  const rocketVisible = !isComplete || state!.outcome === "cashed_out";

  // elapsedSec is derived rather than tracked, since displayMultiplier already
  // encodes it via the same exp(rate*t) formula for every state (idle/active/
  // complete) — this keeps the frozen post-round curve consistent for free.
  const elapsedSec = Math.log(displayMultiplier) / GROWTH_RATE;
  const viewCap = Math.max(BASE_VIEW_CAP, displayMultiplier / VIEW_MARGIN);
  const viewSpan = Math.max(BASE_VIEW_SPAN, elapsedSec / VIEW_MARGIN);

  function flightPoint(tSec: number) {
    const m = Math.exp(GROWTH_RATE * tSec);
    const leftPct = TRACK_LEFT + (tSec / viewSpan) * TRACK_WIDTH;
    const bottomPct = TRACK_BOTTOM + ((m - 1) / (viewCap - 1)) * TRACK_HEIGHT;
    return {
      x: (leftPct / 100) * sceneSize.w,
      yTop: sceneSize.h - (bottomPct / 100) * sceneSize.h,
      bottomPx: (bottomPct / 100) * sceneSize.h,
    };
  }

  const pathPoints = Array.from({ length: PATH_SAMPLES + 1 }, (_, i) => flightPoint((elapsedSec * i) / PATH_SAMPLES));
  const pathD = pathPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.yTop.toFixed(1)}`).join(" ");
  const rocketPoint = pathPoints[pathPoints.length - 1];

  // Tangent angle of the curve at the current point, via its analytic
  // derivative — so the rocket's nose points along its direction of travel
  // instead of a fixed tilt.
  const dyPxPerSec = ((GROWTH_RATE * displayMultiplier) / (viewCap - 1)) * (TRACK_HEIGHT / 100) * sceneSize.h;
  const dxPxPerSec = (1 / viewSpan) * (TRACK_WIDTH / 100) * sceneSize.w;
  const rocketAngle = state ? Math.max(0, Math.min(80, (Math.atan2(dxPxPerSec, dyPxPerSec) * 180) / Math.PI)) : 0;

  // Closed-form integral of speed*min(multiplier(t), CAP) dt — grows in
  // lockstep with the rocket's own exponential climb (same trick as
  // elapsedSec above) up to STAR_SPEED_CAP_MULT, then continues at that
  // constant capped speed instead of keeping pace with the uncapped climb.
  const starScroll = reducedMotion
    ? 0
    : displayMultiplier <= STAR_SPEED_CAP_MULT
    ? (displayMultiplier - 1) / GROWTH_RATE
    : STAR_SCROLL_AT_CAP + STAR_SPEED_CAP_MULT * (elapsedSec - STAR_SPEED_CAP_TIME);
  const nearStarOffset = STAR_NEAR_SPEED * starScroll;
  const farStarOffset = STAR_FAR_SPEED * starScroll;

  return (
    <div
      className="relative bg-card overflow-hidden flex flex-col rounded-2xl"
      style={{ width: "min(98vw, 1300px)", height: "min(90vh, 760px)" }}
    >
      <CrashStyles />
      <div className="flex items-center justify-between px-4 py-2 sm:px-5 sm:py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Crash</p>
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

      {isComplete && (
        <div
          className={`px-5 py-2 text-center font-bold text-white text-sm shrink-0 ${
            state!.outcome === "cashed_out" ? "bg-emerald-700" : "bg-red-900/80"
          }`}
        >
          {state!.outcome === "cashed_out"
            ? `Cashed out at ${state!.cashedOutAt!.toFixed(2)}x — it would have busted at ${state!.crashPoint!.toFixed(2)}x`
            : `Busted at ${state!.crashPoint!.toFixed(2)}x`}
        </div>
      )}

      {isComplete && state!.outcome === "cashed_out" && (
        <div
          key={`win-${state!.roundId}`}
          className="cx-win-overlay absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          {CASH_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="cx-cash"
              style={{
                "--cx-rot": `${p.angle}deg`,
                "--cx-dist": `-${p.dist}px`,
                "--cx-spin": `${p.spin}deg`,
                animationDelay: `${p.delay}ms`,
              } as CSSProperties}
            >
              💵
            </span>
          ))}
          <p className="cx-win-text text-3xl font-black text-emerald-400 drop-shadow-[0_2px_8px_rgba(16,185,129,0.6)]">
            +{formatChips(state!.payout ?? 0)} chips
          </p>
        </div>
      )}

      {isComplete && state!.outcome === "busted" && (
        <div
          key={`bust-${state!.roundId}`}
          className="cx-bust-overlay absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          {DEBRIS_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="cx-debris"
              style={{
                "--cx-rot": `${p.angle}deg`,
                "--cx-dist": `-${p.dist}px`,
                "--cx-spin": `${p.spin}deg`,
                animationDelay: `${p.delay}ms`,
              } as CSSProperties}
            >
              💥
            </span>
          ))}
          <p className="cx-bust-text text-3xl font-black text-red-400 drop-shadow-[0_2px_8px_rgba(239,68,68,0.6)]">
            Busted at {state!.crashPoint!.toFixed(2)}x
          </p>
        </div>
      )}

      {showInfo ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <GameInfoPanel info={GAME_INFO.crash} onBack={() => setShowInfo(false)} />
        </div>
      ) : (
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-auto">
        <div className="flex flex-col gap-3 p-4 md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border">
          <div>
            <label className="text-xs text-muted-foreground">Bet Amount</label>
            <input
              type="number"
              min={0}
              value={betText}
              onChange={(e) => setBetText(e.target.value)}
              disabled={loading || hasActiveRound}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => adjustBet(0.5)}
                disabled={loading || hasActiveRound}
                className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                ½
              </button>
              <button
                type="button"
                onClick={() => adjustBet(2)}
                disabled={loading || hasActiveRound}
                className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                2×
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Min {formatChips(minBet)} · Max {formatChips(maxBet)}
            </p>
          </div>

          <Button
            onClick={hasActiveRound ? handleCashOut : handleBet}
            disabled={loading || (!hasActiveRound && !betValid)}
            className="mt-1 h-11 text-base font-bold"
          >
            {loading ? "…" : hasActiveRound ? `Cash Out ${formatChips(currentPayout)} chips` : "Bet"}
          </Button>

          {(formError || reqError) && <p className="text-xs text-destructive">{formError ?? reqError}</p>}
        </div>

        <div ref={sceneRef} className="cx-scene relative flex flex-1 items-center justify-center min-w-0 overflow-hidden">
          <div className="cx-stars-far absolute inset-0" style={{ backgroundPosition: `0 ${farStarOffset}px` }} />
          <div className="cx-stars-near absolute inset-0" style={{ backgroundPosition: `0 ${nearStarOffset}px` }} />
          <p className="cx-readout absolute top-4 right-5 font-mono font-black text-amber-400">
            {displayMultiplier.toFixed(2)}x
          </p>
          <svg
            className="cx-trail-svg absolute inset-0"
            width={sceneSize.w}
            height={sceneSize.h}
            style={{ opacity: rocketVisible ? 1 : 0 }}
          >
            <defs>
              <linearGradient id="cxTrailGradient" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(251,146,60,0)" />
                <stop offset="35%" stopColor="rgba(251,146,60,0.65)" />
                <stop offset="100%" stopColor="rgba(253,186,116,1)" />
              </linearGradient>
            </defs>
            <path d={pathD} fill="none" stroke="url(#cxTrailGradient)" strokeWidth={3} strokeLinecap="round" />
          </svg>
          <div
            className="cx-rocket absolute"
            style={{
              left: `${rocketPoint.x}px`,
              bottom: `${rocketPoint.bottomPx}px`,
              transform: `translateX(-50%) rotate(${rocketAngle}deg)`,
              opacity: rocketVisible ? 1 : 0,
            }}
          >
            <div className="cx-rocket-body" />
            <div className="cx-rocket-flame" />
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

// Scoped styles: starfield backdrop, rocket sprite, and win/bust feedback.
// Everything finishes within ~950ms; reduced-motion disables all of it.
function CrashStyles() {
  return (
    <style>{`
      .cx-scene {
        background: linear-gradient(180deg, #0a0e27 0%, #1a1040 60%, #2d1b4e 100%);
      }
      .cx-stars-far, .cx-stars-near {
        background-repeat: repeat;
        will-change: background-position;
      }
      .cx-stars-far {
        background-image:
          radial-gradient(1px 1px at 8% 12%, white, transparent),
          radial-gradient(1px 1px at 24% 48%, white, transparent),
          radial-gradient(1px 1px at 41% 8%, white, transparent),
          radial-gradient(1px 1px at 57% 62%, white, transparent),
          radial-gradient(1px 1px at 68% 28%, white, transparent),
          radial-gradient(1px 1px at 79% 84%, white, transparent),
          radial-gradient(1px 1px at 88% 45%, white, transparent),
          radial-gradient(1px 1px at 15% 78%, white, transparent),
          radial-gradient(1px 1px at 33% 92%, white, transparent),
          radial-gradient(1px 1px at 94% 15%, white, transparent);
        background-size: 340px 340px;
        opacity: 0.45;
      }
      .cx-stars-near {
        background-image:
          radial-gradient(2px 2px at 12% 22%, white, transparent),
          radial-gradient(1.5px 1.5px at 27% 65%, white, transparent),
          radial-gradient(2px 2px at 45% 18%, white, transparent),
          radial-gradient(1.5px 1.5px at 63% 78%, white, transparent),
          radial-gradient(2.5px 2.5px at 71% 38%, white, transparent),
          radial-gradient(1.5px 1.5px at 85% 88%, white, transparent),
          radial-gradient(2px 2px at 92% 55%, white, transparent),
          radial-gradient(1.5px 1.5px at 18% 90%, white, transparent),
          radial-gradient(2px 2px at 38% 42%, white, transparent),
          radial-gradient(1.5px 1.5px at 55% 8%, white, transparent);
        background-size: 260px 260px;
        opacity: 0.75;
      }
      .cx-readout {
        font-size: clamp(28px, 3.4vw, 52px);
        text-shadow: 0 0 12px rgba(251, 191, 36, 0.6);
      }
      .cx-rocket {
        width: clamp(28px, 3vw, 44px);
        height: clamp(46px, 5vw, 74px);
        /* Pivot at the bottom-center — the exact point positioned at the
           trail's tip — instead of the sprite's own center. Rotating around
           the center swings that point away from the line as the tilt
           increases, making the rocket look detached from its own trail. */
        transform-origin: 50% 100%;
        /* No transition on left/bottom: the trail SVG redraws instantly every
           animation frame, and a smoothing transition here would make the
           rocket visibly lag behind its own trail tip once movement is fast
           and diagonal (found by testing — looked disconnected at high accel). */
        transition: opacity 300ms ease-out;
      }
      .cx-trail-svg {
        overflow: visible;
        filter: drop-shadow(0 0 5px rgba(249, 115, 22, 0.6)) drop-shadow(0 0 12px rgba(251, 146, 60, 0.35));
        transition: opacity 300ms ease-out;
      }
      .cx-rocket-body {
        width: 100%;
        height: 100%;
        background: linear-gradient(180deg, #e2e8f0, #94a3b8);
        border-radius: 50% 50% 20% 20%;
      }
      .cx-rocket-flame {
        position: absolute;
        bottom: -18px;
        left: 50%;
        transform: translateX(-50%);
        width: 40%;
        height: 24px;
        background: linear-gradient(180deg, #fb923c, #ef4444, #fbbf24);
        border-radius: 0 0 50% 50%;
        filter: blur(1px);
        animation: cxFlameFlicker 200ms ease-in-out infinite alternate;
      }
      @keyframes cxFlameFlicker {
        0%   { transform: translateX(-50%) scaleY(1); }
        100% { transform: translateX(-50%) scaleY(0.8); }
      }

      .cx-win-overlay, .cx-bust-overlay {
        animation: cxOverlayFade 950ms ease-out both;
      }
      @keyframes cxOverlayFade {
        0%, 70% { opacity: 1; }
        100%    { opacity: 0; }
      }

      .cx-win-text, .cx-bust-text {
        animation: cxTextPop 950ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes cxTextPop {
        0%   { opacity: 0; transform: scale(0.5) translateY(16px); }
        25%  { opacity: 1; transform: scale(1.12) translateY(0); }
        40%  { transform: scale(1); }
        100% { opacity: 1; transform: scale(1); }
      }

      .cx-cash, .cx-debris {
        position: absolute;
        top: 50%; left: 50%;
        font-size: 22px;
        line-height: 1;
        animation: cxParticleFly 800ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      }
      @keyframes cxParticleFly {
        0% {
          opacity: 1;
          transform: translate(-50%, -50%) rotate(var(--cx-rot)) translateY(0) rotate(0deg) scale(0.6);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) rotate(var(--cx-rot)) translateY(var(--cx-dist)) rotate(var(--cx-spin)) scale(1.1);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cx-cash, .cx-debris, .cx-rocket-flame { display: none; animation: none; }
        .cx-win-overlay, .cx-bust-overlay, .cx-win-text, .cx-bust-text { animation: none; }
        .cx-win-overlay, .cx-bust-overlay { opacity: 0; }
        .cx-rocket, .cx-trail-svg { transition: none; }
      }
    `}</style>
  );
}
