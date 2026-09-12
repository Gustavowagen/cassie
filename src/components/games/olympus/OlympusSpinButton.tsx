import { useState } from "react";

// The showcase's spin control: a gold medallion in a laurel wreath with Zeus's
// bolt struck into its enamel face. It answers the machine rather than just
// sitting there — lightning crackles round the rim now and then while it
// waits, the milled edge turns while a round plays out, and the bolt runs
// white-hot while a multiplier orb charges, the same beat Zeus strikes on.

/** Bezel radius in the art's viewBox; the wreath and arcs reach past it. */
const BEZEL_R = 46;
/** The art is drawn in a 120-unit box around a 92-unit bezel. */
const ART_SIZE = (120 / (BEZEL_R * 2)) * 100;
const ART_BLEED = (ART_SIZE - 100) / -2;

const WREATH_R = 52;
/** Degrees each branch sweeps up from the bottom; the gap at the top is what's left. */
const BRANCH_SWEEP = 150;
const PAIRS = 11;
const LEAF_LEN = 10;
const LEAF_W = 3.6;
const LEAF_TILT = 28;

const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (r: number, deg: number) => [r * Math.cos(rad(deg)), r * Math.sin(rad(deg))] as const;
const f = (n: number) => n.toFixed(2);

/** A pointed leaf with its base at the origin, tip along +x. */
const LEAF = `M0,0 Q${LEAF_LEN / 2},${-LEAF_W} ${LEAF_LEN},0 Q${LEAF_LEN / 2},${LEAF_W} 0,0 Z`;

interface Leaf {
  x: number;
  y: number;
  rot: number;
  scale: number;
}

/**
 * Two branches grow from the bottom of the medallion up either side. SVG
 * angles run clockwise from +x, so the bottom is 90deg and each branch walks
 * away from it in opposite directions.
 */
function buildWreath() {
  const leaves: Leaf[] = [];
  const stems: string[] = [];
  for (const side of [1, -1]) {
    const angleAt = (t: number) => 90 - side * (10 + t * BRANCH_SWEEP);
    // Direction the branch grows at a given angle: along the tangent, upward.
    const growth = (deg: number) => deg - side * 90;

    const [sx, sy] = polar(WREATH_R, angleAt(0));
    const [ex, ey] = polar(WREATH_R, angleAt(1));
    stems.push(`M${f(sx)},${f(sy)} A${WREATH_R},${WREATH_R} 0 0 ${side === 1 ? 0 : 1} ${f(ex)},${f(ey)}`);

    for (let i = 0; i < PAIRS; i++) {
      const t = i / (PAIRS - 1);
      const deg = angleAt(t);
      const [x, y] = polar(WREATH_R, deg);
      // Leaves thin out toward the tip of the branch.
      const scale = 1 - t * 0.38;
      const g = growth(deg);
      leaves.push({ x, y, rot: g + side * LEAF_TILT, scale });
      if (i < PAIRS - 1) leaves.push({ x, y, rot: g - side * LEAF_TILT, scale });
    }
    // One leaf carries straight on to finish the branch.
    leaves.push({ x: ex, y: ey, rot: growth(angleAt(1)), scale: 0.6 });
  }
  return { leaves, stems };
}

/** Milling round the coin's edge. It is what visibly turns while a round plays. */
function buildEdge() {
  return Array.from({ length: 56 }, (_, i) => {
    const deg = (i / 56) * 360;
    const [x1, y1] = polar(40.4, deg);
    const [x2, y2] = polar(45, deg);
    return `M${f(x1)},${f(y1)} L${f(x2)},${f(y2)}`;
  }).join(" ");
}

/**
 * Jagged lightning riding the rim. Fixed jitter rather than random, so the
 * arcs don't reshape on every render.
 */
const ARC_JITTER = [0, 3.4, -2.6, 4, -3.6, 2.2, -1.4, 3.8, -3, 0];
function buildArc(fromDeg: number) {
  return ARC_JITTER.map((j, i) => {
    const [x, y] = polar(BEZEL_R + 2 + j, fromDeg + i * 5.5);
    return `${i === 0 ? "M" : "L"}${f(x)},${f(y)}`;
  }).join(" ");
}

const WREATH = buildWreath();
const EDGE = buildEdge();
const ARCS = [-158, -38, 64].map(buildArc);

/** Zeus's bolt, sitting a touch high so the word fits beneath it. */
const BOLT = "M1,-25 L10,-25 L2.5,-9.5 L10.5,-9.5 L-6.5,15 L-2.2,-2.8 L-10.5,-2.8 Z";

