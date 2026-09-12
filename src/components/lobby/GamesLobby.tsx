import { useMemo, useState } from "react";
import { ChevronDown, Gamepad2, LayoutGrid, List, Search } from "lucide-react";
import { GameTile } from "../GameTile";
import {
  LOBBY_CATEGORIES,
  countByCategory,
  filterLobbyGames,
  lobbyAccentVars,
  type LobbyFilter,
} from "../../lib/lobby";
import { cn } from "../../lib/utils";
import type { Casino, CasinoGame } from "../../types";
import { FeaturedBanner } from "./FeaturedBanner";
import { LobbySidebar } from "./LobbySidebar";
import { LobbyTopBar } from "./LobbyTopBar";
import { PromoCards } from "./PromoCards";
import { RecentWins } from "./RecentWins";
import { ACCENT_CTA, ACCENT_SOFT, ACCENT_TEXT, GLASS, SWIPE_ROW } from "./styles";

interface Props {
  casino: Casino;
  balance: number;
  games: CasinoGame[];
  isPlayable: (game: CasinoGame) => boolean;
  onPlay: (game: CasinoGame) => void;
  onBack: () => void;
  canAdmin: boolean;
  codeCopied: boolean;
  onCopyCode: () => void;
}

// The casino's Games tab: top bar, desktop category rail, featured banner,
// daily cards, recent wins and the game grid. Search and category filters
// work on the loaded game list; features without a backend render as inert
// buttons (marked "No functionality yet").
export function GamesLobby({ casino, balance, games, isPlayable, onPlay, onBack, canAdmin, codeCopied, onCopyCode }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LobbyFilter>("all");

  const counts = useMemo(() => countByCategory(games), [games]);
  const accentVars = useMemo(() => lobbyAccentVars(casino.theme.primaryColor), [casino.theme.primaryColor]);
  // "Lobby" (filter "all") is the only view with the promo chrome; picking a
  // category turns the tab into a plain page of just that category's games.
  const isLobbyHome = filter === "all";
  const heading = isLobbyHome ? "Featured Games" : LOBBY_CATEGORIES.find((c) => c.id === filter)?.label;
  // Home only shows what the admin has featured; category browsing always
  // shows every game in that category regardless of the flag, so nothing
  // becomes unreachable.
  const homeGames = useMemo(() => games.filter((g) => g.is_featured), [games]);
  const visible = useMemo(
    () => filterLobbyGames(isLobbyHome ? homeGames : games, filter, query),
    [games, homeGames, isLobbyHome, filter, query]
  );

  function showAll() {
    setQuery("");
    setFilter("all");
  }

  return (
    <div className="relative isolate" style={accentVars}>
      <div aria-hidden className="pointer-events-none absolute -inset-x-4 -top-6 bottom-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[rgb(var(--lobby-accent)/0.3)] blur-3xl" />
        <div className="absolute -right-16 top-32 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute left-1/3 top-[760px] h-72 w-72 rounded-full bg-[rgb(var(--lobby-accent)/0.15)] blur-3xl" />
      </div>

      <div className="space-y-4 lg:space-y-5">
        <LobbyTopBar
          casino={casino}
          balance={balance}
          query={query}
          onQueryChange={setQuery}
          onBack={onBack}
          codeCopied={codeCopied}
          onCopyCode={onCopyCode}
        />

        <div className="lg:flex lg:items-start lg:gap-5">
          <LobbySidebar
            className="hidden lg:flex"
            filter={filter}
            onFilter={setFilter}
            counts={counts}
            joinCode={casino.join_code}
            codeCopied={codeCopied}
            onCopyCode={onCopyCode}
            rules={casino.rules}
          />

          <div className="min-w-0 flex-1 space-y-6 lg:space-y-7">
            {isLobbyHome && (
              <>
                <FeaturedBanner />
                <PromoCards />
                <RecentWins />
              </>
            )}

            <section className="space-y-3 md:space-y-3.5">
              <div className={cn(SWIPE_ROW, "gap-2 md:mx-0 md:px-0 lg:hidden")}>
                <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                  Featured
                </FilterChip>
                {LOBBY_CATEGORIES.map((c) => (
                  <FilterChip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
                    {c.shortLabel}
                  </FilterChip>
                ))}              </div>

              <div className="flex h-9 items-center gap-2.5">
                <span className={cn(ACCENT_SOFT, ACCENT_TEXT, "flex h-6 w-6 items-center justify-center rounded-[7px]")}>
                  <Gamepad2 className="h-3.5 w-3.5" />
                </span>
                <h2 className="text-lg font-bold">{heading}</h2>
                <span className="text-[13px] text-slate-500">{visible.length}</span>
                {/* No functionality yet. */}
                <div className="ml-auto hidden items-center gap-2 sm:flex">
                  <button
                    type="button"
                    className={cn(GLASS, "flex h-[34px] items-center gap-1.5 rounded-[10px] pl-3 pr-2.5 text-[13px] font-semibold text-slate-300 transition-colors hover:bg-white/10")}
                  >
                    <span className="font-medium text-slate-500">Sort:</span>
                    Most played
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <div className={cn(GLASS, "flex gap-0.5 rounded-[10px] p-[3px]")}>
                    <button type="button" aria-label="Grid view" className="flex h-[26px] w-7 items-center justify-center rounded-[7px] bg-white/10 text-foreground">
                      <LayoutGrid className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label="List view" className="flex h-[26px] w-7 items-center justify-center rounded-[7px] text-slate-500 hover:text-slate-300">
                      <List className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {games.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
                  <p>No games available yet.</p>
                  {canAdmin && <p className="text-sm text-primary">Add games from the Settings tab →</p>}
                </div>
              ) : visible.length === 0 ? (
                <div className={cn(GLASS, "flex flex-col items-center gap-2 rounded-2xl px-6 py-10 text-center")}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.06] text-slate-500">
                    <Search className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-bold">
                    {query.trim() ? `No games match “${query.trim()}”` : "No games in this category yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">Try a different name, or browse another category.</p>
                  <button type="button" onClick={showAll} className={cn(ACCENT_TEXT, "text-xs font-semibold hover:underline")}>
                    Show all games
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-3.5 xl:grid-cols-5 2xl:grid-cols-6">
                  {visible.map((g) => (
                    <GameTile key={g.id} game={g} playable={isPlayable(g)} onPlay={() => onPlay(g)} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-[34px] shrink-0 snap-start items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
        active ? ACCENT_CTA : cn(GLASS, "text-slate-300 hover:bg-white/10"),
      )}
    >
      {children}
    </button>
  );
}
