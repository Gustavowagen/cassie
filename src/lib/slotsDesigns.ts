import type { SlotSymbolId } from "../types";

// Catalogue of selectable visual designs for the slots game. Functionality
// (odds, payouts, reward mode, house edge) never varies by design — this only
// controls how the reels look. Picked via GameSettingsModal's design picker
// and stored as SlotsInstanceSettings.design; rendered in Slots.tsx.
//
// Every design skins the same 5 abstract symbol slots (dot/square/diamond/
// star/seven, in ascending pay order) with different icon art. `className`
// is the icon's outer CSS hook (see SlotsThemeStyles in Slots.tsx); `parts`
// are nested sub-shapes rendered as empty <i> elements the CSS positions
// absolutely; `text` is literal glyph content (only Neon Rush and Golden
// Harvest render their top symbol as a glowing "7" — the rest use art).
export interface SlotIconSpec {
  className: string;
  parts?: string[];
  text?: string;
}

export interface SlotsDesign {
  id: string;
  name: string;
  description: string;
  preview: {
    gradient: string;
    accent: string;
    dotColors: string[];
  };
  // CSS class applied to the reels-wrap element; theme rules in
  // SlotsThemeStyles are scoped under `.sl-reels-wrap.<themeClass>` /
  // `.<themeClass> <descendant>`.
  themeClass: string;
  icons: Record<SlotSymbolId, SlotIconSpec>;
}

export const SLOTS_DESIGNS: SlotsDesign[] = [
  {
    id: "default",
    name: "Neon Rush",
    description: "Neon-glow reels with pink payline arrows and particle bursts on a win.",
    preview: {
      gradient: "linear-gradient(160deg, #1b1530 0%, #120e22 100%)",
      accent: "#ff5fd1",
      dotColors: ["#33e6ff", "#4bffb0", "#c86bff", "#ff4fc3", "#ffe066"],
    },
    themeClass: "sl-theme-default",
    icons: {
      dot: { className: "sl-sym-dot" },
      square: { className: "sl-sym-square" },
      diamond: { className: "sl-sym-diamond" },
      star: { className: "sl-sym-star" },
      seven: { className: "sl-sym-seven", text: "7" },
    },
  },
  {
    id: "fruit",
    name: "Golden Harvest",
    description: "Warm gold reels with juicy cherries, citrus, and a lucky 7.",
    preview: {
      gradient: "linear-gradient(165deg, oklch(0.19 0.05 30) 0%, oklch(0.12 0.04 25) 100%)",
      accent: "oklch(0.75 0.15 70)",
      dotColors: ["oklch(0.55 0.19 25)", "oklch(0.85 0.15 95)", "oklch(0.7 0.17 45)"],
    },
    themeClass: "sl-theme-fruit",
    icons: {
      dot: { className: "sl-fr-cherry", parts: ["sl-stem sl-l", "sl-stem sl-r", "sl-leaf", "sl-ball sl-l", "sl-ball sl-r"] },
      square: { className: "sl-fr-lemon", parts: ["sl-body"] },
      diamond: { className: "sl-fr-orange", parts: ["sl-body", "sl-leaf"] },
      star: { className: "sl-fr-bell", parts: ["sl-body", "sl-clap"] },
      seven: { className: "sl-fr-seven", text: "7" },
    },
  },
  {
    id: "egypt",
    name: "Pharaoh's Fortune",
    description: "Sun-baked gold and lapis reels with ankhs, scarabs, and pyramids.",
    preview: {
      gradient: "linear-gradient(165deg, oklch(0.15 0.03 210) 0%, oklch(0.09 0.02 215) 100%)",
      accent: "oklch(0.72 0.13 85)",
      dotColors: ["oklch(0.75 0.13 80)", "oklch(0.55 0.1 195)", "oklch(0.85 0.14 82)"],
    },
    themeClass: "sl-theme-egypt",
    icons: {
      dot: { className: "sl-eg-ankh", parts: ["sl-loop", "sl-stem", "sl-bar"] },
      square: { className: "sl-eg-scarab", parts: ["sl-body", "sl-spine", "sl-head"] },
      diamond: { className: "sl-eg-pyramid", parts: ["sl-body", "sl-shade"] },
      star: { className: "sl-eg-eye", parts: ["sl-brow", "sl-almond", "sl-pupil", "sl-tail", "sl-curl"] },
      seven: { className: "sl-eg-sun", parts: ["sl-disc", "sl-ring"] },
    },
  },
  {
    id: "sea",
    name: "Abyssal Riches",
    description: "Deep-teal reels with pearls, shells, and a treasure chest jackpot.",
    preview: {
      gradient: "linear-gradient(165deg, oklch(0.15 0.045 255) 0%, oklch(0.08 0.03 258) 100%)",
      accent: "oklch(0.72 0.12 195)",
      dotColors: ["oklch(0.9 0.02 220)", "oklch(0.65 0.15 30)", "oklch(0.72 0.12 195)"],
    },
    themeClass: "sl-theme-sea",
    icons: {
      dot: { className: "sl-sea-pearl", parts: ["sl-body", "sl-glint"] },
      square: { className: "sl-sea-shell", parts: ["sl-body", "sl-rib sl-r1", "sl-rib sl-r2", "sl-rib sl-r3"] },
      diamond: { className: "sl-sea-anchor", parts: ["sl-ring", "sl-stem", "sl-bar", "sl-arm sl-l", "sl-arm sl-r"] },
      star: { className: "sl-sea-star" },
      seven: { className: "sl-sea-chest", parts: ["sl-lid", "sl-body", "sl-lock"] },
    },
  },
];

export const DEFAULT_SLOTS_DESIGN_ID = SLOTS_DESIGNS[0].id;

export function getSlotsDesign(id: string | undefined): SlotsDesign {
  return SLOTS_DESIGNS.find((d) => d.id === id) ?? SLOTS_DESIGNS[0];
}
