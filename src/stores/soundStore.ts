import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SoundState {
  muted: boolean;
  toggleMuted: () => void;
  setMuted: (muted: boolean) => void;
}

// Persisted so the choice sticks across games and sessions.
export const useSoundStore = create<SoundState>()(
  persist(
    (set) => ({
      muted: false,
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
      setMuted: (muted) => set({ muted }),
    }),
    { name: "oc-sound" }
  )
);
