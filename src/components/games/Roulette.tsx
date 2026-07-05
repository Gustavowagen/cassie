import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Button } from "../ui/button";
import { supabase } from "../../lib/supabase";
import { formatChips } from "../../lib/utils";
import { CHIPS_BY_TIER, formatChipLabel, TIER_LABELS, type Tier } from "../../lib/stakeTiers";
import { X } from "lucide-react";

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// American wheel slot order — 37 = "00"
const WHEEL_ORDER = [0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 37, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2];

// Betting table rows (top → bottom)
const NUMBER_ROWS: number[][] = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
];
const NUM_COLS = NUMBER_ROWS[0].length; // 12

function splitKey(a: number, b: number) {
  return `sp_${[a, b].sort((x, y) => x - y).join("_")}`;
}
function cornerKey(ns: number[]) {
  return `cn_${[...ns].sort((x, y) => x - y).join("_")}`;
}

// Placeable inside-combination targets over the 3×12 number grid. `cx`/`cy` are
// fractions (0–1) of the grid body: a chip/hotspot sits on the shared edge of a
// split or the meeting vertex of a corner. Must mirror the server's INSIDE_COMBOS.
type Spot = { key: string; cx: number; cy: number; numbers: number[]; type: "split" | "corner" };
const INSIDE_SPOTS: Spot[] = (() => {
  const spots: Spot[] = [];
  const rows = NUMBER_ROWS;
  // Horizontal splits — shared vertical edge between adjacent columns.
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < NUM_COLS - 1; c++) {
      const a = rows[r][c], b = rows[r][c + 1];
      spots.push({ key: splitKey(a, b), cx: (c + 1) / NUM_COLS, cy: (r + 0.5) / 3, numbers: [a, b], type: "split" });
    }
  // Vertical splits — shared horizontal edge between adjacent rows.
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < NUM_COLS; c++) {
      const a = rows[r][c], b = rows[r + 1][c];
      spots.push({ key: splitKey(a, b), cx: (c + 0.5) / NUM_COLS, cy: (r + 1) / 3, numbers: [a, b], type: "split" });
    }
  // Corners — the four numbers meeting at an interior vertex.
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < NUM_COLS - 1; c++) {
      const ns = [rows[r][c], rows[r][c + 1], rows[r + 1][c], rows[r + 1][c + 1]];
      spots.push({ key: cornerKey(ns), cx: (c + 1) / NUM_COLS, cy: (r + 1) / 3, numbers: ns, type: "corner" });
    }
  return spots;
})();

// A stacked casino chip showing its total value. Rendered click-through so a
// tap always reaches the cell/hotspot beneath it (chips stack on re-bet).
function Chip({ amount, size = 24 }: { amount: number; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-black font-black leading-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(7, Math.round(size * 0.34)),
        background: "radial-gradient(circle at 35% 28%, #fff7dd, #f5c518 52%, #b8860b 100%)",
        border: "2px dashed rgba(255,255,255,0.85)",
        boxShadow: "0 0 0 2px #b45309, 0 0 0 3px rgba(255,255,255,0.45), 0 1px 3px rgba(0,0,0,0.6)",
      }}
    >
      {formatChips(amount)}
    </span>
  );
}

const WIN_PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  angle: (360 / 18) * i,
  dist: 80 + (i % 3) * 34,
  delay: (i % 5) * 35,
  color: i % 3 === 0 ? "#fbbf24" : i % 3 === 1 ? "#f87171" : "#ffffff",
}));

type BetMap = Record<string, number>;

function numColor(n: number): "red" | "black" | "green" {
  if (n === 0 || n === 37) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}
function numLabel(n: number) {
  return n === 37 ? "00" : String(n);
}

