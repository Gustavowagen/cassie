import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Dice5, Spade, LogIn, Search, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { CasinoTile } from "../components/CasinoTile";
import { useCasino } from "../hooks/useCasino";
import { useAuthStore } from "../stores/authStore";
import type { Casino } from "../types";

export function Home() {
  const [allCasinos, setAllCasinos] = useState<Casino[]>([]);
  const [myCasinos, setMyCasinos] = useState<Casino[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { listCasinos, listMyCasinos } = useCasino();
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();

  // Initial load — fetch all casinos always, and joined casinos if signed in.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const tasks: Promise<void>[] = [
      listCasinos().then((data) => {
        if (!cancelled) setAllCasinos(data);
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

  // Debounce search input (~150ms).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const myIds = useMemo(
    () => new Set(myCasinos.map((c) => c.id)),
    [myCasinos],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return allCasinos;
    return allCasinos.filter((c) => c.name.toLowerCase().includes(q));
  }, [allCasinos, debouncedSearch]);

  const displayName = profile?.username ?? user?.email?.split("@")[0] ?? "";

  return (
    <div className="space-y-10">
      {/* HERO BAND */}
      <section className="rounded-2xl bg-card border border-border p-8 md:p-10 flex flex-col md:flex-row gap-8 items-center">
        <div className="flex-1 space-y-4">
          {user ? (
            <>
              <h1 className="text-3xl md:text-4xl font-bold">
                Welcome back, {displayName}
              </h1>
              <p className="text-muted-foreground text-lg max-w-xl">
                Jump back into your casinos or start a new one.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button size="lg" onClick={() => navigate("/create")}>
                  <Plus className="h-4 w-4 mr-1" /> Create casino
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    document
                      .getElementById("discover")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  Browse
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
                <Button size="lg" onClick={() => navigate("/auth")}>
                  Create account
                </Button>
                <Button
                  size="lg"
                  variant="outline"
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
          <div className="h-40 w-32 rounded-xl bg-gradient-to-br from-primary/40 to-primary/10 border border-border flex items-center justify-center">
            <Dice5 className="h-14 w-14 text-white/80" />
          </div>
          <div className="h-40 w-32 rounded-xl bg-gradient-to-br from-emerald-500/30 to-emerald-700/10 border border-border flex items-center justify-center mt-6">
            <Spade className="h-14 w-14 text-white/80" />
          </div>
        </div>
      </section>

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
            <div className="rounded-xl bg-card border border-border p-8 text-center space-y-3">
              <p className="text-muted-foreground">
                You haven't joined any casinos yet — pick one below or create
                your own.
              </p>
              <Button onClick={() => navigate("/create")}>
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
          <div className="rounded-xl bg-card border border-border p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <LogIn className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm">
                Sign in to track casinos you join.
              </p>
            </div>
            <Button onClick={() => navigate("/auth")}>Sign in</Button>
          </div>
        </section>
      )}

      {/* DISCOVER */}
      <section id="discover" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-xl font-bold">Discover</h2>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search casinos"
              className="pl-9"
            />
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground text-sm">Loading casinos...</p>
        ) : allCasinos.length === 0 ? (
          <div className="rounded-xl bg-card border border-border p-8 text-center space-y-3">
            <p className="text-muted-foreground">
              No casinos yet — be the first to create one.
            </p>
            {user && (
              <Button onClick={() => navigate("/create")}>
                <Plus className="h-4 w-4 mr-1" /> Create casino
              </Button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No casinos match "{debouncedSearch}".
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map((c) => (
              <CasinoTile key={c.id} casino={c} isMember={myIds.has(c.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
