import type { GameInfoEntry } from "../../lib/gameInfo";

// Renders in place of a game's body when its info toggle is active. Plain
// bg-card/foreground tokens so it reads correctly inside every game's theme,
// including Blackjack's dark glass theme.
export function GameInfoPanel({ info, onBack }: { info: GameInfoEntry; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-card p-5 text-foreground">
      <div>
        <h3 className="text-lg font-bold">{info.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{info.description}</p>
      </div>
      {info.rules && info.rules.length > 0 && (
        <div>
          <p className="text-sm font-semibold">Rules</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {info.rules.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={onBack}
        className="mt-auto self-start rounded-full border border-border bg-muted/60 px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
      >
        Back to game
      </button>
    </div>
  );
}
