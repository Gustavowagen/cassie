import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { formatChips } from "../../lib/utils";
import { useCrash } from "../../hooks/useCrash";
import { playWinChime, playLoseThud } from "../../lib/sound";

// Mirrors supabase/functions/crash/engine.ts — cosmetic only, the server
// independently recomputes and is authoritative at cash-out time.
const GROWTH_RATE = 0.115;
// The rocket sprite reaches the top of its track around this multiplier and
// stays pinned there while the number keeps climbing beyond it (10x is
// already a rare outcome at 1% house edge).
const DISPLAY_CAP = 10;

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
    const startedAt = new Date(state.startedAt).getTime();
    let frame: number;
    function tick() {
      const elapsed = (Date.now() - startedAt) / 1000;
      setLiveMultiplier(Math.exp(GROWTH_RATE * elapsed));
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

  const rocketPct = Math.max(0, Math.min(1, Math.log(displayMultiplier) / Math.log(DISPLAY_CAP)));
  const rocketVisible = !isComplete || state!.outcome === "cashed_out";

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

        <div className="cx-scene relative flex flex-1 items-center justify-center min-w-0 overflow-hidden">
          <div className="cx-stars absolute inset-0" />
          <p className="cx-readout absolute top-4 right-5 font-mono font-black text-amber-400">
            {displayMultiplier.toFixed(2)}x
          </p>
          <div
            className="cx-rocket absolute left-1/2"
            style={{
              bottom: `${8 + rocketPct * 78}%`,
              transform: "translateX(-50%) rotate(-25deg)",
              opacity: rocketVisible ? 1 : 0,
            }}
          >
            <div className="cx-rocket-body" />
            <div className="cx-rocket-flame" />
          </div>
        </div>
      </div>
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
      .cx-stars {
        background-image:
          radial-gradient(2px 2px at 20% 30%, white, transparent),
          radial-gradient(2px 2px at 60% 15%, white, transparent),
          radial-gradient(1px 1px at 80% 40%, white, transparent),
          radial-gradient(1px 1px at 30% 70%, white, transparent),
          radial-gradient(2px 2px at 90% 80%, white, transparent),
          radial-gradient(1px 1px at 45% 85%, white, transparent);
        opacity: 0.6;
      }
      .cx-readout {
        font-size: clamp(28px, 3.4vw, 52px);
        text-shadow: 0 0 12px rgba(251, 191, 36, 0.6);
      }
      .cx-rocket {
        width: clamp(28px, 3vw, 44px);
        height: clamp(46px, 5vw, 74px);
        transition: bottom 80ms linear, opacity 300ms ease-out;
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
        .cx-rocket { transition: none; }
      }
    `}</style>
  );
}