export function OlympusSpinButton({
  spinning,
  charged,
  onSpin,
}: {
  spinning: boolean;
  charged: boolean;
  onSpin: () => void;
}) {
  // Keys the shockwave, so every press replays it.
  const [presses, setPresses] = useState(0);

  return (
    <button
      type="button"
      className={["oly-spin", spinning ? "is-spinning" : "", charged ? "is-charged" : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        setPresses((n) => n + 1);
        onSpin();
      }}
      disabled={spinning}
      aria-label={spinning ? "Spinning" : "Spin"}
    >
      <SpinStyles />
      <svg className="oly-spin-art" viewBox="-60 -60 120 120" aria-hidden focusable="false">
        <defs>
          <linearGradient id="olySpinLeaf" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fdf3c4" />
            <stop offset="45%" stopColor="#f6c95f" />
            <stop offset="100%" stopColor="#a3541b" />
          </linearGradient>
          <linearGradient id="olySpinBezel" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#fdf3c4" />
            <stop offset="18%" stopColor="#f6c95f" />
            <stop offset="42%" stopColor="#d78a2c" />
            <stop offset="56%" stopColor="#8b4415" />
            <stop offset="72%" stopColor="#d78a2c" />
            <stop offset="90%" stopColor="#f6c95f" />
            <stop offset="100%" stopColor="#fdf3c4" />
          </linearGradient>
          <radialGradient id="olySpinFace" cx="0.5" cy="0.4" r="0.62">
            <stop offset="0%" stopColor="#6a3aa8" />
            <stop offset="45%" stopColor="#3f1a5e" />
            <stop offset="100%" stopColor="#1a0724" />
          </radialGradient>
          <linearGradient id="olySpinBolt" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0%" stopColor="#fffbe6" />
            <stop offset="35%" stopColor="#ffd968" />
            <stop offset="75%" stopColor="#f0a01e" />
            <stop offset="100%" stopColor="#b8620f" />
          </linearGradient>
          <filter id="olySpinGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
        </defs>

        <g className="oly-spin-wreath">
          {WREATH.stems.map((d) => (
            <path key={d} d={d} fill="none" stroke="#a3541b" strokeWidth="1.3" strokeLinecap="round" />
          ))}
          {WREATH.leaves.map((l, i) => (
            <path
              key={i}
              d={LEAF}
              fill="url(#olySpinLeaf)"
              stroke="#6b2e0c"
              strokeWidth="0.5"
              transform={`translate(${f(l.x)} ${f(l.y)}) rotate(${f(l.rot)}) scale(${f(l.scale)})`}
            />
          ))}
        </g>

        <circle r={BEZEL_R} fill="url(#olySpinBezel)" stroke="#4d2110" strokeWidth="1.2" />
        <path className="oly-spin-edge" d={EDGE} stroke="#6b2e0c" strokeWidth="1.1" strokeOpacity="0.55" />

        <circle r="39.5" fill="url(#olySpinFace)" stroke="#fdf3c4" strokeOpacity="0.7" strokeWidth="1.2" />
        <circle r="36.5" fill="none" stroke="#f6c95f" strokeOpacity="0.28" strokeWidth="0.6" />
        {/* Glaze catching the light across the top of the enamel. */}
        <ellipse cx="0" cy="-23" rx="25" ry="10" fill="#fff" opacity="0.1" />

        <g transform="translate(0 -1) scale(1.18)">
          <path className="oly-spin-bolt-glow" d={BOLT} fill="#bfe2ff" filter="url(#olySpinGlow)" />
          <path className="oly-spin-bolt" d={BOLT} fill="url(#olySpinBolt)" stroke="#5a2408" strokeWidth="0.8" strokeLinejoin="round" />
        </g>

        <text
          className="oly-spin-word"
          y="29.5"
          textAnchor="middle"
          fontFamily="Cinzel, Georgia, serif"
          fontWeight="700"
          fontSize="8.4"
          letterSpacing="1.4"
          fill="#f6c95f"
        >
          Spin
        </text>

        <g className="oly-spin-arcs" filter="url(#olySpinGlow)">
          {ARCS.map((d) => (
            <path key={d} d={d} fill="none" stroke="#9fd0ff" strokeWidth="3" strokeLinejoin="round" />
          ))}
        </g>
        <g className="oly-spin-arcs">
          {ARCS.map((d) => (
            <path key={d} d={d} fill="none" stroke="#f4faff" strokeWidth="1.1" strokeLinejoin="round" />
          ))}
        </g>
      </svg>
      {presses > 0 && <span className="oly-spin-wave" key={presses} aria-hidden />}
    </button>
  );
}

