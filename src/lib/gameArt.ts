// Front-image lookup for each game type, keyed by game_type_id. Shared by
// GameTile (dashboard tile art), the admin Games settings list, and
// GameSettingsModal's image preview.
export const GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  crash: "/games/crash.svg",
  dice: "/games/dice.svg",
  mines: "/games/mines.svg",
  plinko: "/games/plinko.svg",
};
