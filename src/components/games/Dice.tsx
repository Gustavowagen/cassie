import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { GameInfoButton } from "../ui/GameInfoButton";
import { GameInfoPanel } from "../ui/GameInfoPanel";
import { GAME_INFO } from "../../lib/gameInfo";
import { formatChips } from "../../lib/utils";
import { playTone, playDing } from "../../lib/sound";
import { useDice } from "../../hooks/useDice";
import type { DiceDirection } from "../../types";

// Mirrors supabase/functions/dice/engine.ts — kept as a local, dependency-free
// copy (same pattern as Roulette's own calcPayout) since the edge function
// runs under Deno and isn't bundled into the browser build.
const HOUSE_EDGE = 0.02;
const MIN_WIN_CHANCE = 1;
const MAX_WIN_CHANCE = 95;

function winChanceFor(target: number, direction: DiceDirection): number {
  return direction === "under" ? target : 100 - target;
}
function multiplierFor(winChance: number): number {
  return (100 * (1 - HOUSE_EDGE)) / winChance;
}
function clampWinChance(wc: number): number {
  return Math.min(MAX_WIN_CHANCE, Math.max(MIN_WIN_CHANCE, wc));
}
function targetFromWinChance(winChance: number, direction: DiceDirection): number {
  return winChanceFor(clampWinChance(winChance), direction);
}
function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

// Matches the marker's slide transition (`transition-[left] duration-500`)
// further down — the true outcome isn't revealed until that animation, which
// starts the instant `result` is set, has actually finished sliding.
const REVEAL_MS = 550;

interface Props {
  casinoId: string;
  gameId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

// Precomputed burst of flying bills for the win animation (deterministic so
// every win looks intentional rather than random-jittery).
const CASH_PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const angle = (i - 4.5) * 16; // fan upwards (0deg = straight up after rotate+translateY)
  return {
    angle,
    dist: 90 + (i % 3) * 45,
    delay: (i % 5) * 40,
    spin: i % 2 === 0 ? 240 : -240,
  };
});

