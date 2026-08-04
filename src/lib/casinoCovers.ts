// Curated cover images casinos can pick from — since users can't upload
// their own images yet, this is the only source of casino.theme.backgroundUrl.
// Shared between the create-casino flow and the casino settings tab so both
// pickers always offer the same set.
export const COVER_PRESETS = [
  { id: "neon-roulette", url: "/casino-covers/neon-roulette.svg", label: "Neon Roulette" },
  { id: "champagne-toast", url: "/casino-covers/champagne-toast.svg", label: "Champagne Toast" },
  { id: "jackpot-slots", url: "/casino-covers/jackpot-slots.svg", label: "Jackpot Slots" },
  { id: "high-roller-dice", url: "/casino-covers/high-roller-dice.svg", label: "High Roller Dice" },
  { id: "vegas-skyline", url: "/casino-covers/vegas-skyline.svg", label: "Vegas Skyline" },
] as const;
