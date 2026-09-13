// Painted art for Gates of Olympus, served from public/olympus.
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

import type { OlySymbolId } from "../../../lib/olympusEngine";

export const OLY_ART = {
  /** The temple on the clouds. Backdrop for the board. */
  scene: "/olympus/gates-bg.webp",
  /**
   * Zeus lifting his trident, in order. The first is how he stands between
   * strikes, trident lowered; the last holds it overhead.
   */
  zeusFrames: [1, 2, 3, 4].map((n) => `/olympus/zeus-${n}.webp`),
} as const;

export const symbolSrc = (id: OlySymbolId) => `/olympus/symbols/${id}.webp`;

/** The winged badge for a multiplier value. Only ORB_VALUES have one. */
export const multiplierSrc = (value: number) => `/olympus/multipliers/${value}.webp`;