export function Dice({ casinoId, gameId, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { result, loading, error: rollError, roll: rollDice } = useDice(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<DiceDirection>("under");
  const [formError, setFormError] = useState<string | null>(null);
  const [winId, setWinId] = useState(0);
  const [showWin, setShowWin] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastTickPctRef = useRef<number | null>(null);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (winId > 0) playDing();
  }, [winId]);

  const busy = loading || revealing;
  const bet = Math.max(0, parseFloat(betText) || 0);
  const winChance = winChanceFor(target, direction);
  const multiplier = multiplierFor(winChance);
  const profitOnWin = roundMoney(bet * (multiplier - 1));
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;

  function setTargetClamped(t: number) {
    const wc = clampWinChance(winChanceFor(t, direction));
    setTarget(winChanceFor(wc, direction));
  }

  // Soft synthesized tick (no audio asset) — pitch rises slightly with
  // position so dragging left-to-right has a subtle "scale" feel.
  function playSlideTick(pct: number) {
    playTone({ freq: 500 + pct * 4, duration: 0.045, volume: 0.06 });
  }

  function updateFromTrackClientX(clientX: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const roundedPct = Math.round(pct * 100);
    if (lastTickPctRef.current !== roundedPct) {
      lastTickPctRef.current = roundedPct;
      playSlideTick(roundedPct);
    }
    setTargetClamped(roundMoney(pct * 100));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (busy) return;
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromTrackClientX(e.clientX);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (busy) return;
    if (!draggingRef.current) return;
    updateFromTrackClientX(e.clientX);
  }
  function onPointerUp() {
    draggingRef.current = false;
  }
  function onPointerCancel() {
    draggingRef.current = false;
  }

  function handleTargetInput(v: string) {
    const n = parseFloat(v);
    if (!isFinite(n)) return;
    setTargetClamped(roundMoney(n));
  }
  function handleWinChanceInput(v: string) {
    const n = parseFloat(v);
    if (!isFinite(n)) return;
    setTarget(targetFromWinChance(n, direction));
  }
  function handleMultiplierInput(v: string) {
    const n = parseFloat(v);
    if (!isFinite(n) || n <= 0) return;
    const wc = (100 * (1 - HOUSE_EDGE)) / n;
    setTarget(targetFromWinChance(wc, direction));
  }
  function swapDirection() {
    setDirection((d) => (d === "under" ? "over" : "under"));
    setTarget((t) => roundMoney(100 - t));
  }
  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  async function handleBet() {
    if (!betValid || busy) return;
    setFormError(null);
    const stake = bet;
    // The bet is lost the instant it's placed, win or lose — the slider's
    // slide is cosmetic and must never gate this deduction.
    setLocalBalance((b) => b - stake);
    // Clear any still-visible celebration from a prior win so this round's
    // outcome (and `result`, which updates as soon as the response lands,
    // well before the reveal below) can't re-trigger the old overlay.
    setShowWin(false);
    try {
      const res = await rollDice(bet, target, direction);
      setRevealing(true);
      revealTimeoutRef.current = setTimeout(() => {
        // Only now reveal the true outcome — this is what credits any payout.
        setLocalBalance(res.balance);
        if (res.won) {
          setWinId((id) => id + 1);
          setShowWin(true);
        }
        setRevealing(false);
      }, REVEAL_MS);
    } catch (err) {
      setLocalBalance((b) => b + stake); // roll back the optimistic deduction
      setFormError(err instanceof Error ? err.message : "Bet failed");
    }
  }

  const zoneSplitPct = Math.min(100, Math.max(0, target));
  const markerPct = result ? Math.min(100, Math.max(0, result.roll)) : null;

  return (
    <div
      className="relative bg-card rounded-2xl overflow-hidden flex flex-col mx-auto"
      style={{ width: "min(98vw, 1100px)", height: "min(90dvh, 680px)" }}
    >
      <DiceStyles />
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Dice</p>
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

      {/* Win celebration — plays once per winning roll (~950ms), then fades out
          on its own. Nothing is shown on a loss. pointer-events-none so it never
          blocks the next bet. */}
      {showWin && (
        <div
          key={winId}
          className="dc-win-overlay absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          {CASH_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="dc-cash"
              style={{
                "--dc-rot": `${p.angle}deg`,
                "--dc-dist": `-${p.dist}px`,
                "--dc-spin": `${p.spin}deg`,
                animationDelay: `${p.delay}ms`,
              } as CSSProperties}
            >
              💵
            </span>
          ))}
          <p className="dc-win-text text-3xl font-black text-emerald-400 drop-shadow-[0_2px_8px_rgba(16,185,129,0.6)]">
            +{formatChips(result?.payout ?? 0)} chips
          </p>
        </div>
      )}

      {showInfo ? (
        <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
          <GameInfoPanel info={GAME_INFO.dice} onBack={() => setShowInfo(false)} />
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
            <p className="text-[11px] text-muted-foreground mt-1">
              Min {formatChips(minBet)} · Max {formatChips(maxBet)}
            </p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Profit on Win</label>
            <div className="mt-1 w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              {formatChips(profitOnWin)}
            </div>
          </div>

          <Button onClick={handleBet} disabled={!betValid || busy} className="mt-1 h-11 text-base font-bold">
            {busy ? "Rolling…" : "Bet"}
          </Button>

          {(formError || rollError) && (
            <p className="text-xs text-destructive">{formError ?? rollError}</p>
          )}
        </div>

        <div className="flex flex-col flex-1 p-5 min-w-0 justify-center gap-8">
          <div className="flex justify-between text-xs text-muted-foreground px-1">
            {[0, 25, 50, 75, 100].map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>

          <div
            ref={trackRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            className="relative h-3 rounded-full cursor-pointer touch-none select-none"
            style={{
              background:
                direction === "under"
                  ? `linear-gradient(to right, #16a34a 0%, #16a34a ${zoneSplitPct}%, #dc2626 ${zoneSplitPct}%, #dc2626 100%)`
                  : `linear-gradient(to right, #dc2626 0%, #dc2626 ${zoneSplitPct}%, #16a34a ${zoneSplitPct}%, #16a34a 100%)`,
            }}
          >
            <div
              className="absolute top-1/2 h-7 w-7 -translate-y-1/2 -translate-x-1/2 rounded-md bg-blue-500 border-2 border-blue-300 shadow-md"
              style={{ left: `${zoneSplitPct}%` }}
            />
            {markerPct !== null && (
              <div
                className="absolute -top-2 h-7 w-0.5 -translate-x-1/2 bg-white transition-[left] duration-500 ease-out"
                style={{ left: `${markerPct}%` }}
              />
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Multiplier</label>
              <input
                type="number"
                step="0.0001"
                value={multiplier.toFixed(4)}
                onChange={(e) => handleMultiplierInput(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground flex items-center justify-between">
                Roll {direction === "under" ? "Under" : "Over"}
                <button
                  type="button"
                  onClick={swapDirection}
                  disabled={busy}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-base leading-none text-primary transition-colors hover:bg-primary/20 hover:border-primary active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                  aria-label="Swap direction"
                >
                  ⇄
                </button>
              </label>
              <input
                type="number"
                step="0.01"
                value={target.toFixed(2)}
                onChange={(e) => handleTargetInput(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Win Chance</label>
              <input
                type="number"
                step="0.01"
                value={winChance.toFixed(2)}
                onChange={(e) => handleWinChanceInput(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

// Scoped styles for the win celebration. Everything finishes within ~950ms.
function DiceStyles() {
  return (
    <style>{`
      .dc-win-overlay {
        animation: dcOverlayFade 950ms ease-out both;
      }
      @keyframes dcOverlayFade {
        0%, 70% { opacity: 1; }
        100%    { opacity: 0; }
      }

      .dc-win-text {
        animation: dcWinPop 950ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes dcWinPop {
        0%   { opacity: 0; transform: scale(0.5) translateY(16px); }
        25%  { opacity: 1; transform: scale(1.12) translateY(0); }
        40%  { transform: scale(1); }
        100% { opacity: 1; transform: scale(1); }
      }

      .dc-cash {
        position: absolute;
        top: 50%; left: 50%;
        font-size: 22px;
        line-height: 1;
        animation: dcCashFly 800ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      }
      @keyframes dcCashFly {
        0% {
          opacity: 1;
          transform: translate(-50%, -50%) rotate(var(--dc-rot)) translateY(0) rotate(0deg) scale(0.6);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) rotate(var(--dc-rot)) translateY(var(--dc-dist)) rotate(var(--dc-spin)) scale(1.1);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .dc-cash { display: none; }
        .dc-win-overlay, .dc-win-text { animation: none; opacity: 0; }
      }
    `}</style>
  );
}
