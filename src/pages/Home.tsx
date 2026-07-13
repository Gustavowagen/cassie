import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Dice5,
  Spade,
  LogIn,
  Plus,
  Compass,
  Share2,
  PlayCircle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { CasinoTile } from "../components/CasinoTile";
import { useCasino } from "../hooks/useCasino";
import { useAuthStore } from "../stores/authStore";
import type { Casino } from "../types";

const TEASER_COUNT = 6;

// Shared frosted-glass surface used across every card on the homepage.
const GLASS = "bg-white/5 backdrop-blur-xl border border-white/10";
const CTA_GRADIENT = "bg-gradient-to-r from-primary to-indigo-400 hover:opacity-90";

interface PlatformStats {
  casinoCount: number;
  playerCount: number;
}

export function Home() {
  const [allCasinos, setAllCasinos] = useState<Casino[]>([]);
  const [myCasinos, setMyCasinos] = useState<Casino[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PlatformStats | null>(null);

  const { listCasinos, listMyCasinos, getPlatformStats } = useCasino();
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();

  // Initial load — fetch all casinos + platform stats always, and joined casinos if signed in.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const tasks: Promise<void>[] = [
      listCasinos(TEASER_COUNT * 4).then((data) => {
        if (!cancelled) setAllCasinos(data);
      }),
      getPlatformStats().then((data) => {
        if (!cancelled) setStats(data);
      }),
    ];
    if (user) {
      tasks.push(
        listMyCasinos(user.id).then((data) => {
          if (!cancelled) setMyCasinos(data);
        }),
      );
    } else {
      setMyCasinos([]);
    }
    Promise.allSettled(tasks).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const myIds = useMemo(
    () => new Set(myCasinos.map((c) => c.id)),
    [myCasinos],
  );

  // Small teaser of casinos not yet joined — full search/pagination lives on /browse.
  const teaser = useMemo(
    () => allCasinos.filter((c) => !myIds.has(c.id)).slice(0, TEASER_COUNT),
    [allCasinos, myIds],
  );

  const displayName = profile?.username ?? user?.email?.split("@")[0] ?? "";

  return (
    <div className="relative isolate overflow-hidden">
      {/* Ambient glow background — contained to this page, doesn't affect Layout or other routes */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute top-32 -right-16 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
      </div>

      <div className="space-y-10">
        {/* HERO BAND */}
        <section
          className={`rounded-2xl ${GLASS} shadow-[0_8px_32px_rgba(124,58,237,0.15)] p-8 md:p-10 flex flex-col md:flex-row gap-8 items-center`}
        >
          <div className="flex-1 space-y-4">
            {user ? (
              <>
                <h1 className="text-3xl md:text-4xl font-bold">
                  Welcome back, {displayName}
                </h1>
                <p className="text-muted-foreground text-lg max-w-xl">
                  The tables are hot and the chips are stacked — jump back into
                  your casinos, or go find your next big win.
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <Button
                    size="lg"
                    className={CTA_GRADIENT}
                    onClick={() => navigate("/create")}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Create casino
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/20 bg-white/5 hover:bg-white/10"
                    onClick={() => navigate("/browse")}
                  >
                    <Compass className="h-4 w-4 mr-1" /> Browse
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-3xl md:text-4xl font-bold">
                  Run your own play-money casino
                </h1>
                <p className="text-muted-foreground text-lg max-w-xl">
                  Free, social, no real money — your friends, your rules.
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <Button
                    size="lg"
                    className={CTA_GRADIENT}
                    onClick={() => navigate("/auth")}
                  >
                    Create account
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/20 bg-white/5 hover:bg-white/10"
                    onClick={() => navigate("/auth")}
                  >
                    Sign in
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* decorative tiles, hidden below md */}
          <div className="hidden md:flex gap-3">
            <div
              className={`h-40 w-32 rounded-xl ${GLASS} flex items-center justify-center`}
            >
              <Dice5 className="h-14 w-14 text-white/80" />
            </div>
            <div
              className={`h-40 w-32 rounded-xl ${GLASS} flex items-center justify-center mt-6`}
            >
              <Spade className="h-14 w-14 text-white/80" />
            </div>
          </div>
        </section>

        {/* STATS STRIP — omitted entirely if the stats fetch fails */}
        {(loading || stats) && (
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`rounded-xl ${GLASS} p-4 text-center`}>
              {loading ? (
                <div className="h-7 mx-auto w-12 rounded bg-white/10 animate-pulse" />
              ) : (
                <div className="text-2xl font-bold">
                  {stats?.casinoCount ?? 0}
                </div>
              )}
              <div className="text-xs text-muted-foreground mt-1">Casinos</div>
            </div>
            <div className={`rounded-xl ${GLASS} p-4 text-center`}>
              {loading ? (
                <div className="h-7 mx-auto w-12 rounded bg-white/10 animate-pulse" />
              ) : (
                <div className="text-2xl font-bold">
                  {stats?.playerCount ?? 0}
                </div>
              )}
              <div className="text-xs text-muted-foreground mt-1">Players</div>
            </div>
            <div
              className={`rounded-xl ${GLASS} p-4 text-center flex flex-col items-center justify-center`}
            >
              <div className="text-2xl font-bold">100%</div>
              <div className="text-xs text-muted-foreground mt-1">
                Free · no real money
              </div>
            </div>
          </section>
        )}

        {/* MY CASINOS or SIGN-IN CALLOUT */}
        {user ? (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold">My Casinos</h2>
              {myCasinos.length > 6 && (
                <Link
                  to="#"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  View all →
                </Link>
              )}
            </div>

            {loading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : myCasinos.length === 0 ? (
              <div className={`rounded-xl ${GLASS} p-8 text-center space-y-3`}>
                <p className="text-muted-foreground">
                  You haven't joined any casinos yet — pick one below or create
                  your own.
                </p>
                <Button
                  className={CTA_GRADIENT}
                  onClick={() => navigate("/create")}
                >
                  <Plus className="h-4 w-4 mr-1" /> Create casino
                </Button>
              </div>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
                {myCasinos.map((c) => (
                  <div key={c.id} className="w-44 sm:w-48 shrink-0 snap-start">
                    <CasinoTile casino={c} isMember />
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section>
            <div
              className={`rounded-xl ${GLASS} p-4 flex items-center justify-between gap-4`}
            >
              <div className="flex items-center gap-3">
                <LogIn className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm">Sign in to track casinos you join.</p>
              </div>
              <Button onClick={() => navigate("/auth")}>Sign in</Button>
            </div>
          </section>
        )}

        {/* HOW IT WORKS — signed-out visitors only */}
        {!user && (
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={`rounded-xl ${GLASS} p-6 space-y-2`}>
              <Plus className="h-6 w-6 text-primary" />
              <h3 className="font-semibold">Create</h3>
              <p className="text-sm text-muted-foreground">
                Start a casino and set the rules.
              </p>
            </div>
            <div className={`rounded-xl ${GLASS} p-6 space-y-2`}>
              <Share2 className="h-6 w-6 text-primary" />
              <h3 className="font-semibold">Invite</h3>
              <p className="text-sm text-muted-foreground">
                Bring your friends in with a join link.
              </p>
            </div>
            <div className={`rounded-xl ${GLASS} p-6 space-y-2`}>
              <PlayCircle className="h-6 w-6 text-primary" />
              <h3 className="font-semibold">Play</h3>
              <p className="text-sm text-muted-foreground">
                Free chips, real bragging rights.
              </p>
            </div>
          </section>
        )}

        {/* DISCOVER */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">Discover</h2>
            <Link
              to="/browse"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Browse all casinos →
            </Link>
          </div>

          {loading ? (
            <p className="text-muted-foreground text-sm">
              Loading casinos...
            </p>
          ) : allCasinos.length === 0 ? (
            <div className={`rounded-xl ${GLASS} p-8 text-center space-y-3`}>
              <p className="text-muted-foreground">
                No casinos yet — be the first to create one.
              </p>
              {user && (
                <Button
                  className={CTA_GRADIENT}
                  onClick={() => navigate("/create")}
                >
                  <Plus className="h-4 w-4 mr-1" /> Create casino
                </Button>
              )}
            </div>
          ) : teaser.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You've joined every casino there is — nice work.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {teaser.map((c) => (
                <CasinoTile key={c.id} casino={c} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
