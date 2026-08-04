import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { GameInfoButton } from "../ui/GameInfoButton";
import { GameInfoPanel } from "../ui/GameInfoPanel";
import { GAME_INFO } from "../../lib/gameInfo";
import { formatChips } from "../../lib/utils";
import { playTone } from "../../lib/sound";
import { usePlinko } from "../../hooks/usePlinko";
import type { PlinkoResult, PlinkoRisk } from "../../types";

// Mirrors supabase/functions/plinko/engine.ts — kept as a local, dependency-free
// copy (same pattern as Dice's own multiplier maths) since the edge function
// runs under Deno and isn't bundled into the browser build. The server is
// authoritative for payouts; these tables only drive what's drawn.
const ROWS = 12;
const BUCKETS = ROWS + 1;
const MULTIPLIERS: Record<PlinkoRisk, number[]> = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};
const RISK_LABELS: Record<PlinkoRisk, string> = { low: "Low", medium: "Medium", high: "High" };

// Board layout, all in % of the board box so it scales with the container.
// Peg row i holds i + 3 pegs, so the last row has 14 and the 13 gaps beneath
// it are the buckets.
const BOTTOM_PEGS = ROWS + 2;
const SPACING = 100 / BOTTOM_PEGS;
const PEG_TOP = 5;
const PEG_BOTTOM = 78;
const PEG_VGAP = (PEG_BOTTOM - PEG_TOP) / (ROWS - 1);
const BUCKET_Y = 89;
const START_Y = -4;

const DROP_MS = 5000;
const HOP = 2.4; // % of board height the ball arcs up after each deflection
const MAX_BALLS = 50;
const BALL_PRESETS = [1, 10, 25, 50];

function pegX(row: number, p: number): number {
  return 50 + (p - (row + 2) / 2) * SPACING;
}
function pegY(row: number): number {
  return PEG_TOP + row * PEG_VGAP;
}
function bucketX(bucket: number): number {
  return 50 + (bucket - ROWS / 2) * SPACING;
}
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Buckets ramp red at the high-paying edges through orange to yellow at the
// low-paying centre, matching Stake's board.
function bucketHue(i: number): number {
  const t = 1 - Math.abs(i - (BUCKETS - 1) / 2) / ((BUCKETS - 1) / 2);
  return 4 + t * 50;
}
function bucketStyle(i: number): CSSProperties {
  const hue = bucketHue(i);
  return {
    background: `hsl(${hue}, 95%, 54%)`,
    // Yellow/orange chips need dark text to stay legible; the red ends need light.
    color: hue > 30 ? "hsl(24, 90%, 12%)" : "#fff",
    boxShadow: `0 3px 0 0 hsl(${hue}, 80%, 38%)`,
  };
}

interface Waypoint {
  x: number;
  y: number;
  peg?: { row: number; p: number };
}

// The ball's route: the start point above the board, one point per peg it
// deflects off, then the bucket it settles into.
function waypointsFor(path: (0 | 1)[]): Waypoint[] {
  const pts: Waypoint[] = [{ x: 50, y: START_Y }];
  let rights = 0;
  for (let row = 0; row < ROWS; row++) {
    const p = 1 + rights;
    pts.push({ x: pegX(row, p), y: pegY(row), peg: { row, p } });
    rights += path[row];
  }
  pts.push({ x: bucketX(rights), y: BUCKET_Y });
  return pts;
}

// The true shape of a projectile launched and landing at the same height
// under constant gravity: y = v0*t - 0.5*g*t², normalized to peak at 1.
function bounceArc(frac: number): number {
  return 4 * frac * (1 - frac);
}

