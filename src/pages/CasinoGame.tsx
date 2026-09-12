import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useCasino } from "../hooks/useCasino";
import { useGames } from "../hooks/useGames";
import { useBalance } from "../hooks/useBalance";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import type { CasinoGame, OlympusInstanceSettings } from "../types";
import { Olympus } from "../components/games/Olympus";

// The fullscreen route a big game opens on: /casino/:slug/play/:gameId.
//
// Quick games (dice, mines, blackjack…) still open in the dashboard's modal —
// they're a panel of controls and finish in a second. A big game is a painted
// scene with its own cabinet, and boxing that into a modal on top of the lobby
// wasted most of the screen, so it gets a page and the whole viewport.
//
// :gameId is the casino_games row id rather than the game type, because a
// casino can run two instances of the same game at different bet limits and
// the URL has to say which table you sat down at.

/**
 * Big games with a fullscreen implementation on this page, keyed by
 * game_type_id. Always a subset of the types `isBigGame` accepts: the lobby
 * only ever sends a big game here, and this is what stops one that has been
 * categorised but not yet built from rendering a blank page.
 */
const FULLSCREEN_GAME_IDS = new Set(["olympus"]);

export function CasinoGame() {
  const { slug, gameId } = useParams<{ slug: string; gameId: string }>();
  const navigate = useNavigate();
  const { getCasinoBySlug } = useCasino();
  const { listCasinoGames } = useGames();
  const { currentCasino, membership, setCasino } = useCasinoStore();
  const { user, loading: authLoading } = useAuthStore();

  const [game, setGame] = useState<CasinoGame | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { loading: balanceLoading } = useBalance(currentCasino?.id);

  const casinoReady = currentCasino?.slug === slug;

  useEffect(() => {
    if (!slug || casinoReady) return;
    getCasinoBySlug(slug).then((c) => (c ? setCasino(c) : setNotFound(true)));
  }, [slug, casinoReady]);

  useEffect(() => {
    if (!currentCasino || !casinoReady || !gameId) return;
    // Read fresh rather than trusting anything the lobby loaded earlier, so a
    // player always sits down to the admin's current bet limits and settings.
    listCasinoGames(currentCasino.id).then((games) => {
      const found = games.find((g) => g.id === gameId);
      if (found) setGame(found);
      else setNotFound(true);
    });
  }, [currentCasino?.id, casinoReady, gameId]);

  const exit = () => navigate(`/casino/${slug}`);

  if (!authLoading && !user) return <Navigate to="/auth" replace />;
  // Anything that isn't a live fullscreen game at this casino goes back to the
  // lobby — a deleted game, a hand-typed id, a quick game's id pasted into a
  // fullscreen URL, or a member-only game reached by someone who hasn't
  // joined yet (the casino page is where they can).
  if (notFound) return <Navigate to={`/casino/${slug}`} replace />;
  if (game && !FULLSCREEN_GAME_IDS.has(game.game_type_id))
    return <Navigate to={`/casino/${slug}`} replace />;
  if (casinoReady && !balanceLoading && !membership)
    return <Navigate to={`/casino/${slug}`} replace />;

  // The game seeds its balance from this prop once and then drives it from
  // settled responses, so it must not mount before the membership row is in —
  // seeded at 0 it would refuse every bet until the page was reloaded.
  if (!currentCasino || !game || !membership) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    );
  }

  const settings = game.settings as OlympusInstanceSettings | undefined;

  return (
    <>
      {game.game_type_id === "olympus" && (
        <Olympus
          casinoId={currentCasino.id}
          gameId={game.id}
          // Mirrors the olympus edge function's DEFAULT_HOUSE_EDGE fallback
          // (supabase/functions/olympus/engine.ts) for rows whose settings an
          // admin hasn't touched yet.
          houseEdge={settings?.houseEdge ?? 0.03}
          // Defaults ON, matching freeSpinsEnabled() server-side: the feature
          // buy is part of the game, so an unconfigured row plays the whole
          // thing rather than a cut-down version.
          freeSpinsEnabled={settings?.freeSpins?.enabled !== false}
          balance={membership.balance}
          minBet={game.min_bet}
          maxBet={game.max_bet}
          onExit={exit}
        />
      )}
    </>
  );
}
