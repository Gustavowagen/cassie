import { Volume2, VolumeX } from "lucide-react";
import { useSoundStore } from "../../stores/soundStore";

// Global toggle for all synthesized game sound effects (src/lib/sound.ts).
// Drop into any game's header; pass className to match that game's theme.
export function MuteButton({ className = "text-muted-foreground hover:text-foreground" }: { className?: string }) {
  const muted = useSoundStore((s) => s.muted);
  const toggleMuted = useSoundStore((s) => s.toggleMuted);

  return (
    <button
      type="button"
      onClick={toggleMuted}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      aria-pressed={muted}
      className={`transition-colors ${className}`}
    >
      {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
    </button>
  );
}
