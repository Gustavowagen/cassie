import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { formatChips } from "../../lib/utils";
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

interface Props {
  casinoId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Dice({ casinoId, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { result, loading, error: rollError, roll: rollDice } = useDice(casinoId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<DiceDirection>("under");
  const [formError, setFormError] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const bet = Math.max(0, parseFloat(betText) || 0);
  const winChance = winChanceFor(target, direction);
  const multiplier = multiplierFor(winChance);
  const profitOnWin = roundMoney(bet * (multiplier - 1));
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;

  function setTargetClamped(t: number) {
    const wc = clampWinChance(winChanceFor(t, direction));
    setTarget(winChanceFor(wc, direction));
  }

  function updateFromTrackClientX(clientX: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setTargetClamped(roundMoney(pct * 100));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (loading) return;
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromTrackClientX(e.clientX);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (loading) return;
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
    if (!betValid || loading) return;
    setFormError(null);
    try {
      const res = await rollDice(bet, target, direction);
      setLocalBalance(res.balance);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Bet failed");
    }
  }

  const zoneSplitPct = Math.min(100, Math.max(0, target));
  const markerPct = result ? Math.min(100, Math.max(0, result.roll)) : null;

  return (
    <div
      className="bg-card rounded-2xl overflow-hidden flex flex-col"
      style={{ width: "min(98vw, 1000px)", height: "min(90vh, 620px)" }}
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Dice</p>
          <p className="text-xs text-muted-foreground">Balance: {formatChips(localBalance)} chips</p>
        </div>
        <button type="button" onClick={onExit} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>

      {result && (
        <div
          className={`px-5 py-2 text-center font-bold text-white text-sm shrink-0 ${
            result.won ? "bg-emerald-700" : "bg-red-700"
          }`}
        >
          Rolled {result.roll.toFixed(2)} —{" "}
          {result.won ? `Won ${formatChips(result.payout)} chips` : `Lost ${formatChips(bet)} chips`}
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
              disabled={loading}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => adjustBet(0.5)}
                disabled={loading}
                className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                ½
              </button>
              <button
                type="button"
                onClick={() => adjustBet(2)}
                disabled={loading}
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

          <Button onClick={handleBet} disabled={!betValid || loading} className="mt-1 h-11 text-base font-bold">
            {loading ? "Rolling…" : "Bet"}
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
                disabled={loading}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground flex items-center justify-between">
                Roll {direction === "under" ? "Under" : "Over"}
                <button
                  type="button"
                  onClick={swapDirection}
                  disabled={loading}
                  className="text-muted-foreground hover:text-foreground"
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
                disabled={loading}
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
                disabled={loading}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
