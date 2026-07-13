# Homepage Glassmorphic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the homepage (`src/pages/Home.tsx`) into a "Glassmorphic Dark" look — frosted-glass cards over a contained ambient violet/blue glow — while preserving every existing behavior (auth-state hero copy, My Casinos row, Discover teaser grid, all empty states), and add two new pieces of content: a live stats strip and a "How it works" strip for signed-out visitors.

**Architecture:** Two files change. `src/hooks/useCasino.ts` gets one new function, `getPlatformStats()`, using two count-only Supabase queries (no schema changes). `src/pages/Home.tsx` is rewritten in place: same state/effect logic as today plus one more fetch, wrapped in a new visual shell (glass surfaces + a scoped background glow layer) with two new sections spliced into the existing section order. `Layout.tsx` and `CasinoTile.tsx` are untouched, so no other route is visually affected.

**Tech Stack:** React 18 · TypeScript · Vite · Tailwind v3 (core utilities only — no config changes) · Supabase · React Router v6 · lucide-react.

**Environmental notes for the implementer:**
- Dev server: `npm run dev` (http://localhost:5173). Vite HMR reloads on save — keep it running through both tasks.
- No test runner covers React components/hooks in this repo (vitest is configured only for the Supabase edge-function game engines under `supabase/functions/*/engine.test.ts`). Verification here is manual, in the browser, with explicit expected behavior per step — same approach used in the prior `docs/superpowers/plans/2026-05-31-homepage-redesign.md`.
- The Supabase project is `online-cassie` (`tvivhadsgtvfvxwpahef`). Nothing in this plan requires a migration.
- Sign in with the seeded test account (`claudetest.cassie@gmail.com` / `ClaudeTest123!`) for the signed-in verification steps.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `src/hooks/useCasino.ts` | **Modify** | Add `getPlatformStats()` — casino + player counts |
| `src/pages/Home.tsx` | **Rewrite** | Glass visual shell, stats strip, how-it-works strip, existing sections restyled |

Order: Task 1 first — Task 2's `Home.tsx` rewrite calls `getPlatformStats()`, so the hook function must exist first for the page to compile.

---

## Task 1: Add `getPlatformStats` to the casino hook

**Files:**
- Modify: `src/hooks/useCasino.ts`

- [ ] **Step 1: Add the function inside `useCasino()`**

In `src/hooks/useCasino.ts`, add this function alongside the existing ones (above the final `return` statement):

```ts
async function getPlatformStats(): Promise<{
  casinoCount: number;
  playerCount: number;
}> {
  const [casinos, profiles] = await Promise.all([
    supabase
      .from("casinos")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("profiles").select("*", { count: "exact", head: true }),
  ]);
  if (casinos.error) throw casinos.error;
  if (profiles.error) throw profiles.error;
  return {
    casinoCount: casinos.count ?? 0,
    playerCount: profiles.count ?? 0,
  };
}
```

> Both queries use `head: true` so Postgres returns only the row count, not the rows themselves — cheap even as the tables grow. `casinos` is filtered to `is_active = true` to match what the Discover section already considers "live". Both tables are publicly selectable under existing RLS (`casinos` active rows, and the "Public profiles are viewable by everyone" policy on `profiles`), so no policy changes are needed.

- [ ] **Step 2: Add it to the returned object**

Update the final `return` statement in `useCasino.ts` to include `getPlatformStats`:

```ts
return {
  createCasino,
  joinCasino,
  listCasinos,
  listJoinableCasinos,
  listMyCasinos,
  getCasinoBySlug,
  getCasinoMembers,
  giveChips,
  removeChips,
  setMemberRole,
  getMemberProfitLoss,
  listChipTransactions,
  getPlatformStats,
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds with no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCasino.ts
git commit -m "feat(hooks): add getPlatformStats to useCasino"
```

---

## Task 2: Rewrite `Home.tsx` with the glassmorphic redesign

**Files:**
- Rewrite: `src/pages/Home.tsx`

- [ ] **Step 1: Overwrite `src/pages/Home.tsx`**

```tsx
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
```

- [ ] **Step 2: Run a build**

Run: `npm run build`
Expected: passes with no TS errors.

- [ ] **Step 3: Verify in browser — signed-out**

With `npm run dev` running, visit `http://localhost:5173/` signed out (sign out first if needed).

Expected:
- Deep violet/blue blurred glow visible behind the page content; it does not extend into the nav bar above it and does not cause horizontal or extra vertical scroll.
- Hero is a frosted glass card: "Run your own play-money casino" copy, gradient `Create account` button, glass-outlined `Sign in` button.
- Stats strip renders below the hero: two numeric pills (Casinos, Players) with real counts once loaded (skeleton pulses briefly first), plus the static "100% · Free no real money" pill.
- Sign-in callout renders (icon + "Sign in to track casinos you join." + `Sign in` button), glass-styled.
- "How it works" strip renders with 3 cards: Create / Invite / Play.
- Discover section renders the casino grid (or the empty state if no casinos exist), glass-styled headings/empty-states, tiles look the same as before (unchanged `CasinoTile`).

- [ ] **Step 4: Verify in browser — signed-in**

Sign in with `claudetest.cassie@gmail.com` / `ClaudeTest123!`. Visit `/`.

Expected:
- Hero shows "Welcome back, ClaudeTest" copy, gradient `Create casino` button, glass `Browse` button routing to `/browse`.
- Stats strip still renders.
- "My Casinos" row renders (this account is admin in all casinos, so it should show tiles, not the empty state) — horizontally scrollable, glass empty-state styling would only show if the account had zero casinos.
- **"How it works" strip does NOT render** (signed-in only excludes it).
- Discover grid still renders, with `Joined` pills on casinos this account is a member of.

- [ ] **Step 5: Verify other routes are unaffected**

Visit `/browse` and open any `/casino/:slug` dashboard.

Expected: both look exactly as they did before this change — no glass background, no gradient buttons leaking in. (Confirms the background layer and `GLASS`/`CTA_GRADIENT` constants are scoped to `Home.tsx` and not touching `Layout.tsx` or shared components.)

- [ ] **Step 6: Verify responsive layout**

Resize the browser (or use DevTools device toolbar) to ~375px wide.

Expected:
- No horizontal page scroll.
- Hero decorative tiles hidden (as before).
- Stats strip and how-it-works strip stack to a single column.
- Discover grid is 2 columns; My Casinos row still scrolls horizontally by touch/drag.

- [ ] **Step 7: Check for console errors**

With DevTools console open, reload `/` in both auth states.

Expected: no errors logged on first paint.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "feat(home): redesign homepage with glassmorphic dark aesthetic"
```

---

## Done

Both spec sections are implemented: the homepage now uses the Glassmorphic Dark visual system (contained ambient glow + frosted-glass cards + gradient CTAs), with a new stats strip and how-it-works strip, while every existing behavior (auth-state copy, My Casinos, Discover teaser, empty states, routing) is unchanged. `Layout.tsx`, `CasinoTile.tsx`, and all other routes are untouched.