function calcPayout(result: number, bets: BetMap): number {
  const color = numColor(result);
  const isZero = result === 0 || result === 37;
  let total = 0;
  for (const [key, amount] of Object.entries(bets)) {
    if (!amount) continue;
    let mult = 0;
    if (key === `n${result}`) {
      mult = 36;
    } else if (!isZero) {
      if (key === "red" && color === "red") mult = 2;
      else if (key === "black" && color === "black") mult = 2;
      else if (key === "even" && result % 2 === 0) mult = 2;
      else if (key === "odd" && result % 2 !== 0) mult = 2;
      else if (key === "low" && result <= 18) mult = 2;
      else if (key === "high" && result >= 19) mult = 2;
      else if (key === "d1" && result <= 12) mult = 3;
      else if (key === "d2" && result >= 13 && result <= 24) mult = 3;
      else if (key === "d3" && result >= 25) mult = 3;
      else if (key === "c1" && result % 3 === 0) mult = 3;
      else if (key === "c2" && result % 3 === 2) mult = 3;
      else if (key === "c3" && result % 3 === 1) mult = 3;
    }
    total += amount * mult;
  }
  return total;
}

function totalBet(bets: BetMap): number {
  return Object.values(bets).reduce((s, v) => s + v, 0);
}

// ── Wheel SVG ──────────────────────────────────────────────────────────────
const N = WHEEL_ORDER.length; // 38
const ANG = 360 / N;
const CX = 150, CY = 150;
const R_OUTER = 145, R_SEG = 108, R_TEXT = 126, R_DECO = 80, R_HUB = 18;
const BALL_TRACK_R = 138; // outer groove the ball orbits in
const BALL_POCKET_R = 96; // resting radius inside a pocket
const BALL_R = 5;
const SPIN_MS = 5000;

function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }
function easeOutQuart(t: number) { return 1 - Math.pow(1 - t, 4); }

// Linear interpolation over [time, value] keyframes (times ascending in 0..1)
function sampleKeys(keys: [number, number][], t: number): number {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}

export interface WheelHandle {
  /** Animate the wheel + ball, resolving when the ball has settled on `num`. */
  spinTo(num: number): Promise<void>;
}

