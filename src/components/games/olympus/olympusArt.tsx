// The Gates of Olympus showcase's art components.
//
// The symbols, the multiplier badges, Zeus and the scene are painted art
// loaded from public/olympus (see olympusAssets.ts). Only the wordmark stays
// inline SVG, because it sets live text on a curve.
//
// Gradients live in one <OlympusDefs /> rendered once per page and everything
// references them by id.

import type { OlySymbolId } from "../../../lib/olympusEngine";
import { multiplierSrc, symbolSrc } from "./olympusAssets";

// Deliberately not exported: a module that exports both components and a
// plain value loses React Fast Refresh, and this file is the one most likely
// to be edited repeatedly while tuning the art.
const OLY = {
  goldHi: "#fdf3c4",
  gold: "#f6c95f",
  goldMid: "#d78a2c",
  goldDeep: "#8b4415",
  goldShadow: "#4d2110",
} as const;

export function OlympusDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id="olyGold" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor={OLY.goldHi} />
          <stop offset="26%" stopColor={OLY.gold} />
          <stop offset="58%" stopColor={OLY.goldMid} />
          <stop offset="82%" stopColor={OLY.goldDeep} />
          <stop offset="100%" stopColor={OLY.goldShadow} />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** One reel symbol, drawn to fill whatever box it is given. */
export function OlySymbolArt({ id }: { id: OlySymbolId }) {
  return (
    <img
      src={symbolSrc(id)}
      className="oly-sym"
      alt=""
      aria-hidden
      draggable={false}
      // Every symbol is on screen from the first paint, and a lazy one would
      // pop in a frame late as the board refills mid-cascade.
      decoding="sync"
    />
  );
}

/**
 * The multiplier orb, as its painted winged badge. The number is part of the
 * art, so this can only show a value the engine deals (ORB_VALUES).
 */
export function OlyOrbArt({ value }: { value: number }) {
  return (
    <img
      src={multiplierSrc(value)}
      className="oly-sym oly-badge"
      alt=""
      aria-hidden
      draggable={false}
      decoding="sync"
    />
  );
}


/**
 * Wordmark. "GATES OF" curves over "OLYMPUS" the way the reference sets it.
 * The arc's radius is deliberately large: a tight radius across a 268px chord
 * pushes the curve's apex above the viewBox and the text is clipped away.
 */
export function OlyLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 142" className={className} aria-label="Gates of Olympus">
      <defs>
        <path id="olyArc" d="M 26 96 A 280 280 0 0 1 294 96" fill="none" />
      </defs>
      <text
        fontFamily="Cinzel, Georgia, serif"
        fontSize="27"
        fontWeight="700"
        letterSpacing="3"
        fill="url(#olyGold)"
        stroke={OLY.goldShadow}
        strokeWidth="0.9"
      >
        <textPath href="#olyArc" startOffset="50%" textAnchor="middle">
          GATES OF
        </textPath>
      </text>
      <text
        x="160"
        y="132"
        textAnchor="middle"
        fontFamily="Cinzel, Georgia, serif"
        fontSize="46"
        fontWeight="900"
        letterSpacing="1"
        fill="url(#olyGold)"
        stroke={OLY.goldShadow}
        strokeWidth="1.2"
      >
        OLYMPUS
      </text>
    </svg>
  );
}
