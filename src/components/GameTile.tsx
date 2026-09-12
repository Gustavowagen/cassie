import { Play } from "lucide-react";
import type { CasinoGame } from "../types";
import { GAME_ART } from "../lib/gameArt";
import { categoryLabel } from "../lib/lobby";
import { cn } from "../lib/utils";

interface Props {
  game: CasinoGame;
  playable: boolean;
  onPlay: (id: string) => void;
}

// Lobby game tile. Hover lifts it, rings it in the lobby accent and swaps the
// category line for the bet limits.
export function GameTile({ game, playable, onPlay }: Props) {
  const art = GAME_ART[game.game_type_id];
  const category = categoryLabel(game.game_type_id);
  const limits = `Bets ${game.min_bet.toLocaleString("en-US")} – ${game.max_bet.toLocaleString("en-US")}`;

  return (
    <div
      className={cn(
        "group relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-card transition duration-150",
        playable
          ? "hover:-translate-y-1 hover:border-transparent hover:shadow-[0_0_0_2px_rgb(var(--lobby-accent)),0_14px_32px_rgb(var(--lobby-accent)/0.35)]"
          : "opacity-75",
      )}
    >
      <button
        type="button"
        onClick={() => onPlay(game.id)}
        disabled={!playable}
        aria-label={playable ? `Play ${game.custom_name}` : `${game.custom_name} — coming soon`}
        className="absolute inset-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
      >
        {art && (
          <img
            src={art}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        )}
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_80%_at_25%_0%,rgba(255,255,255,0.16),rgba(255,255,255,0)_55%)]" />
        {playable && (
          <div aria-hidden className="absolute inset-0 bg-background/35 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 to-transparent" />

        {playable && (
          <span
            aria-hidden
            className="absolute left-1/2 top-[42%] flex h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 scale-90 items-center justify-center rounded-full bg-[linear-gradient(90deg,rgb(var(--lobby-accent)),#818cf8)] opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition duration-150 group-hover:scale-100 group-hover:opacity-100"
          >
            <Play className="ml-[3px] h-5 w-5 fill-white text-white" />
          </span>
        )}

        <div className="absolute inset-x-3 bottom-[11px] flex flex-col gap-1">
          <h3 className="text-[15px] font-extrabold leading-[1.1] tracking-[-0.01em] text-white drop-shadow md:text-base">
            {game.custom_name}
          </h3>
          {playable ? (
            <span className="text-[11px] font-medium text-white/70">
              <span className="group-hover:hidden">{category}</span>
              <span className="hidden text-emerald-300 group-hover:inline">{limits}</span>
            </span>
          ) : (
            <span className="text-[11px] font-medium text-white/50">Coming soon</span>
          )}
        </div>
      </button>
    </div>
  );
}
