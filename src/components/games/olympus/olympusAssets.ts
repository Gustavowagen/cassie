// Painted art for the Gates of Olympus showcase, served from public/olympus.
//
// The source sheets live in gates_insp/ (untracked): the symbols were sliced
// out of one sheet by their alpha bounding boxes and squared. Zeus's four
// frames (god_frames.png) and the four multiplier badges (multipliers.png)
// were cut apart along seams through the transparent gaps between them, and
// the Zeus frames were registered on his boots onto one shared canvas, so his
// feet stay planted while only the trident arm moves.
//
// Kept apart from olympusArt.tsx on purpose: that module exports components
// and would lose React Fast Refresh if it also exported plain values.

import { ORB_VALUES, SYMBOLS, type OlySymbolId } from "../../../lib/olympusEngine";

export const OLY_ART = {
  /** The temple on the clouds. Backdrop for the board. */
  scene: "/olympus/gates-bg.webp",
  /** Zeus against the storm. Backdrop for the loading gate. */
  gate: "/olympus/loading.webp",
  /**
   * Zeus lifting his trident, in order. The first is how he stands between
   * strikes, trident lowered; the last holds it overhead.
   */
  zeusFrames: [1, 2, 3, 4].map((n) => `/olympus/zeus-${n}.webp`),
} as const;

export const symbolSrc = (id: OlySymbolId) => `/olympus/symbols/${id}.webp`;

/** The winged badge for a multiplier value. Only ORB_VALUES have one. */
export const multiplierSrc = (value: number) => `/olympus/multipliers/${value}.webp`;

/**
 * What the loading bar is actually waiting for, in the order it reports.
 * Named stages rather than one flat list so the gate can say which group is
 * still arriving instead of inventing a status line.
 */
export const OLY_LOADING_STAGES: { label: string; sources: string[] }[] = [
  // Taken from the engine's own lists rather than copies of them, so a symbol
  // or multiplier added later cannot quietly go unloaded.
  { label: "Loading symbols", sources: SYMBOLS.map(symbolSrc) },
  { label: "Loading multipliers", sources: ORB_VALUES.map(multiplierSrc) },
  { label: "Loading the temple", sources: [OLY_ART.scene] },
  { label: "Loading Zeus", sources: OLY_ART.zeusFrames },
];

/** Resolves once the image is decoded, and also if it fails — the gate must
 *  never strand someone behind a bar that will not fill. */
export function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });
}