function SpinStyles() {
  return (
    <style>{`
      /* The button's own box is the bezel; the wreath and lightning spill past
         it, so the medallion can look big without pushing the controls bar
         (and the board above it) around. */
      .oly-spin { position: relative; width: clamp(70px, 7vw, 116px); aspect-ratio: 1; padding: 0; border: none; border-radius: 50%;
        background: none; cursor: pointer; -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease; }
      .oly-spin-art { position: absolute; top: ${ART_BLEED}%; left: ${ART_BLEED}%; width: ${ART_SIZE}%; height: ${ART_SIZE}%; max-width: none; overflow: visible; pointer-events: none;
        filter: drop-shadow(0 8px 14px rgba(12,2,20,0.6)); }
      .oly-spin:active:not(:disabled) { transform: scale(0.95); }
      .oly-spin:focus-visible { outline: 3px solid #fff3c8; outline-offset: clamp(11px, 1.1vw, 18px); }
      .oly-spin:disabled { cursor: default; }

      .oly-spin-edge { transform-origin: 0 0; }
      .oly-spin-bolt, .oly-spin-word { transition: opacity 240ms ease; }
      .oly-spin-bolt-glow { opacity: 0; transition: opacity 200ms ease; }
      .oly-spin-arcs { opacity: 0; }

      /* Waiting: every few seconds a short crackle runs round the rim, the
         one thing on the scene that moves on its own to ask for a press. The
         two arc layers (halo and core) flicker together. */
      .oly-spin:not(:disabled) .oly-spin-arcs { animation: olySpinIdle 5.4s linear infinite; }
      @keyframes olySpinIdle {
        0%, 84% { opacity: 0; }
        86% { opacity: 1; }
        87.5% { opacity: 0.15; }
        89% { opacity: 1; }
        92%, 100% { opacity: 0; }
      }

      @media (hover: hover) {
        .oly-spin:hover:not(:disabled) { transform: translateY(-2px); }
        .oly-spin:hover:not(:disabled) .oly-spin-arcs { animation: olySpinCrackle 460ms linear infinite; }
        .oly-spin:hover:not(:disabled) .oly-spin-bolt-glow { opacity: 0.85; }
      }
      .oly-spin:active:not(:disabled) .oly-spin-bolt-glow { opacity: 1; }
      @keyframes olySpinCrackle {
        0% { opacity: 1; } 18% { opacity: 0.2; } 30% { opacity: 1; }
        52% { opacity: 0.45; } 66% { opacity: 1; } 84% { opacity: 0.1; } 100% { opacity: 1; }
      }

      /* Playing: the milled edge turns and the bolt banks down to embers. */
      .oly-spin.is-spinning .oly-spin-edge { animation: olySpinTurn 1.1s linear infinite; }
      .oly-spin.is-spinning .oly-spin-bolt { opacity: 0.5; }
      .oly-spin.is-spinning .oly-spin-word { opacity: 0.35; }
      @keyframes olySpinTurn { to { transform: rotate(360deg); } }

      /* A multiplier charging: the bolt runs white-hot and the rim crackles
         for as long as the orb holds its charge. */
      .oly-spin.is-charged .oly-spin-bolt { opacity: 1; }
      .oly-spin.is-charged .oly-spin-bolt-glow { opacity: 1; animation: olySpinSurge 380ms ease-in-out infinite alternate; }
      .oly-spin.is-charged .oly-spin-arcs { animation: olySpinCrackle 380ms linear infinite; }
      @keyframes olySpinSurge { from { opacity: 0.55; } to { opacity: 1; } }

      /* The press: a ring of light thrown off the medallion. */
      .oly-spin-wave { position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
        border: 2px solid rgba(214,236,255,0.95);
        box-shadow: 0 0 18px 4px rgba(140,195,255,0.7), inset 0 0 18px 4px rgba(140,195,255,0.55);
        animation: olySpinWave 620ms cubic-bezier(0.15, 0.7, 0.3, 1) forwards; }
      @keyframes olySpinWave {
        0% { opacity: 1; transform: scale(0.9); }
        100% { opacity: 0; transform: scale(1.85); }
      }

      @media (prefers-reduced-motion: reduce) {
        .oly-spin:not(:disabled) .oly-spin-arcs, .oly-spin.is-spinning .oly-spin-edge,
        .oly-spin.is-charged .oly-spin-bolt-glow { animation: none; }
        .oly-spin.is-charged .oly-spin-arcs { animation: none; opacity: 1; }
        .oly-spin-wave { display: none; }
        .oly-spin:hover:not(:disabled) { transform: none; }
      }
    `}</style>
  );
}
