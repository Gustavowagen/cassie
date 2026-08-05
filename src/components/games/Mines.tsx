import { useState } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { GameInfoButton } from "../ui/GameInfoButton";
import { GameInfoPanel } from "../ui/GameInfoPanel";
import { GAME_INFO } from "../../lib/gameInfo";
import { formatChips } from "../../lib/utils";
import { useMines } from "../../hooks/useMines";
import { playTone, playWinChime, playLoseThud } from "../../lib/sound";

const GRID_SIZE = 25;
const MIN_MINES = 1;
const MAX_MINES = 24;

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

// Precomputed burst of flying gems for the win animation (deterministic so
// every win looks intentional rather than random-jittery) — mirrors Dice's
// CASH_PARTICLES treatment.
const GEM_PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const angle = (i - 4.5) * 16;
  return {
    angle,
    dist: 90 + (i % 3) * 45,
    delay: (i % 5) * 40,
    spin: i % 2 === 0 ? 240 : -240,
  };
});

export function Mines({ casinoId, gameId, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { state, loading, error: reqError, start, reveal, cashOut } = useMines(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [minesCount, setMinesCount] = useState(3);
  const [formError, setFormError] = useState<string | null>(null);
  const [winId, setWinId] = useState(0);
  const [showInfo, setShowInfo] = useState(false);

  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;

  const hasActiveRound = state?.status === "active";
  const isComplete = state?.status === "complete";
  const currentPayout = state ? roundMoney(state.bet * state.multiplier) : 0;

  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  async function handleBet() {
    if (loading || hasActiveRound || !betValid) return;
    setFormError(null);
    try {
      const res = await start(bet, minesCount);
      setLocalBalance(res.balance);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Bet failed");
    }
  }

  async function handleTileClick(tile: number) {
    if (loading || !state || state.status !== "active") return;
    if (state.revealed.includes(tile)) return;
    setFormError(null);
    try {
      const res = await reveal(tile);
      setLocalBalance(res.balance);
      if (res.status === "complete") {
        if (res.outcome === "hit_mine") {
          playLoseThud();
        } else {
          playWinChime();
          setWinId((id) => id + 1);
        }
      } else {
        playTone({ freq: 660, duration: 0.08, volume: 0.05, type: "triangle" });
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Reveal failed");
    }
  }

  async function handleCashOut() {
    if (loading || !state || state.status !== "active" || state.revealed.length === 0) return;
    setFormError(null);
    try {
      const res = await cashOut();
      setLocalBalance(res.balance);
      playWinChime();
      setWinId((id) => id + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Cash out failed");
    }
  }

  function tileContent(i: number): "hidden" | "gem" | "mine" {
    if (!state) return "hidden";
    if (state.status === "active") {
      return state.revealed.includes(i) ? "gem" : "hidden";
    }
    return state.mines?.includes(i) ? "mine" : "gem";
  }

  const hitTile =
    state?.status === "complete" && state.outcome === "hit_mine"
      ? state.revealed[state.revealed.length - 1]
      : null;

  return (
    <div className="relative bg-card overflow-hidden flex flex-col w-full h-screen h-[var(--app-vvh,100dvh)] rounded-2xl sm:mx-auto sm:w-[min(96vw,1100px)] sm:h-[min(90vh,760px)]">
      <MinesStyles />
      <div className="flex items-center justify-between px-4 py-2 sm:px-5 sm:py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Mines</p>
          <p className="text-xs text-muted-foreground">Balance: {formatChips(localBalance)} chips</p>
        </div>
        <div className="flex items-center gap-3">
          <BackdropToggleButton />
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

      {isComplete && state!.outcome !== "hit_mine" && (
        <div className="px-5 py-2 text-center font-bold text-white text-sm shrink-0 bg-emerald-700">
          {`Cashed out ${formatChips(state!.payout ?? 0)} chips`}
        </div>
      )}

      {winId > 0 && isComplete && state!.outcome !== "hit_mine" && (
        <div
          key={winId}
          className="mn-win-overlay absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          {GEM_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="mn-gem"
              style={{
                "--mn-rot": `${p.angle}deg`,
                "--mn-dist": `-${p.dist}px`,
                "--mn-spin": `${p.spin}deg`,
                animationDelay: `${p.delay}ms`,
              } as CSSProperties}
            >
              💎
            </span>
          ))}
          <p className="mn-win-text text-3xl font-black text-emerald-400 drop-shadow-[0_2px_8px_rgba(16,185,129,0.6)]">
            +{formatChips(state!.payout ?? 0)} chips
          </p>
        </div>
      )}

      {showInfo ? (
        <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
          <GameInfoPanel info={GAME_INFO.mines} onBack={() => setShowInfo(false)} />
        </div>
      ) : (
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-auto overscroll-contain">
        <div className="flex flex-col gap-1 p-2 sm:gap-3 sm:p-4 md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border">
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

          <div>
            <label className="text-xs text-muted-foreground">Mines</label>
            <select
              value={minesCount}
              onChange={(e) => setMinesCount(Number(e.target.value))}
              disabled={loading || hasActiveRound}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {Array.from({ length: MAX_MINES - MIN_MINES + 1 }, (_, i) => i + MIN_MINES).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {hasActiveRound && (
            <div className="rounded-lg border border-border px-3 py-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Multiplier <span className="font-mono text-foreground">{state!.multiplier.toFixed(4)}x</span>
              </span>
              <span>
                Next{" "}
                <span className="font-mono text-foreground">
                  {state!.nextMultiplier ? `${state!.nextMultiplier.toFixed(4)}x` : "—"}
                </span>
              </span>
            </div>
          )}

          <Button
            onClick={hasActiveRound ? handleCashOut : handleBet}
            disabled={loading || (hasActiveRound ? state!.revealed.length === 0 : !betValid)}
            className="mt-1 h-11 text-base font-bold"
          >
            {loading
              ? "…"
              : hasActiveRound
              ? state!.revealed.length === 0
                ? "Reveal a tile first"
                : `Cash Out ${formatChips(currentPayout)} chips`
              : "Bet"}
          </Button>

          {(formError || reqError) && (
            <p className="text-xs text-destructive">{formError ?? reqError}</p>
          )}
        </div>

        <div className="flex flex-1 items-center justify-center px-11 py-1 sm:p-5 min-w-0">
          <div key={state?.roundId ?? "idle"} className="grid grid-cols-5 gap-1.5 sm:gap-2 w-full max-w-[clamp(420px,38vw,620px)]">
            {Array.from({ length: GRID_SIZE }, (_, i) => {
              const content = tileContent(i);
              const wasClicked = state?.revealed.includes(i) ?? false;
              const isHit = hitTile === i;
              const clickable = hasActiveRound && content === "hidden" && !loading;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleTileClick(i)}
                  disabled={!clickable}
                  className={`aspect-square rounded-lg flex items-center justify-center text-2xl transition-transform ${
                    content === "hidden"
                      ? "bg-muted/40 hover:bg-muted/70 disabled:hover:bg-muted/40"
                      : content === "gem"
                      ? `bg-emerald-500/20 ${wasClicked ? "" : "opacity-50"}`
                      : `bg-red-500/20 ${isHit ? "mn-hit-tile" : wasClicked ? "" : "opacity-50"}`
                  } ${clickable ? "cursor-pointer active:scale-95" : "cursor-default"} ${
                    isComplete && state!.outcome === "hit_mine" ? "mn-shake" : ""
                  }`}
                >
                  {content === "gem" && "💎"}
                  {content === "mine" && "💣"}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

// Scoped styles for the win/loss feedback. Everything finishes within ~950ms.
function MinesStyles() {
  return (
    <style>{`
      .mn-win-overlay {
        animation: mnOverlayFade 950ms ease-out both;
      }
      @keyframes mnOverlayFade {
        0%, 70% { opacity: 1; }
        100%    { opacity: 0; }
      }

      .mn-win-text {
        animation: mnWinPop 950ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes mnWinPop {
        0%   { opacity: 0; transform: scale(0.5) translateY(16px); }
        25%  { opacity: 1; transform: scale(1.12) translateY(0); }
        40%  { transform: scale(1); }
        100% { opacity: 1; transform: scale(1); }
      }

      .mn-gem {
        position: absolute;
        top: 50%; left: 50%;
        font-size: 22px;
        line-height: 1;
        animation: mnGemFly 800ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      }
      @keyframes mnGemFly {
        0% {
          opacity: 1;
          transform: translate(-50%, -50%) rotate(var(--mn-rot)) translateY(0) rotate(0deg) scale(0.6);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) rotate(var(--mn-rot)) translateY(var(--mn-dist)) rotate(var(--mn-spin)) scale(1.1);
        }
      }

      .mn-shake {
        animation: mnShake 400ms ease-in-out;
      }
      @keyframes mnShake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-3px); }
        40% { transform: translateX(3px); }
        60% { transform: translateX(-2px); }
        80% { transform: translateX(2px); }
      }

      .mn-hit-tile {
        animation: mnHitPulse 500ms ease-out;
      }
      @keyframes mnHitPulse {
        0%   { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
        100% { box-shadow: 0 0 0 14px rgba(239, 68, 68, 0); }
      }

      @media (prefers-reduced-motion: reduce) {
        .mn-gem { display: none; }
        .mn-win-overlay, .mn-win-text, .mn-shake, .mn-hit-tile { animation: none; }
        .mn-win-overlay { opacity: 0; }
      }
    `}</style>
  );
}