const RouletteWheelSVG = forwardRef<WheelHandle>(function RouletteWheelSVG(_props, ref) {
  const rotorRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGCircleElement>(null);
  const rotorAngle = useRef(0);
  const hasLanded = useRef(false);
  const raf = useRef(0);
  const pendingResolve = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    pendingResolve.current?.(); // don't leave the caller awaiting forever on unmount
  }, []);

  useImperativeHandle(ref, () => ({
    spinTo(num: number) {
      return new Promise<void>((resolve) => {
        const idx = WHEEL_ORDER.indexOf(num);

        // Rotor spins clockwise 2-3 extra turns and stops with the winning
        // pocket centred under the top pointer: rot ≡ -(idx+0.5)*ANG (mod 360).
        const startRotor = rotorAngle.current;
        const target = (((-(idx + 0.5) * ANG) % 360) + 360) % 360;
        let endRotor = startRotor + 720 + Math.floor(Math.random() * 360);
        endRotor += (((target - endRotor) % 360) + 360) % 360;

        // Ball orbits the other way and ends at the top (-90°), i.e. in the
        // winning pocket. Whole extra turns keep the end angle exact.
        const travel = (6 + Math.floor(Math.random() * 2)) * 360;
        const ballStart = -90 + travel;

        // Radius over time: launch to the track, ride it, spiral in, then a
        // couple of damped bounces before resting in the pocket.
        const startRadius = hasLanded.current ? BALL_POCKET_R : BALL_TRACK_R;
        const radiusKeys: [number, number][] = [
          [0, startRadius],
          [0.08, BALL_TRACK_R],
          [0.6, BALL_TRACK_R],
          [0.68, BALL_POCKET_R],
          [0.72, BALL_POCKET_R + 10],
          [0.76, BALL_POCKET_R],
          [0.8, BALL_POCKET_R + 5],
          [0.84, BALL_POCKET_R],
          [1, BALL_POCKET_R],
        ];

        const firstSpin = !hasLanded.current;
        const t0 = performance.now();
        pendingResolve.current = resolve;

        const frame = (now: number) => {
          const t = Math.min((now - t0) / SPIN_MS, 1);

          const rot = startRotor + (endRotor - startRotor) * easeOutCubic(t);
          rotorRef.current?.setAttribute("transform", `rotate(${rot.toFixed(2)} ${CX} ${CY})`);

          const aDeg = ballStart - travel * easeOutQuart(t);
          const a = (aDeg * Math.PI) / 180;
          const rr = sampleKeys(radiusKeys, t);
          const ball = ballRef.current;
          if (ball) {
            ball.setAttribute("cx", (CX + rr * Math.cos(a)).toFixed(2));
            ball.setAttribute("cy", (CY + rr * Math.sin(a)).toFixed(2));
            ball.setAttribute("opacity", firstSpin ? Math.min(1, t * 12).toFixed(2) : "1");
          }

          if (t < 1) {
            raf.current = requestAnimationFrame(frame);
          } else {
            rotorAngle.current = ((endRotor % 360) + 360) % 360;
            hasLanded.current = true;
            pendingResolve.current = null;
            resolve();
          }
        };

        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(frame);
      });
    },
  }), []);

  return (
    <svg viewBox="0 0 300 300" className="w-full max-w-[400px]">
      <defs>
        <radialGradient id="rw-wood" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#a06030" />
          <stop offset="100%" stopColor="#3d1e0a" />
        </radialGradient>
        <radialGradient id="rw-ball" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#e8e4d8" />
          <stop offset="100%" stopColor="#9c968a" />
        </radialGradient>
      </defs>

      {/* Outer wood ring */}
      <circle cx={CX} cy={CY} r={R_OUTER} fill="url(#rw-wood)" />
      <circle cx={CX} cy={CY} r={R_OUTER - 5} fill="#5c2f10" />
      <circle cx={CX} cy={CY} r={R_OUTER - 9} fill="#7a4020" />

      {/* Ball track groove */}
      <circle cx={CX} cy={CY} r={BALL_TRACK_R} fill="none" stroke="#2e1706" strokeWidth={1.5} opacity={0.6} />

      {/* Spinning rotor */}
      <g ref={rotorRef}>
        {WHEEL_ORDER.map((num, i) => {
          const a1 = ((i * ANG - 90) * Math.PI) / 180;
          const a2 = (((i + 1) * ANG - 90) * Math.PI) / 180;
          const am = (a1 + a2) / 2;
          const col = numColor(num);
          const fill = col === "red" ? "#b91c1c" : col === "black" ? "#111827" : "#15803d";
          const x1 = CX + R_SEG * Math.cos(a1), y1 = CY + R_SEG * Math.sin(a1);
          const x2 = CX + R_SEG * Math.cos(a2), y2 = CY + R_SEG * Math.sin(a2);
          const tx = CX + R_TEXT * Math.cos(am), ty = CY + R_TEXT * Math.sin(am);
          const rot = (am * 180) / Math.PI + 90;
          return (
            <g key={i}>
              <path
                d={`M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R_SEG} ${R_SEG} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`}
                fill={fill}
                stroke="#4a2010"
                strokeWidth={0.7}
              />
              <text
                x={tx.toFixed(2)}
                y={ty.toFixed(2)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={7}
                fill="white"
                fontWeight="bold"
                transform={`rotate(${rot.toFixed(1)}, ${tx.toFixed(2)}, ${ty.toFixed(2)})`}
              >
                {numLabel(num)}
              </text>
            </g>
          );
        })}

        {/* Decorative inner ring */}
        <circle cx={CX} cy={CY} r={R_DECO + 3} fill="#4a2010" />
        <circle cx={CX} cy={CY} r={R_DECO} fill="#7a4020" />
        <circle cx={CX} cy={CY} r={R_DECO - 6} fill="#4a2010" />

        {/* Spokes */}
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * 45 * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={(CX + (R_DECO - 6) * Math.cos(a)).toFixed(2)}
              y1={(CY + (R_DECO - 6) * Math.sin(a)).toFixed(2)}
              x2={CX}
              y2={CY}
              stroke="#a06030"
              strokeWidth={2.5}
            />
          );
        })}

        {/* Center hub */}
        <circle cx={CX} cy={CY} r={R_HUB + 5} fill="#4a2010" />
        <circle cx={CX} cy={CY} r={R_HUB} fill="#ca8a04" />
        <circle cx={CX} cy={CY} r={R_HUB - 5} fill="#fbbf24" />
        <circle cx={CX} cy={CY} r={5} fill="#92400e" />
      </g>

      {/* Ball (positioned imperatively during the spin animation) */}
      <circle ref={ballRef} cx={CX} cy={CY - BALL_POCKET_R} r={BALL_R} fill="url(#rw-ball)" opacity={0} />

      {/* Fixed top pointer */}
      <polygon points="150,5 143,21 157,21" fill="#fbbf24" />
    </svg>
  );
});