interface Props {
  casinoId: string;
  gameId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

// A ball in flight: its precomputed route and where along it we are. Driven
// imperatively off a shared rAF loop (not React state) so dropping a batch of
// balls at once doesn't mean a React re-render per ball per frame.
interface ActiveBall {
  pts: Waypoint[];
  segments: number;
  startedAt: number;
  lastPoint: number;
  result: PlinkoResult;
}

export function Plinko({ casinoId, gameId, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { drop } = usePlinko(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [ballCountText, setBallCountText] = useState("1");
  const [risk, setRisk] = useState<PlinkoRisk>("medium");
  const [formError, setFormError] = useState<string | null>(null);
  const [busyCount, setBusyCount] = useState(0);
  const [ballIds, setBallIds] = useState<number[]>([]);
  const [history, setHistory] = useState<{ multiplier: number; bucket: number; id: number }[]>([]);
  const [showInfo, setShowInfo] = useState(false);

  const activeBallsRef = useRef<Map<number, ActiveBall>>(new Map());
  const ballElsRef = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const pegElsRef = useRef<Map<string, HTMLSpanElement | null>>(new Map());
  const bucketElsRef = useRef<Map<number, HTMLSpanElement | null>>(new Map());
  const rafRef = useRef<number | null>(null);
  const nextBallIdRef = useRef(0);

  // The rAF loop and any balls still mid-air belong to this component instance;
  // abandon both if the player closes the game before they land.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const bet = Math.max(0, parseFloat(betText) || 0);
  const ballCount = Math.min(MAX_BALLS, Math.max(1, Math.round(parseFloat(ballCountText) || 1)));
  const totalStake = roundMoney(bet * ballCount);
  const betValid = bet >= minBet && bet <= maxBet && totalStake > 0 && totalStake <= localBalance;
  const busy = busyCount > 0;
  const table = MULTIPLIERS[risk];

  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  function flashPeg(key: string) {
    const el = pegElsRef.current.get(key);
    if (!el) return;
    el.classList.remove("pk-peg-lit");
    void el.offsetWidth; // restart the CSS animation even if the same peg was just lit
    el.classList.add("pk-peg-lit");
  }

  function flashBucket(i: number) {
    const el = bucketElsRef.current.get(i);
    if (!el) return;
    el.classList.remove("pk-bucket-hit");
    void el.offsetWidth;
    el.classList.add("pk-bucket-hit");
  }

  function loop(now: number) {
    const finishedIds: number[] = [];

    for (const [id, ball] of activeBallsRef.current) {
      const u = Math.min(1, Math.max(0, (now - ball.startedAt) / DROP_MS));
      // Accelerating fall — slower at the top, fastest just before the last
      // bucket. A literal u² (true constant-acceleration freefall) reaches
      // the first peg only ~28% of the way through DROP_MS, which reads as
      // a stall rather than a drop once stretched over a few seconds; u^1.5
      // keeps the same "speeds up as it falls" shape with a livelier start.
      const s = Math.min(ball.segments, ball.segments * Math.pow(u, 1.5));
      const i = Math.min(ball.segments - 1, Math.floor(s));
      const frac = s - i;

      const from = ball.pts[i];
      const to = ball.pts[i + 1];
      // Horizontal speed is constant between pegs — only gravity curves the
      // path — so x is linear; a peg deflection is a genuine kink, not eased.
      const x = from.x + (to.x - from.x) * frac;
      const y = from.y + (to.y - from.y) * frac - (i >= 1 ? HOP * bounceArc(frac) : 0);

      const el = ballElsRef.current.get(id);
      if (el) {
        el.style.left = `${x}%`;
        el.style.top = `${y}%`;
      }

      // Crossing an integer means this ball just reached that waypoint.
      const reached = Math.floor(s);
      if (reached > ball.lastPoint) {
        ball.lastPoint = reached;
        const peg = ball.pts[reached]?.peg;
        if (peg) {
          flashPeg(`${peg.row}-${peg.p}`);
          playTone({ freq: 400 + peg.row * 28, duration: 0.035, volume: 0.05, type: "triangle" });
        }
      }

      if (u >= 1) finishedIds.push(id);
    }

    for (const id of finishedIds) {
      const ball = activeBallsRef.current.get(id)!;
      activeBallsRef.current.delete(id);
      ballElsRef.current.delete(id);

      const res = ball.result;
      flashBucket(res.bucket);
      setHistory((h) => [{ multiplier: res.multiplier, bucket: res.bucket, id }, ...h].slice(0, 8));
      // Reveal the true outcome only now that the ball has actually landed —
      // this is what credits any payout back on top of the stake lost when
      // the ball was dropped.
      setLocalBalance(res.balance);
      if (!res.won) {
        playTone({ freq: 320, duration: 0.09, volume: 0.05, type: "triangle" });
      }
      setBusyCount((c) => c - 1);
    }

    if (finishedIds.length > 0) {
      setBallIds((ids) => ids.filter((id) => activeBallsRef.current.has(id)));
    }

    rafRef.current = activeBallsRef.current.size > 0 ? requestAnimationFrame(loop) : null;
  }

  function spawnBall(res: PlinkoResult) {
    const pts = waypointsFor(res.path);
    const id = ++nextBallIdRef.current;
    activeBallsRef.current.set(id, {
      pts,
      segments: pts.length - 1,
      startedAt: performance.now(),
      lastPoint: 0,
      result: res,
    });
    setBallIds((ids) => [...ids, id]);
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(loop);
  }

  async function dropOneBall() {
    // The bet is lost the instant it's dropped, win or lose — the ball's
    // flight is cosmetic and must never gate this deduction.
    setLocalBalance((b) => b - bet);
    try {
      const res = await drop(bet, risk);
      // Balance is credited with any payout once this ball lands, in `loop`.
      spawnBall(res);
    } catch (err) {
      setLocalBalance((b) => b + bet); // roll back the optimistic deduction
      setFormError(err instanceof Error ? err.message : "Bet failed");
      setBusyCount((c) => c - 1);
    }
  }

  // Balls already in the air don't block a new batch — busyCount just adds
  // on top. The total still in flight (requested-but-not-landed + animating) is capped at
  // MAX_BALLS regardless of how many overlapping batches contributed to it,
  // since each animates off the shared rAF loop and unbounded concurrent
  // balls is what crashes the tab.
  function handleDrop() {
    if (!betValid || busyCount >= MAX_BALLS) return;
    const dropCount = Math.min(ballCount, MAX_BALLS - busyCount);
    setFormError(null);
    setBusyCount((c) => c + dropCount);
    // Fire every ball in the batch at once; each animates independently as its
    // own response lands. The server (not this loop) is what keeps concurrent
    // drops from the same player from racing on the shared balance.
    for (let k = 0; k < dropCount; k++) void dropOneBall();
  }

  // Space bar drops a ball (or the selected batch) too, so a player can spam
  // it to keep balls flowing without reaching for the mouse. Key-repeat (an
  // auto-fired event while the key is held) is ignored so holding it down
  // isn't the same as many distinct presses; focus in a form field is left
  // alone so it doesn't fire while typing a bet amount.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      handleDrop();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleDrop]);

  return (
    <div className="relative bg-card overflow-hidden flex flex-col w-full h-screen h-[100dvh] rounded-2xl sm:w-[min(98vw,1000px)] sm:h-[min(90vh,680px)]">
      <PlinkoStyles />
      <div className="flex items-center justify-between px-4 py-2 sm:px-5 sm:py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Plinko</p>
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
        <div className="flex-1 min-h-0 overflow-auto">
          <GameInfoPanel info={GAME_INFO.plinko} onBack={() => setShowInfo(false)} />
        </div>
      ) : (
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-auto">
        <div className="flex flex-col gap-1 p-2.5 sm:gap-3 sm:p-4 md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border">
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

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Risk</label>
              <select
                value={risk}
                onChange={(e) => setRisk(e.target.value as PlinkoRisk)}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {(Object.keys(RISK_LABELS) as PlinkoRisk[]).map((r) => (
                  <option key={r} value={r}>
                    {RISK_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Balls</label>
              <input
                type="number"
                min={1}
                max={MAX_BALLS}
                step={1}
                value={ballCountText}
                onChange={(e) => setBallCountText(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <div className="flex gap-2">
              {BALL_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setBallCountText(String(n))}
                  disabled={busy}
                  className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Total stake: {formatChips(totalStake)} chips</p>
          </div>

          <Button
            onClick={handleDrop}
            disabled={!betValid || busyCount >= MAX_BALLS}
            className="mt-1 h-11 text-base font-bold"
          >
            {ballCount > 1 ? `Drop ${ballCount} Balls` : "Play"}
          </Button>
          <p className="hidden sm:block text-[11px] text-muted-foreground text-center -mt-1">
            {busy ? `${busyCount} ball${busyCount > 1 ? "s" : ""} in the air — ` : ""}
            {busyCount >= MAX_BALLS ? `Max ${MAX_BALLS} in the air, wait for some to land` : `Press Space to drop${busy ? " more" : ""}`}
          </p>

          {formError && <p className="text-xs text-destructive">{formError}</p>}
        </div>

        <div className="flex flex-1 items-center justify-center px-12 py-1 sm:p-4 min-w-0">
          <div className="relative w-full" style={{ maxWidth: 560 }}>
            {history.length > 0 && (
              <div className="absolute right-0 -top-1 z-10 flex flex-col gap-1 md:-right-2">
                {history.map((h) => (
                  <span
                    key={h.id}
                    className="pk-history rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                    style={bucketStyle(h.bucket)}
                  >
                    {h.multiplier}×
                  </span>
                ))}
              </div>
            )}

            <div className="relative w-full" style={{ aspectRatio: "1.1 / 1" }}>
              {Array.from({ length: ROWS }, (_, row) =>
                Array.from({ length: row + 3 }, (_, p) => {
                  const key = `${row}-${p}`;
                  return (
                    <span
                      key={key}
                      ref={(el) => {
                        pegElsRef.current.set(key, el);
                      }}
                      className="absolute h-[6px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85"
                      style={{ left: `${pegX(row, p)}%`, top: `${pegY(row)}%` }}
                    />
                  );
                })
              )}

              {ballIds.map((id) => (
                <div
                  key={id}
                  ref={(el) => {
                    ballElsRef.current.set(id, el);
                  }}
                  aria-hidden
                  className="absolute h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"
                  style={{ left: "50%", top: `${START_Y}%` }}
                />
              ))}

              {table.map((m, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    bucketElsRef.current.set(i, el);
                  }}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded font-bold tabular-nums"
                  style={{
                    ...bucketStyle(i),
                    left: `${bucketX(i)}%`,
                    top: `${BUCKET_Y}%`,
                    width: `${SPACING * 0.86}%`,
                    height: "7.5%",
                    fontSize: "clamp(7px, 1.6vw, 11px)",
                  }}
                >
                  {m}×
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

// Scoped styles for the peg/bucket hit feedback.
function PlinkoStyles() {
  return (
    <style>{`
      .pk-peg-lit {
        animation: pkPegFlash 220ms ease-out;
      }
      @keyframes pkPegFlash {
        0%   { transform: translate(-50%, -50%) scale(2.1); background: #fff; box-shadow: 0 0 9px rgba(255,255,255,0.9); }
        100% { transform: translate(-50%, -50%) scale(1); }
      }

      .pk-bucket-hit {
        animation: pkBucketHit 380ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes pkBucketHit {
        0%   { transform: translate(-50%, -50%); }
        30%  { transform: translate(-50%, calc(-50% + 7px)) scale(0.94); }
        100% { transform: translate(-50%, -50%) scale(1); }
      }

      .pk-history {
        animation: pkHistoryIn 260ms ease-out both;
      }
      @keyframes pkHistoryIn {
        0%   { opacity: 0; transform: translateX(10px); }
        100% { opacity: 1; transform: translateX(0); }
      }

      @media (prefers-reduced-motion: reduce) {
        .pk-peg-lit, .pk-bucket-hit, .pk-history { animation: none; }
      }
    `}</style>
  );
}
