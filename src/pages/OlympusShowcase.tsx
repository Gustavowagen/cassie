import { useCallback, useEffect, useRef, useState } from "react";
import { OlympusGate } from "../components/games/olympus/OlympusGate";
import { OlympusMachine } from "../components/games/olympus/OlympusMachine";
import { OLY_ART } from "../components/games/olympus/olympusAssets";
import { OLY_DEFAULT_INDEX, OLY_STAKES } from "../components/games/olympus/OlympusBetStepper";
import { OlyLogo, OlympusDefs } from "../components/games/olympus/olympusArt";
import { makeRng, playFreeSpins, playRound } from "../lib/olympusEngine";

// Gates of Olympus, recreated as a showcase — /showcase/olympus.
//
// Deliberately inert: no auth, no casino, no balance, no transactions. The
// page owns the scene — the painted temple, Zeus and the wordmark — and
// OlympusMachine owns the board. The only thing that crosses between them is
// the strike the machine reports when a multiplier lands, which is what makes
// Zeus lift his trident. Nothing else moves him: a paying cascade without a
// multiplier leaves him standing.
//
// The odds ARE the real game's. Rounds are played locally rather than by the
// edge function — there is no casino here to charge — but by the same engine,
// at the same weights, with the same house edge a casino runs by default. It
// used to run deliberately inflated weights to show the multiplier off, which
// meant the one page anyone could look at without signing in was advertising
// odds no casino actually offered.

/** What a showcase round is scored at, since no casino_games row exists. */
const SHOWCASE_HOUSE_EDGE = 0.03;

/** A fresh seed per round — nothing here needs reproducing. */
const seed = () => Math.floor(Math.random() * 1e9);

const TOP_FRAME = OLY_ART.zeusFrames.length - 1;
/** Beat between frames on the way up — quick, so four frames read as one lift. */
const RAISE_STEP_MS = 80;
/** How long the trident stays overhead, through the orb's charge-up. */
const HOLD_MS = 1400;
/** Beat between frames on the way down; slower, so he lowers it rather than drops it. */
const LOWER_STEP_MS = 120;

