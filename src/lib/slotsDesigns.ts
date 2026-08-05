// Catalogue of selectable visual designs for the slots game. Functionality
// (odds, payouts, reward mode, house edge) never varies by design — this only
// controls how the reels look. Picked via GameSettingsModal's design picker
// and stored as SlotsInstanceSettings.design; rendered in Slots.tsx.
export interface SlotsDesign {
  id: string;
  name: string;
  description: string;
  preview: {
    gradient: string;
    accent: string;
    dotColors: string[];
  };
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
  },
];

export const DEFAULT_SLOTS_DESIGN_ID = SLOTS_DESIGNS[0].id;

export function getSlotsDesign(id: string | undefined): SlotsDesign {
  return SLOTS_DESIGNS.find((d) => d.id === id) ?? SLOTS_DESIGNS[0];
}
