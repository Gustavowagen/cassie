import { Info } from "lucide-react";

// Toggles a game's body between its play view and its rules panel. Mirrors
// MuteButton/BackdropToggleButton's pattern — drop into any game's header,
// pass className to match that game's theme.
export function GameInfoButton({
  active,
  onClick,
  className = "text-muted-foreground hover:text-foreground",
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? "Back to game" : "Game info"}
      aria-pressed={active}
      className={`inline-flex transition-colors ${className}`}
    >
      <Info className="h-5 w-5" />
    </button>
  );
}
