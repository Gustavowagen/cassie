import type { GameType } from "../types";

const GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  crash: "/games/crash.svg",
  dice: "/games/dice.svg",
};

interface Props {
  game: GameType;
  onPlay: (id: string) => void;
}

export function GameTile({ game, onPlay }: Props) {
  const art = GAME_ART[game.id];

  return (
    <button
      type="button"
      onClick={() => onPlay(game.id)}
      className="group relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-card transition duration-150 hover:-translate-y-1 hover:shadow-[0_0_24px_rgba(255,255,255,0.08)] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
    >
      {art && (
        <img
          src={art}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      )}

      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 p-3 text-left">
        <h3 className="text-white font-bold text-sm md:text-base leading-tight drop-shadow">
          {game.name}
        </h3>
        <span className="text-[11px] font-medium text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity">
          Play now →
        </span>
      </div>
    </button>
  );
}