// ── Main component ─────────────────────────────────────────────────────────
interface Props {
  casinoId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Roulette({ casinoId, balance: initialBalance, minBet, onExit }: Props) {
  const [bets, setBets] = useState<BetMap>({});
  const [tier, setTier] = useState<Tier>("medium");
  const chipValues = CHIPS_BY_TIER[tier];
  const [chip, setChip] = useState(chipValues[0].value);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [payout, setPayout] = useState<number | null>(null);
  const [previousBets, setPreviousBets] = useState<BetMap>({});
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [error, setError] = useState<string | null>(null);
  const [winId, setWinId] = useState(0);
  const spinRef = useRef(false);
  const wheelRef = useRef<WheelHandle>(null);

  function changeTier(t: Tier) {
    setTier(t);
    setChip(CHIPS_BY_TIER[t][0].value);
  }

  function placeBet(key: string) {
    if (spinning) return;
    const next = { ...bets, [key]: (bets[key] ?? 0) + chip };
    if (totalBet(next) > localBalance) return;
    setBets(next);
    setResult(null);
    setPayout(null);
    setError(null);
  }

  function clearBets() {
    setBets({});
    setResult(null);
    setPayout(null);
    setError(null);
  }

  function rebet() {
    if (!Object.keys(previousBets).length) return;
    if (totalBet(previousBets) > localBalance) { setError("Insufficient balance to rebet"); return; }
    setBets(previousBets);
    setResult(null);
    setPayout(null);
    setError(null);
  }

  async function spin() {
    if (spinRef.current) return;
    const total = totalBet(bets);
    if (total < minBet) { setError(`Minimum bet is ${formatChips(minBet)} chips`); return; }
    if (total > localBalance) { setError("Insufficient balance"); return; }

    spinRef.current = true;
    setSpinning(true);
    setError(null);
    setResult(null);
    setPayout(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke("roulette", {
        body: { action: "spin", casino_id: casinoId, bets },
      });
      if (fnErr) {
        // supabase-js returns non-2xx as FunctionsHttpError; the JSON { error }
        // body lives on error.context (a Response), not on `data`.
        let message = fnErr.message;
        const ctx = (fnErr as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            if (parsed?.error) message = parsed.error as string;
          } catch {
            /* keep the default message */
          }
        }
        throw new Error(message);
      }

      const { result: r, payout: winAmount, balance: newBalance } = data as {
        result: number;
        payout: number;
        balance: number;
      };

      // Run the wheel + ball animation; resolves once the ball has settled.
      await wheelRef.current?.spinTo(r);

      setLocalBalance(newBalance);
      setResult(r);
      setPayout(winAmount);
      setPreviousBets(bets);
      setBets({});
      if (winAmount > 0) setWinId((id) => id + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spin failed");
    } finally {
      setSpinning(false);
      spinRef.current = false;
    }
  }

  const betTotal = totalBet(bets);
  const resultColor = result !== null ? numColor(result) : null;

  // ── Cell renderers ────────────────────────────────────────────────────────

  const FELT = "#1a6b2e";
  const WIN_GLOW = "shadow-[0_0_0_2px_rgba(250,204,21,0.9),0_0_16px_4px_rgba(250,204,21,0.65)]";

  // Straight-up bets on numbers (incl. 0/00) show their chip in the felt overlay
  // (InsideOverlay) so a split/corner chip can straddle a shared edge. Number
  // cells therefore render just the label; the chip is drawn on top of them.
  function NumCell({ n, style }: { n: number; style?: React.CSSProperties }) {
    const key = `n${n}`;
    const col = numColor(n);
    const bg = col === "red" ? "bg-red-600" : "bg-zinc-950";
    const isWin = result === n;
    return (
      <div
        onClick={() => placeBet(key)}
        className={`relative cursor-pointer select-none font-bold text-white text-[11px] transition hover:brightness-125 flex items-center justify-center ${bg} ${isWin ? `z-10 ${WIN_GLOW}` : ""}`}
        style={style}
      >
        {numLabel(n)}
      </div>
    );
  }

  function ZeroCell({ betKey, label, style }: { betKey: string; label: string; style?: React.CSSProperties }) {
    const amt = bets[betKey] ?? 0;
    const isWin = result !== null && betKey === `n${result}`;
    return (
      <div
        onClick={() => placeBet(betKey)}
        className={`relative cursor-pointer select-none font-bold text-white text-xs transition hover:brightness-125 flex items-center justify-center ${isWin ? `z-10 ${WIN_GLOW}` : ""}`}
        style={{ background: FELT, ...style }}
      >
        {label}
        {amt > 0 && (
          <span className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <Chip amount={amt} size={22} />
          </span>
        )}
      </div>
    );
  }

  function OutCell({
    betKey, label, className = "", style, vertical = false,
  }: {
    betKey: string; label: string; className?: string; style?: React.CSSProperties; vertical?: boolean;
  }) {
    const hasBet = (bets[betKey] ?? 0) > 0;
    const isWin = result !== null && hasBet && calcPayout(result, { [betKey]: bets[betKey] }) > 0;
    return (
      <div
        onClick={() => placeBet(betKey)}
        className={`relative cursor-pointer select-none font-bold text-white text-[11px] tracking-wide transition hover:brightness-125 flex items-center justify-center ${className} ${hasBet ? "ring-2 ring-inset ring-yellow-400" : ""} ${isWin ? `z-10 ${WIN_GLOW}` : ""}`}
        style={style}
      >
        {vertical ? (
          <span className="text-[9px]" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
            {label}
          </span>
        ) : (
          label
        )}
        {hasBet && (
          <span className="absolute -top-1 -right-1 z-10 pointer-events-none">
            <Chip amount={bets[betKey]} size={18} />
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative bg-card rounded-2xl overflow-hidden flex flex-col"
      style={{ width: "min(98vw, 1200px)", height: "min(90vh, 800px)" }}
    >
      <RouletteStyles />

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Roulette</p>
          <p className="text-xs text-muted-foreground">Balance: {formatChips(localBalance)} chips</p>
        </div>
        <button type="button" onClick={onExit} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Win celebration — plays once per winning spin, then fades on its own.
          pointer-events-none so it never blocks starting the next round. */}
      {payout !== null && payout > 0 && (
        <div key={winId} className="rw-win-overlay absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          {WIN_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="rw-particle"
              style={{
                "--rw-rot": `${p.angle}deg`,
                "--rw-dist": `-${p.dist}px`,
                animationDelay: `${p.delay}ms`,
                background: p.color,
              } as React.CSSProperties}
            />
          ))}
          <div className="rw-win-card rw-win-glow relative rounded-2xl px-8 py-5 text-center overflow-hidden bg-gradient-to-b from-amber-400 to-amber-600 border-2 border-amber-200">
            <div className="rw-win-shine absolute inset-0" />
            <p className="relative text-[11px] font-bold tracking-[0.2em] text-amber-950/80 uppercase">
              {numLabel(result!)} — {resultColor!.toUpperCase()}
            </p>
            <p className="relative text-3xl font-black text-amber-950 mt-1">
              +{formatChips(payout!)}
            </p>
            <p className="relative text-xs font-bold text-amber-950/80">chips</p>
          </div>
        </div>
      )}

      {/* Main body */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-auto">
        {/* Wheel panel */}
        <div className="flex items-center justify-center bg-zinc-950 p-6 md:w-64 lg:w-80 xl:w-[420px] shrink-0">
          <RouletteWheelSVG ref={wheelRef} />
        </div>

        {/* Table + controls */}
        <div className="flex flex-col flex-1 p-3 min-w-0 min-h-0">
          {/* Stake tier selector */}
          <div className="flex items-center gap-1 mb-1.5 shrink-0">
            {(["low", "medium", "high"] as Tier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeTier(t)}
                className={`rounded-lg px-3 py-0.5 text-[11px] font-bold uppercase tracking-[0.15em] transition-colors ${
                  tier === t
                    ? "bg-yellow-400/20 text-yellow-300 ring-1 ring-yellow-300/50"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {TIER_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Chip selector */}
          <div className="flex items-center gap-1.5 mb-3 flex-wrap shrink-0">
            <span className="text-xs text-muted-foreground mr-0.5">Chip:</span>
            {chipValues.map(({ value: v }) => (
              <button
                key={v}
                type="button"
                onClick={() => setChip(v)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold border transition-colors ${
                  chip === v
                    ? "bg-yellow-400 text-black border-yellow-400"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                }`}
              >
                {formatChipLabel(v)}
              </button>
            ))}
          </div>

