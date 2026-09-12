import { useCallback, useEffect, useRef, useState } from "react";
import { OlyLogo } from "./olympusArt";
import { OLY_ART, OLY_LOADING_STAGES, preloadImage } from "./olympusAssets";

// The door onto the showcase: Zeus in the storm, one button, and a bar that
// fills before the board appears.
//
// The bar is theatre, and deliberately so — it runs on a fixed three-second
// clock rather than reporting bytes. What is not theatre is the preloading
// underneath it: the scene, Zeus's four frames, all eight symbols and the
// multiplier badges are fetched while the bar runs, and the gate refuses to open until they have
// arrived, so the game never appears half-painted on a slow connection.

const LOAD_MS = 3000;
/** Time the gate takes to dissolve once the bar is full. */
const EXIT_MS = 420;

/**
 * Keyframes for the bar, as [elapsed, filled] pairs. A straight ramp reads as
 * a countdown rather than a load; the two shelves here are what make it look
 * like something is actually being fetched.
 */
const CURVE: [number, number][] = [
  [0, 0],
  [0.12, 0.24],
  [0.3, 0.31],
  [0.55, 0.69],
  [0.72, 0.75],
  [0.93, 0.97],
  [1, 1],
];

function fillAt(t: number): number {
  for (let i = 1; i < CURVE.length; i++) {
    const [t1, p1] = CURVE[i];
    if (t > t1) continue;
    const [t0, p0] = CURVE[i - 1];
    return p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
  }
  return 1;
}

