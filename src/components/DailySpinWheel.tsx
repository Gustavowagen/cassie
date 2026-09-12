import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { DailySpinSettings, DailySpinSegment } from "../lib/dailySpin";
import type { DailySpinResult } from "../types";
import { formatChips } from "../lib/utils";
import { Button } from "./ui/button";

// Precomputed burst for the win animation (deterministic so every win looks
// intentional rather than random-jittery) — mirrors Mines' GEM_PARTICLES.
const WIN_PARTICLES = Array.from({ length: 12 }, (_, i) => ({
  angle: (i - 5.5) * 15,
  dist: 80 + (i % 3) * 40,
  delay: (i % 4) * 45,
  spin: i % 2 === 0 ? 220 : -220,
}));

const SPIN_MS = 4000;
const MIN_TURNS = 5;

/** SVG arc path for one slice of a circle of radius `r` centred at (50,50). */
function slicePath(startDeg: number, endDeg: number, r = 48): string {
  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const x1 = 50 + r * Math.cos(rad(startDeg));
  const y1 = 50 + r * Math.sin(rad(startDeg));
  const x2 = 50 + r * Math.cos(rad(endDeg));
  const y2 = 50 + r * Math.sin(rad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M 50 50 L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/**
 * Cumulative slice geometry. Every slice is the SAME angular width regardless
 * of weight: the wheel shows what the prizes ARE, not how likely they are.
 * Making rare slices thin would double-count the odds, since the server has
 * already applied the weights when it picked the winner.
 */
function sliceAngles(count: number): { start: number; end: number; mid: number }[] {
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => ({
    start: i * step,
    end: (i + 1) * step,
    mid: i * step + step / 2,
  }));
}

export function DailySpinWheel({
  config,
  spinning,
  readyIn,
  onSpin,
  onClose,
  preview = false,
}: {
  config: DailySpinSettings;
  spinning?: boolean;
  /** Non-null while cooling down; drives the disabled button's label. */
  readyIn?: string | null;
  onSpin?: () => Promise<DailySpinResult>;
  onClose?: () => void;
  /** Static, non-interactive render for the settings preview. */
  preview?: boolean;
}) {
  const [rotation, setRotation] = useState(0);
  const [landed, setLanded] = useState<DailySpinResult | null>(null);
  const [animating, setAnimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);

  const segments = config.segments;
  const angles = sliceAngles(segments.length);

  async function handleSpin() {
    if (!onSpin || animating) return;
    setError(null);
    setLanded(null);
    let result: DailySpinResult;
    try {
      result = await onSpin();
    } catch (e) {
      // Request failed: the wheel never moved, so there is nothing to roll
      // back. Nothing was bet, so no balance was optimistically touched.
      setError(e instanceof Error ? e.message : "Couldn't spin");
      return;
    }

    const slice = 360 / segments.length;
    // Land the winning slice under the pointer at the top, with a little
    // jitter inside the slice so it never stops dead-centre twice running.
    const jitter = (Math.random() - 0.5) * slice * 0.6;
    const target = 360 - (angles[result.segmentIndex].mid + jitter);
    const next = rotation + MIN_TURNS * 360 + ((target - (rotation % 360)) + 360) % 360;

    setAnimating(true);
    setRotation(next);

    // The result — including the balance — is held back until the wheel
    // physically stops. Showing it sooner spoils the landing, which is the
    // whole point of the animation (see CLAUDE.md's reveal rule).
    window.setTimeout(() => {
      setAnimating(false);
      setLanded(result);
    }, SPIN_MS);
  }

  const won = landed !== null && landed.amount > 0;

  return (
    <div className="flex flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">{config.title}</h2>
          <p className="truncate text-xs text-muted-foreground">{config.subtitle}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col items-center gap-4 p-5">
        <div
          className="relative"
          // Grows continuously with the viewport instead of sitting small in a
          // large modal; floors at a usable size on a ~375px phone.
          style={{ width: "clamp(260px, 58vw, 520px)", height: "clamp(260px, 58vw, 520px)" }}
        >
          {/* Pointer, fixed at the top. */}
          <div className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[18px] border-x-transparent border-t-amber-300 drop-shadow" />

          <div
            ref={wheelRef}
            className="h-full w-full"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: animating ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)` : "none",
            }}
          >
            <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-xl">
              {segments.map((seg: DailySpinSegment, i) => (
                <path key={seg.id} d={slicePath(angles[i].start, angles[i].end)} fill={seg.color} />
              ))}
              {segments.map((seg, i) => (
                <text
                  key={`${seg.id}-label`}
                  x="50"
                  y="10"
                  textAnchor="middle"
                  fill="white"
                  fontSize="4.2"
                  fontWeight="700"
                  transform={`rotate(${angles[i].mid} 50 50)`}
                  style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.35)", strokeWidth: 0.9 }}
                >
                  {seg.label}
                </text>
              ))}
              <circle cx="50" cy="50" r="6" fill="#0f172a" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
            </svg>
          </div>

          {/* Win burst + payout pop-in. Nothing renders for a 0-chip landing:
              per CLAUDE.md, a loss shows no banner and no loss text — the
              labelled slice under the pointer is the entire feedback. */}
          {won && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {WIN_PARTICLES.map((p, i) => (
                <span
                  key={i}
                  className="absolute h-2 w-2 rounded-full bg-amber-300"
                  style={{
                    animation: `daily-spin-particle 900ms ${p.delay}ms ease-out forwards`,
                    ["--dsp-angle" as string]: `${p.angle}deg`,
                    ["--dsp-dist" as string]: `${p.dist}px`,
                    ["--dsp-spin" as string]: `${p.spin}deg`,
                  }}
                />
              ))}
              <div className="animate-in zoom-in rounded-xl bg-black/70 px-4 py-2 text-xl font-extrabold text-amber-300 shadow-lg">
                +{formatChips(landed!.amount)}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!preview && (
          <Button
            className="w-full max-w-xs"
            disabled={!!readyIn || animating || spinning || landed !== null}
            onClick={handleSpin}
          >
            {animating || spinning
              ? "Spinning…"
              : landed
              ? "Come back tomorrow"
              : readyIn
              ? `Ready in ${readyIn}`
              : "Spin now"}
          </Button>
        )}
      </div>
    </div>
  );
}