          {/* Felt table — fixed aspect ratio so cells stay proportioned like a real board, centered in the available space */}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <div
              className="relative rounded-xl p-2"
              style={{
                background: "radial-gradient(130% 150% at 30% 10%, #1f7a37 0%, #0d3d1a 75%, #0a3016 100%)",
                boxShadow:
                  "0 0 0 1px rgba(250,204,21,0.4), 0 10px 30px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
                aspectRatio: "1.85 / 1",
                width: "100%",
                maxHeight: "100%",
              }}
            >
              <div
                className="relative h-full overflow-hidden rounded-lg"
                style={{
                  background: "rgba(255,255,255,0.22)",
                  display: "grid",
                  gridTemplateColumns: "40px repeat(12, 1fr) 32px",
                  gridTemplateRows: "repeat(6, 1fr)",
                  gap: "1.5px",
                }}
              >
              {/* Row 1: 1 TO 18 / 19 TO 36 header */}
              <div style={{ gridRow: 1, gridColumn: 1, background: FELT }} />
              <OutCell betKey="low"  label="1 TO 18"  className="bg-[#1a6b2e] text-xs" style={{ gridRow: 1, gridColumn: "2 / 8" }} />
              <OutCell betKey="high" label="19 TO 36" className="bg-[#1a6b2e] text-xs" style={{ gridRow: 1, gridColumn: "8 / 14" }} />
              <div style={{ gridRow: 1, gridColumn: 14, background: FELT }} />

