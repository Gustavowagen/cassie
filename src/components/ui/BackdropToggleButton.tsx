import { Droplet, Square } from "lucide-react";
import { useBackdropToggle } from "./modal";

// Drop into a game's header (mirrors MuteButton's pattern). Renders nothing
// unless its Modal was opened with `backdropToggle`.
export function BackdropToggleButton({
  className = "text-muted-foreground hover:text-foreground",
}: {
  className?: string;
}) {
  const backdrop = useBackdropToggle();
  if (!backdrop) return null;

  return (
    <button
      type="button"
      onClick={backdrop.toggle}
      aria-label={backdrop.solid ? "Use blurred backdrop" : "Use solid backdrop"}
      aria-pressed={backdrop.solid}
      className={`inline-flex transition-colors ${className}`}
    >
      {backdrop.solid ? <Droplet className="h-5 w-5" /> : <Square className="h-5 w-5" />}
    </button>
  );
}
