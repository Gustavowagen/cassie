import { create } from "zustand";
import type { Casino, CasinoMember, GameType } from "../types";

interface CasinoState {
  currentCasino: Casino | null;
  membership: CasinoMember | null;
  enabledGames: GameType[];
  setCasino: (casino: Casino | null) => void;
  setMembership: (m: CasinoMember | null) => void;
  setEnabledGames: (games: GameType[]) => void;
}

export const useCasinoStore = create<CasinoState>((set) => ({
  currentCasino: null,
  membership: null,
  enabledGames: [],
  setCasino: (casino) => set({ currentCasino: casino }),
  setMembership: (membership) => set({ membership }),
  setEnabledGames: (enabledGames) => set({ enabledGames }),
}));