              {/* Row 2: 00 + numbers [3 6 9…36] + 2:1 */}
              <ZeroCell betKey="n37" label="00" style={{ gridRow: 2, gridColumn: 1 }} />
              {NUMBER_ROWS[0].map((n, i) => <NumCell key={n} n={n} style={{ gridRow: 2, gridColumn: i + 2 }} />)}
              <OutCell betKey="c1" label="2 TO 1" vertical className="bg-[#1a6b2e]" style={{ gridRow: 2, gridColumn: 14 }} />

              {/* Row 3: 0 (spans rows 3–4) + numbers [2 5 8…35] + 2:1 */}
              <ZeroCell betKey="n0" label="0" style={{ gridRow: "3 / 5", gridColumn: 1 }} />
              {NUMBER_ROWS[1].map((n, i) => <NumCell key={n} n={n} style={{ gridRow: 3, gridColumn: i + 2 }} />)}
              <OutCell betKey="c2" label="2 TO 1" vertical className="bg-[#1a6b2e]" style={{ gridRow: 3, gridColumn: 14 }} />

              {/* Row 4: numbers [1 4 7…34] + 2:1 */}
              {NUMBER_ROWS[2].map((n, i) => <NumCell key={n} n={n} style={{ gridRow: 4, gridColumn: i + 2 }} />)}
              <OutCell betKey="c3" label="2 TO 1" vertical className="bg-[#1a6b2e]" style={{ gridRow: 4, gridColumn: 14 }} />