export function OlympusGate({ onEnter }: { onEnter: () => void }) {
  const [fill, setFill] = useState(0);
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const rafRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const start = useCallback(() => {
    setLoading(true);

    const art = Promise.all(
      OLY_LOADING_STAGES.flatMap((s) => s.sources).map(preloadImage),
    );

    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / LOAD_MS);
      setFill(fillAt(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      // The clock is up; the bar sits full while any straggling image lands.
      else void art.then(() => setLeaving(true));
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onEnter, EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving, onEnter]);

  const pct = Math.round(fill * 100);
  // Each stage gets an equal share of the bar. The labels name the group
  // genuinely being fetched at that point, in the order the fetches start.
  const stage = Math.min(
    OLY_LOADING_STAGES.length - 1,
    Math.floor(fill * OLY_LOADING_STAGES.length),
  );
  const status = fill >= 1 ? "Ready" : OLY_LOADING_STAGES[stage].label;

  return (
    <div className={leaving ? "oly-gate oly-gate-leaving" : "oly-gate"}>
      <GateStyles />
      <div className="oly-gate-art" aria-hidden />
      <div className="oly-gate-veil" aria-hidden />

      <div className="oly-gate-panel">
        <OlyLogo className="oly-gate-logo" />

        {loading ? (
          <div className="oly-gate-load">
            <div
              className="oly-gate-bar"
              role="progressbar"
              aria-label="Loading the game"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {/* The same rosette bolts that pin the cabinet frame, so the bar
                  reads as part of the machine rather than browser chrome. */}
              <span className="oly-gate-boss" aria-hidden />
              <span className="oly-gate-track">
                <span className="oly-gate-fill" style={{ width: `${fill * 100}%` }} />
              </span>
              <span className="oly-gate-boss" aria-hidden />
            </div>
            <p className="oly-gate-status">
              <span>{status}</span>
              <span className="oly-gate-pct">{pct}%</span>
            </p>
          </div>
        ) : (
          <button type="button" className="oly-gate-play" onClick={start}>
            Play
          </button>
        )}
      </div>
    </div>
  );
}

function GateStyles() {
  return (
    <style>{`
      .oly-gate { position: fixed; inset: 0; z-index: 40; overflow: hidden;
        display: flex; align-items: flex-end; justify-content: center;
        padding: 0 clamp(16px, 4vw, 48px) clamp(28px, 7vh, 84px);
        background: #150a24; opacity: 1; transition: opacity ${EXIT_MS}ms ease; }
      .oly-gate-leaving { opacity: 0; pointer-events: none; }

      .oly-gate-art { position: absolute; inset: 0;
        background: url("${OLY_ART.gate}") center / cover no-repeat;
        /* One slow push in. It is the only motion on this screen that nobody
           asked for, so it is the only one that gets to be here. */
        animation: olyGateDrift 22s ease-out forwards; }
      @keyframes olyGateDrift { from { transform: scale(1.005); } to { transform: scale(1.09); } }

      /* Zeus's face sits in the upper middle of the plate, so the scrim is
         weighted to the bottom and leaves him alone. It has to come down hard
         below the waist: the wordmark is gold and so is his belt, and without
         a dark field under it the arc of "GATES OF" disappears into the
         armour. */
      .oly-gate-veil { position: absolute; inset: 0;
        background: linear-gradient(180deg, rgba(14,4,30,0.46) 0%, rgba(14,4,30,0.04) 26%,
          rgba(11,3,24,0.5) 56%, rgba(9,2,20,0.84) 76%, rgba(7,1,16,0.97) 100%); }

      .oly-gate-panel { position: relative; display: flex; flex-direction: column; align-items: center;
        gap: clamp(18px, 3vh, 34px); width: 100%; max-width: 620px; }
      /* Gold letters over gold armour: the wordmark needs a tight dark
         shadow of its own before the warm glow reads as a glow at all. */
      .oly-gate-logo { width: clamp(240px, 31vw, 430px); height: auto;
        filter: drop-shadow(0 2px 3px rgba(28,6,0,0.95)) drop-shadow(0 0 16px rgba(24,4,20,0.9))
          drop-shadow(0 6px 24px rgba(16,3,0,0.8)) drop-shadow(0 0 34px rgba(255,190,90,0.3)); }

      /* ------------------------------------------------------------ play */
      .oly-gate-play { min-width: clamp(180px, 22vw, 250px); padding: clamp(11px, 1.4vh, 16px) 30px;
        border: 2px solid #8b4415; border-radius: 8px; cursor: pointer;
        font-family: Cinzel, Georgia, serif; font-weight: 700; letter-spacing: 0.16em;
        font-size: clamp(16px, 1.5vw, 22px); color: #43170a;
        background: linear-gradient(180deg, #fdf3c4 0%, #f6c95f 40%, #d78a2c 72%, #a3541b 100%);
        box-shadow: 0 10px 26px rgba(0,0,0,0.55), inset 0 2px 0 rgba(255,253,232,0.85),
          inset 0 -3px 8px rgba(90,40,10,0.5);
        transition: transform 140ms ease, filter 140ms ease, box-shadow 140ms ease; }
      .oly-gate-play:hover { transform: translateY(-2px); filter: brightness(1.06);
        box-shadow: 0 14px 32px rgba(0,0,0,0.6), 0 0 30px rgba(255,190,80,0.4),
          inset 0 2px 0 rgba(255,253,232,0.85), inset 0 -3px 8px rgba(90,40,10,0.5); }
      .oly-gate-play:active { transform: translateY(1px) scale(0.99); }
      .oly-gate-play:focus-visible { outline: 3px solid #fff3c8; outline-offset: 4px; }

      /* ------------------------------------------------------------- bar */
      .oly-gate-load { display: flex; flex-direction: column; align-items: stretch; gap: 10px; width: 100%;
        animation: olyGateIn 240ms ease-out both; }
      @keyframes olyGateIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

      .oly-gate-bar { display: flex; align-items: center; gap: 10px; }
      .oly-gate-boss { flex: none; width: 15px; height: 15px; border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #fff6d4, #f6c95f 42%, #a3541b 100%);
        box-shadow: 0 1px 3px rgba(20,4,0,0.8); }
      .oly-gate-track { position: relative; flex: 1; height: 12px; border-radius: 999px; overflow: hidden;
        background: linear-gradient(180deg, #200a1c, #3d1330);
        box-shadow: inset 0 2px 5px rgba(0,0,0,0.8), 0 0 0 2px rgba(246,201,95,0.55); }
      .oly-gate-fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px;
        background: linear-gradient(180deg, #fff3c8 0%, #f6c95f 45%, #d78a2c 100%);
        /* A brighter head on the fill, so the eye follows the edge rather
           than reading the bar as a growing block of colour. */
        box-shadow: 0 0 14px 3px rgba(255,190,70,0.75), inset -6px 0 10px -4px rgba(255,255,240,0.95); }

      .oly-gate-status { display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
        margin: 0; font-family: Cinzel, Georgia, serif; font-size: clamp(11px, 1.05vw, 14px);
        letter-spacing: 0.12em; color: #f0d5a2; text-shadow: 0 2px 8px rgba(0,0,0,0.9); }
      .oly-gate-pct { font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 800;
        font-size: clamp(18px, 2vw, 28px); letter-spacing: 0; color: #ffe9a8;
        font-variant-numeric: tabular-nums; }

      @media (prefers-reduced-motion: reduce) {
        .oly-gate-art { animation: none; }
        .oly-gate-load { animation-duration: 1ms; }
        .oly-gate-play:hover { transform: none; }
      }
    `}</style>
  );
}
