import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { CasinoTile } from "../components/CasinoTile";
import { useCasino } from "../hooks/useCasino";
import { useAuthStore } from "../stores/authStore";
import type { Casino } from "../types";

const PAGE_SIZE = 20;

export function BrowseCasinos() {
  const [casinos, setCasinos] = useState<Casino[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { listJoinableCasinos } = useCasino();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Guards against a slow, stale request overwriting a newer one when the
  // search term changes quickly.
  const requestId = useRef(0);

  const loadPage = useCallback(
    async (offset: number, replace: boolean) => {
      if (!user) return;
      const id = ++requestId.current;
      replace ? setLoading(true) : setLoadingMore(true);
      setError(null);
      try {
        const { casinos: page, hasMore: more } = await listJoinableCasinos({
          userId: user.id,
          search: debouncedSearch,
          offset,
          limit: PAGE_SIZE,
        });
        if (id !== requestId.current) return;
        setCasinos((prev) => (replace ? page : [...prev, ...page]));
        setHasMore(more);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load casinos"
        );
      } finally {
        if (id !== requestId.current) return;
        replace ? setLoading(false) : setLoadingMore(false);
      }
    },
    // listJoinableCasinos is a fresh reference every render (useCasino()
    // isn't memoized) — omit it here to avoid retriggering the effect below.
    [user, debouncedSearch]
  );

  useEffect(() => {
    loadPage(0, true);
  }, [loadPage]);

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back home
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Browse Casinos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Find a casino to join by name or code.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or casino code"
            className="pl-9"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading casinos...</p>
      ) : casinos.length === 0 ? (
        <div className="rounded-xl bg-card border border-border p-8 text-center space-y-3">
          <p className="text-muted-foreground">
            {debouncedSearch
              ? `No casinos match "${debouncedSearch}".`
              : "No casinos to join right now — you're already in all of them, or none exist yet."}
          </p>
          <Button onClick={() => navigate("/create")}>Create a casino</Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {casinos.map((c) => (
              <CasinoTile key={c.id} casino={c} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                disabled={loadingMore}
                onClick={() => loadPage(casinos.length, false)}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