              {/* Inside-bet layer over the 3×12 number grid: split/corner hotspots
                  plus every straight/split/corner chip. The container is
                  click-through; only the hotspots re-enable pointer events, so a
                  tap on a number's body still lands a straight-up bet. */}
              <div
                style={{ gridRow: "2 / 5", gridColumn: "2 / 14", position: "relative", pointerEvents: "none", zIndex: 5 }}
              >
                {/* Placement targets on shared edges (splits) and vertices (corners) */}
                {INSIDE_SPOTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-label={`${s.type === "corner" ? "Corner" : "Split"} bet on ${[...s.numbers].sort((a, b) => a - b).join(", ")}`}
                    onClick={() => placeBet(s.key)}
                    className="rw-hotspot absolute rounded-full"
                    style={{
                      left: `${s.cx * 100}%`,
                      top: `${s.cy * 100}%`,
                      width: s.type === "corner" ? 24 : 20,
                      height: s.type === "corner" ? 24 : 20,
                      transform: "translate(-50%, -50%)",
                      pointerEvents: spinning ? "none" : "auto",
                    }}
                  />
                ))}
                {/* Straight-up chips, centred on each number */}
                {NUMBER_ROWS.map((row, r) =>
                  row.map((n, c) => {
                    const amt = bets[`n${n}`] ?? 0;
                    if (!amt) return null;
                    return (
                      <span
                        key={`chip-n${n}`}
                        className="absolute pointer-events-none"
                        style={{
                          left: `${((c + 0.5) / NUM_COLS) * 100}%`,
                          top: `${((r + 0.5) / 3) * 100}%`,
                          transform: "translate(-50%, -50%)",
                          zIndex: 20,
                        }}
                      >
                        <Chip amount={amt} size={24} />
                      </span>
                    );
                  })
                )}
                {/* Split / corner chips straddling their shared edge or vertex */}
                {INSIDE_SPOTS.map((s) => {
                  const amt = bets[s.key] ?? 0;
                  if (!amt) return null;
                  return (
                    <span
                      key={`chip-${s.key}`}
                      className="absolute pointer-events-none"
                      style={{
                        left: `${s.cx * 100}%`,
                        top: `${s.cy * 100}%`,
                        transform: "translate(-50%, -50%)",
                        zIndex: 20,
                      }}
                    >
                      <Chip amount={amt} size={22} />
                    </span>
                  );
                })}
              </div>

              {/* Row 5: Dozens */}
              <div style={{ gridRow: 5, gridColumn: 1, background: FELT }} />
              <OutCell betKey="d1" label="1 TO 12"  className="bg-[#1a6b2e]" style={{ gridRow: 5, gridColumn: "2 / 6" }} />
              <OutCell betKey="d2" label="13 TO 24" className="bg-[#1a6b2e]" style={{ gridRow: 5, gridColumn: "6 / 10" }} />
              <OutCell betKey="d3" label="25 TO 36" className="bg-[#1a6b2e]" style={{ gridRow: 5, gridColumn: "10 / 14" }} />
              <div style={{ gridRow: 5, gridColumn: 14, background: FELT }} />

              {/* Row 6: Even money */}
              <div style={{ gridRow: 6, gridColumn: 1, background: FELT }} />
              <OutCell betKey="even"  label="EVEN"  className="bg-[#1a6b2e]" style={{ gridRow: 6, gridColumn: "2 / 5" }} />
              <OutCell betKey="red"   label="RED"   className="bg-red-600"   style={{ gridRow: 6, gridColumn: "5 / 8" }} />
              <OutCell betKey="black" label="BLACK" className="bg-zinc-950"  style={{ gridRow: 6, gridColumn: "8 / 11" }} />
              <OutCell betKey="odd"   label="ODD"   className="bg-[#1a6b2e]" style={{ gridRow: 6, gridColumn: "11 / 14" }} />
              <div style={{ gridRow: 6, gridColumn: 14, background: FELT }} />
              </div>
              {/* Felt vignette for depth */}
              <div
                className="pointer-events-none absolute inset-2 rounded-lg"
                style={{ background: "radial-gradient(120% 120% at 50% 40%, transparent 55%, rgba(0,0,0,0.32) 100%)" }}
              />
            </div>
          </div>

          {/* Actions row */}
          <div className="flex items-center justify-between gap-3 mt-3 flex-wrap shrink-0">
            <p className="text-sm text-muted-foreground">
              {spinning ? (
                <span className="animate-pulse text-foreground">Spinning…</span>
              ) : betTotal > 0 ? (
                <>
                  Bet:{" "}
                  <span className="text-foreground font-semibold">{formatChips(betTotal)}</span> chips
                </>
              ) : (
                "Click the table to place bets"
              )}
            </p>
            <div className="flex gap-2">
              {Object.keys(previousBets).length > 0 && !spinning && betTotal === 0 && (
                <Button variant="outline" size="sm" onClick={rebet}>
                  Rebet
                </Button>
              )}
              {betTotal > 0 && !spinning && (
                <Button variant="outline" size="sm" onClick={clearBets}>
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                onClick={spin}
                disabled={spinning || betTotal === 0}
                className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold border-0 disabled:opacity-50"
              >
                {spinning ? "Spinning…" : "SPIN"}
              </Button>
            </div>
          </div>

          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function RouletteStyles() {
  return (
    <style>{`
      /* Split/corner placement targets: invisible until hovered, then a golden
         dot hints that a chip can be dropped on this edge or vertex. */
      .rw-hotspot {
        background: transparent;
        cursor: pointer;
        transition: background 120ms ease, box-shadow 120ms ease;
      }
      .rw-hotspot:hover {
        background: radial-gradient(circle, rgba(250,204,21,0.9) 0 45%, rgba(250,204,21,0.35) 46% 100%);
        box-shadow: 0 0 0 1.5px rgba(250,204,21,0.9), 0 0 8px 2px rgba(250,204,21,0.55);
      }

      .rw-win-overlay {
        animation: rwOverlayFade 2400ms ease-out both;
      }
      @keyframes rwOverlayFade {
        0%, 72% { opacity: 1; }
        100%    { opacity: 0; }
      }

      .rw-win-card {
        animation: rwCardIn 600ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes rwCardIn {
        0%   { opacity: 0; transform: scale(0.5) translateY(14px); }
        65%  { opacity: 1; transform: scale(1.08) translateY(0); }
        100% { opacity: 1; transform: scale(1) translateY(0); }
      }

      .rw-win-glow {
        animation: rwGlowPulse 1100ms ease-in-out infinite;
      }
      @keyframes rwGlowPulse {
        0%, 100% { box-shadow: 0 0 30px 6px rgba(251,191,36,0.35); }
        50%      { box-shadow: 0 0 55px 16px rgba(251,191,36,0.65); }
      }

      .rw-win-shine::after {
        content: "";
        position: absolute;
        top: -50%; left: -60%;
        width: 40%; height: 200%;
        background: linear-gradient(120deg, transparent, rgba(255,255,255,0.65), transparent);
        transform: rotate(20deg);
        animation: rwShineSweep 1600ms ease-in-out 300ms 2;
      }
      @keyframes rwShineSweep {
        0%   { left: -60%; }
        100% { left: 130%; }
      }

      .rw-particle {
        position: absolute;
        top: 50%; left: 50%;
        width: 7px; height: 7px;
        border-radius: 2px;
        animation: rwParticleBurst 900ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      }
      @keyframes rwParticleBurst {
        0%   { opacity: 1; transform: translate(-50%, -50%) rotate(var(--rw-rot)) translateY(0) rotate(0deg) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--rw-rot)) translateY(var(--rw-dist)) rotate(200deg) scale(0.4); }
      }

      @media (prefers-reduced-motion: reduce) {
        .rw-win-overlay, .rw-win-card, .rw-win-glow, .rw-win-shine::after, .rw-particle {
          animation: none;
        }
      }
    `}</style>
  );
}