export function OlympusShowcase() {
  const [entered, setEntered] = useState(false);
  // Counts strikes: each one restarts the lift, and keys the burst so it
  // replays even when two land back to back.
  const [strikes, setStrikes] = useState(0);
  const [frame, setFrame] = useState(0);
  // Read by the lift so it starts from wherever he already is — a second
  // strike mid-hold keeps the trident up instead of snapping him back down.
  const frameRef = useRef(0);
  const [betIndex, setBetIndex] = useState(OLY_DEFAULT_INDEX);

  const enter = useCallback(() => setEntered(true), []);
  const handleStrike = useCallback(() => setStrikes((n) => n + 1), []);

  // The machine asks for a resolved round and does not care who resolved it.
  // In a casino these two go to the edge function; here they are played on the
  // spot, which is the only difference between this page and the real game.
  const spinLocally = useCallback(
    async () => playRound(makeRng(seed()), SHOWCASE_HOUSE_EDGE),
    []
  );
  const buyLocally = useCallback(
    async () => playFreeSpins(makeRng(seed()), SHOWCASE_HOUSE_EDGE),
    []
  );

  useEffect(() => {
    if (strikes === 0) return;
    const show = (f: number) => {
      frameRef.current = f;
      setFrame(f);
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 0;
    for (let f = frameRef.current + 1; f <= TOP_FRAME; f++) {
      timers.push(setTimeout(() => show(f), at));
      at += RAISE_STEP_MS;
    }
    at += HOLD_MS;
    for (let f = TOP_FRAME - 1; f >= 0; f--) {
      timers.push(setTimeout(() => show(f), at));
      at += LOWER_STEP_MS;
    }
    return () => timers.forEach(clearTimeout);
  }, [strikes]);

  return (
    <>
      <OlympusDefs />
      <h1 className="sr-only">Gates of Olympus — design showcase</h1>

      {entered ? (
        <div className="oly-scene">
          <SceneStyles />

          <div className="oly-backdrop" aria-hidden />
          <div className="oly-veil" aria-hidden />

          <div className="oly-stage">
            {/* No freeSpinsCost: the coin shows no price because nothing is
                charged for it here. */}
            <OlympusMachine
              onStrike={handleStrike}
              stakes={OLY_STAKES}
              betIndex={betIndex}
              onBetIndexChange={setBetIndex}
              onSpin={spinLocally}
              onBuyFreeSpins={buyLocally}
            />
          </div>

          <div className="oly-zeus-wrap" aria-hidden>
            <OlyLogo className="oly-logo" />
            {/* All four frames stay mounted and only the current one shows, so
                a frame change is a hard cut between already-decoded images —
                the way a sprite animates. Swapping one src could flash blank
                while the next frame decodes. */}
            <div className="oly-zeus">
              {/* Ahead of the frames in the DOM, so it backlights him. Laid
                  over the top it only washed out against the blue water he
                  is already wreathed in. */}
              {strikes > 0 && <span className="oly-burst" key={strikes} />}
              {OLY_ART.zeusFrames.map((src, i) => (
                <img
                  key={src}
                  className={[
                    "oly-zeus-img",
                    i === frame ? "oly-zeus-on" : "",
                    i === TOP_FRAME ? "oly-zeus-top" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  src={src}
                  alt=""
                />
              ))}
            </div>
          </div>

          <p className="oly-note">
            A recreation at the real game's odds. Nothing here is wagered, won, or recorded.
          </p>
        </div>
      ) : (
        <OlympusGate onEnter={enter} />
      )}
    </>
  );
}

function SceneStyles() {
  return (
    <style>{`
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

      /* Board and Zeus are one centred lockup rather than a centred board
         with Zeus pinned to the right edge — pinned, he left a dead third of
         the screen empty on the left at desktop widths. */
      .oly-scene { position: relative; min-height: 100vh; min-height: 100dvh; width: 100%; overflow: hidden;
        display: flex; align-items: center; justify-content: center; gap: clamp(0px, 1.5vw, 34px);
        padding: clamp(16px, 3vh, 56px) clamp(12px, 2vw, 40px); isolation: isolate;
        background: #150a24; animation: olySceneIn 600ms ease-out both; }
      @keyframes olySceneIn { from { opacity: 0; } to { opacity: 1; } }

      /* The painted temple. Held back a stop so the gold cabinet and Zeus are
         the brightest things on screen rather than competing with the sky. */
      .oly-backdrop { position: absolute; inset: 0; z-index: -3;
        background: url("${OLY_ART.scene}") center / cover no-repeat;
        filter: brightness(0.6) saturate(1.06); }
      /* Darkest at the very bottom, where the readouts and the note sit over
         the gold floor, and along the top where the board's plaque rises. */
      .oly-veil { position: absolute; inset: 0; z-index: -2;
        background:
          radial-gradient(78% 62% at 50% 52%, rgba(28,6,44,0.62) 0%, rgba(28,6,44,0.18) 55%, rgba(28,6,44,0) 100%),
          linear-gradient(180deg, rgba(14,3,26,0.62) 0%, rgba(14,3,26,0) 24%,
            rgba(14,3,26,0) 58%, rgba(11,2,20,0.82) 100%); }

      .oly-stage { position: relative; z-index: 2; flex: 0 1 auto; }

      /* Zeus stands beside the board on wide screens. Below that the board
         needs the full width, so the whole lockup steps above it.
         The column takes the full height and splits: wordmark up in the sky,
         Zeus down on the marble. Centred as one block he hovered a good
         fifty pixels clear of the painted floor. */
      .oly-zeus-wrap { position: relative; z-index: 1; flex: 0 0 auto; align-self: stretch;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        gap: clamp(4px, 1vh, 18px); padding: clamp(6px, 2vh, 30px) 0; pointer-events: none; }
      /* Gold letters land on the brightest part of the painted sky, so the
         wordmark carries its own shadow rather than relying on contrast that
         is not there. */
      .oly-logo { width: clamp(150px, 16vw, 320px); height: auto;
        filter: drop-shadow(0 2px 3px rgba(28,6,0,0.95)) drop-shadow(0 0 16px rgba(24,4,20,0.85))
          drop-shadow(0 6px 22px rgba(20,4,0,0.7)); }

      /* The box is cut to the standing figure: frame one fills only the
         bottom 590px of the 1004px canvas the frames share. The frames are
         anchored to its floor and grow up out of it, so the lifted trident
         rises into the sky rather than the standing pose carrying a tower of
         empty space that would shove the wordmark around. The vh term keeps
         the fully raised frame clear of the wordmark — any taller and the
         water round the trident washed over "OLYMPUS". */
      .oly-zeus { position: relative; width: clamp(150px, min(26vw, 31.5vh), 480px); aspect-ratio: 415 / 590; }
      .oly-zeus-img { position: absolute; bottom: 0; left: 0; width: 100%; height: auto; max-width: none; opacity: 0;
        /* Warm light off the temple on one side, a cool cast shadow on the
           other, so he sits in the scene instead of on top of it. */
        filter: drop-shadow(6px -2px 10px rgba(255,214,140,0.45)) drop-shadow(-10px 14px 30px rgba(30,4,30,0.7)); }
      .oly-zeus-on { opacity: 1; }

      /* The flash lands when the trident reaches the top, so the lift reads
         first and the lightning answers it.

         brightness(0) invert(1) is the whole trick: it crushes the sprite to
         a pure white silhouette through its own alpha, which is what a strike
         actually looks like. Raising brightness instead only washed him out
         to milk. Every keyframe carries the same filter functions in the same
         order, or the browser has nothing to interpolate between. */
      .oly-zeus-top.oly-zeus-on { animation: olyZeusFlash 700ms ease-out; }
      @keyframes olyZeusFlash {
        0% { filter: brightness(0) invert(1) saturate(1)
          drop-shadow(0 0 46px rgba(255,255,255,0.95)) drop-shadow(0 0 66px rgba(150,200,255,0.9)); }
        10% { filter: brightness(1.15) invert(0.35) saturate(0.5)
          drop-shadow(0 0 26px rgba(225,242,255,0.85)) drop-shadow(-6px 10px 26px rgba(30,4,30,0.5)); }
        30% { filter: brightness(1.1) invert(0) saturate(0.95)
          drop-shadow(4px -2px 12px rgba(220,238,255,0.6)) drop-shadow(-10px 14px 30px rgba(30,4,30,0.65)); }
        100% { filter: brightness(1) invert(0) saturate(1)
          drop-shadow(6px -2px 10px rgba(255,214,140,0.45)) drop-shadow(-10px 14px 30px rgba(30,4,30,0.7)); }
      }

      /* A hard white flash behind him as the multiplier lands. Centred high,
         where the trident ends up, not on his torso. */
      .oly-burst { position: absolute; left: 50%; top: 0; width: 230%; aspect-ratio: 1;
        transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none;
        background: radial-gradient(circle, rgba(255,255,250,1) 0%, rgba(224,240,255,0.95) 15%,
          rgba(140,190,255,0.62) 31%, rgba(70,120,255,0.18) 47%, rgba(50,90,255,0) 64%);
        animation: olyBurst 900ms cubic-bezier(0.1, 0.7, 0.3, 1) forwards; }
      @keyframes olyBurst {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
        8% { opacity: 1; transform: translate(-50%, -50%) scale(0.78); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
      }

      .oly-note { position: absolute; z-index: 2; left: 50%; bottom: clamp(8px, 1.6vh, 22px); transform: translateX(-50%);
        margin: 0; font-family: Cinzel, Georgia, serif; font-size: clamp(9px, 0.85vw, 12px); letter-spacing: 0.14em;
        color: rgba(255,238,210,0.72); text-shadow: 0 1px 6px rgba(20,4,0,0.9);
        max-width: min(92vw, 640px); text-align: center; }

      @media (max-width: 1100px) {
        .oly-zeus-wrap { flex-direction: row; align-self: auto; align-items: flex-end; justify-content: center;
          order: -1; padding: 0; margin-bottom: 4px; }
        .oly-scene { flex-direction: column; justify-content: center; gap: clamp(6px, 1.4vh, 18px); }
        .oly-zeus { width: clamp(84px, 16vw, 150px); }
        .oly-logo { width: clamp(120px, 22vw, 200px); }
      }
      @media (max-width: 640px) {
        .oly-note { font-size: 9px; }
      }

      /* The lift itself is a handful of hard cuts, not travel, so it stays.
         The flash and the burst are what go. */
      @media (prefers-reduced-motion: reduce) {
        .oly-scene, .oly-zeus-top.oly-zeus-on { animation: none; }
        .oly-burst { display: none; }
      }
    `}</style>
  );
}
