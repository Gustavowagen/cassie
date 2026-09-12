import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { GAME_ART } from "../../lib/gameArt";
import { SAMPLE_RECENT_WINS } from "../../lib/lobby";
import { avatarGradient, cn, initialsOf } from "../../lib/utils";
import { ChipIcon } from "./LobbyArt";
import { GLASS, SWIPE_ROW } from "./styles";

// Top edge tint per game, so the strip reads as a mix at a glance.
const WIN_TINT: Record<string, string> = {
  crash: "#fb923c",
  tumble: "#22d3ee",
  blackjack: "#34d399",
  slots: "#a78bfa",
  mines: "#4ade80",
  roulette: "#f87171",
  plinko: "#60a5fa",
  dice: "#3b82f6",
};

// Sample content until a casino-wide wins feed exists — see SAMPLE_RECENT_WINS.
export function RecentWins() {
  return (
    <section className="space-y-2.5 md:space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-rose-500/[0.18] text-rose-400">
          <Trophy className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-[15px] font-bold">Recent wins</h2>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/[0.12] px-2 py-0.5 text-[10px] font-extrabold tracking-[0.08em] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          LIVE
        </span>
        {/* No functionality yet. */}
        <div className="ml-auto hidden gap-1.5 md:flex">
          <button type="button" aria-label="Previous" className={cn(GLASS, "flex h-7 w-7 items-center justify-center rounded-lg text-slate-500")}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Next" className={cn(GLASS, "flex h-7 w-7 items-center justify-center rounded-lg text-slate-300")}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className={cn(SWIPE_ROW, "gap-2 md:mx-0 md:px-0 xl:grid xl:grid-cols-7 xl:gap-2.5")}>
        {SAMPLE_RECENT_WINS.map((win) => (
          <div
            key={win.user}
            className="relative flex w-[118px] shrink-0 snap-start flex-col items-center gap-1.5 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.075] to-white/[0.025] px-2 pb-3 pt-[15px] sm:w-[136px] xl:w-auto"
          >
            <span
              className="absolute left-1/2 top-0 h-[3px] w-10 -translate-x-1/2 rounded-b-[3px] sm:w-11"
              style={{ background: WIN_TINT[win.gameTypeId] ?? "#a78bfa" }}
            />
            <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-emerald-300 sm:text-sm">
              <ChipIcon className="h-3.5 w-3.5" />+{win.amount.toLocaleString("en-US")}
            </span>
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] sm:h-[30px] sm:w-[30px]"
              style={{ background: avatarGradient(win.user) }}
            >
              {initialsOf(win.user)}
            </span>
            <span className="text-[11px] text-muted-foreground">@{win.user} won in</span>
            <span className="flex max-w-full items-center gap-1.5 text-xs font-bold">
              {GAME_ART[win.gameTypeId] && (
                <img src={GAME_ART[win.gameTypeId]} alt="" className="h-4 w-4 shrink-0 rounded sm:h-[18px] sm:w-[18px] sm:rounded-[5px]" />
              )}
              <span className="truncate">{win.gameName}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
