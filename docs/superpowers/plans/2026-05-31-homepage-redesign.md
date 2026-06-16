# Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `Home.tsx` with a Stake-inspired dark homepage featuring a hero band, a "My Casinos" row of joined casinos, and a searchable Discover grid — so users can both join and create casinos from a single landing page.

**Architecture:** All work is client-side React (Vite + TS + Tailwind + Supabase). One Supabase migration adds a denormalized `member_count` column on `casinos` (kept in sync by a trigger) so casino tiles can display member counts without bumping into the `casino_members` RLS policy. A new `CasinoTile` component replaces the old `CasinoCard`. The `Home.tsx` page composes hero + (My Casinos | sign-in callout) + Discover. Layout/nav and the dark palette are polished alongside.

**Tech Stack:** React 18 · TypeScript · Vite · Tailwind v3 · Supabase (Postgres + Auth) · React Router v6 · Zustand · lucide-react.

**Environmental notes for the implementer:**
- This project is **not** currently a git repo (`git status` will error). The commit steps below are best-effort — if `git status` works, run them; otherwise skip the commit step and move on. Alternatively, `git init && git add -A && git commit -m "baseline"` at the start of Task 1 if you want history.
- There is **no test runner** installed. Each task's verification is a manual check in the browser (dev server) with explicit expected behavior.
- Run the dev server once with `npm run dev` and keep it open in another terminal — Vite HMR will reload as you save. The app is at `http://localhost:5173`.
- The Supabase project is `online-cassie` (`tvivhadsgtvfvxwpahef`). Apply the migration with the Supabase MCP `apply_migration` tool (or via `supabase db push` if you have the CLI set up locally).

---

## File map

| File | Action | Owner / purpose |
|---|---|---|
| `supabase/migrations/006_member_count.sql` | **Create** | Denormalized `member_count` column + trigger |
| `src/types/index.ts` | **Modify** | Add `member_count: number` to `Casino` |
| `src/lib/utils.ts` | **Modify** | Add `gradientFromColor(hex)` helper |
| `index.html` | **Modify** | Set `<html class="dark">` |
| `src/index.css` | **Modify** | New `.dark` palette values |
| `src/hooks/useCasino.ts` | **Modify** | Add `listMyCasinos(userId)` |
| `src/components/CasinoTile.tsx` | **Create** | New tile component (4:5 art + footer) |
| `src/components/CasinoCard.tsx` | **Delete** | Replaced by CasinoTile |
| `src/components/Layout.tsx` | **Modify** | Nav surface + gradient avatar |
| `src/pages/Home.tsx` | **Rewrite** | Hero + My Casinos / callout + Discover |

Order: tasks are arranged so each step compiles cleanly with everything before it. Tasks 1–4 are leaf changes; Task 5 depends on the type from Task 2; Task 6 depends on Tasks 2 and 3; Task 8 depends on Tasks 5, 6, and 7.

---

## Task 1: Add `member_count` to casinos table

**Files:**
- Create: `supabase/migrations/006_member_count.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/006_member_count.sql`:

```sql
alter table public.casinos
  add column member_count int not null default 0;

-- Backfill existing rows
update public.casinos c
set member_count = (
  select count(*) from public.casino_members m where m.casino_id = c.id
);

create or replace function public.casinos_member_count_sync()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.casinos
      set member_count = member_count + 1
      where id = new.casino_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.casinos
      set member_count = greatest(member_count - 1, 0)
      where id = old.casino_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger casino_members_count_sync
  after insert or delete on public.casino_members
  for each row execute function public.casinos_member_count_sync();
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool:
- `name`: `006_member_count`
- `query`: (the full SQL above)

Or via CLI: `supabase db push`.

- [ ] **Step 3: Verify the column exists and trigger fires**

Use Supabase MCP `execute_sql` (or psql):

```sql
-- Confirm column
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'casinos' and column_name = 'member_count';
-- Expected: 1 row, type int, default 0
```

Then confirm the trigger fires by joining a casino (any casino, any user) and checking the count incremented. If you have an existing casino + user:

```sql
select id, name, member_count from public.casinos limit 5;
-- Note current counts.
```

Then join via the app (or `select join_casino('<casino_id>')` as that user) and re-run the select — `member_count` should be +1.

- [ ] **Step 4: Commit (if git repo)**

```bash
git add supabase/migrations/006_member_count.sql
git commit -m "feat(db): add member_count counter to casinos"
```

---

## Task 2: Add `member_count` to Casino TypeScript type

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Update the `Casino` interface**

In `src/types/index.ts`, modify the `Casino` interface — add `member_count: number;` just before `created_at`:

```ts
export interface Casino {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  theme: CasinoTheme;
  settings: CasinoSettings;
  is_active: boolean;
  member_count: number;
  created_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: TS build succeeds. (Any existing usage of `Casino` that didn't construct one — only reads — keeps working.)

If you see errors in places that construct a `Casino` literal (none expected in current code), default `member_count` to `0` there.

- [ ] **Step 3: Commit (if git repo)**

```bash
git add src/types/index.ts
git commit -m "feat(types): add member_count to Casino"
```

---

## Task 3: Add `gradientFromColor` utility

**Files:**
- Modify: `src/lib/utils.ts`

- [ ] **Step 1: Add the helper at the bottom of `src/lib/utils.ts`**

```ts
// Parse a #rrggbb or #rgb hex string into HSL components.
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) {
    // Fallback to the app's primary purple if input is malformed.
    return { h: 263, s: 70, l: 50 };
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      case b: hue = (r - g) / d + 4; break;
    }
    hue *= 60;
  }
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Returns a CSS linear-gradient value going from the input color (top)
// to a darker variant (bottom). Use as: style={{ background: gradientFromColor(hex) }}
export function gradientFromColor(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  const topL = Math.min(l, 55);
  const botL = Math.max(topL - 30, 8);
  return `linear-gradient(180deg, hsl(${h} ${s}% ${topL}%), hsl(${h} ${s}% ${botL}%))`;
}
```

- [ ] **Step 2: Quick sanity check in browser console**

Run dev server (`npm run dev`), open `http://localhost:5173`, open DevTools console, paste:

```js
// crude smoke-test — paste into console after temporarily exposing the helper.
// (Or just trust it; you'll see the gradient render in Task 6.)
```

You don't need to exhaustively test this — it gets visually verified in Task 6 when tiles render.

- [ ] **Step 3: Commit (if git repo)**

```bash
git add src/lib/utils.ts
git commit -m "feat(utils): add gradientFromColor helper"
```

---

## Task 4: Lock app to dark theme + new palette

**Files:**
- Modify: `index.html`
- Modify: `src/index.css`

- [ ] **Step 1: Force dark mode in `index.html`**

Change the `<html>` opening tag:

```html
<html lang="en" class="dark">
```

- [ ] **Step 2: Update the `.dark` palette in `src/index.css`**

Replace the existing `.dark` block (lines 27–45) with:

```css
.dark {
  --background: 220 35% 8%;
  --foreground: 210 40% 98%;
  --card: 220 30% 12%;
  --card-foreground: 210 40% 98%;
  --primary: 263.4 70% 50.4%;
  --primary-foreground: 210 40% 98%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;
  --border: 220 25% 18%;
  --input: 220 25% 18%;
  --ring: 263.4 70% 50.4%;
}
```

Only `--background`, `--card`, `--border`, and `--input` actually changed; the rest match the previous values exactly. Keep the `:root` (light) block untouched.

- [ ] **Step 3: Verify in browser**

Run `npm run dev` if not already running. Visit `http://localhost:5173/`.

Expected:
- Page background is deep teal-navy (~`#0f1923`), not pure black.
- Existing cards (the old `CasinoCard`s, if any casinos exist) render on a slightly lighter surface.
- Nothing flashes white on initial paint.

If you see a white flash, you forgot to add `class="dark"` to `<html>` — go back to Step 1.

- [ ] **Step 4: Commit (if git repo)**

```bash
git add index.html src/index.css
git commit -m "feat(ui): lock to dark theme with Stake-inspired teal-navy palette"
```

---

## Task 5: Add `listMyCasinos` to the casino hook

**Files:**
- Modify: `src/hooks/useCasino.ts`

- [ ] **Step 1: Add the function inside `useCasino()`**

Insert this function alongside the existing ones (above the `return` statement):

```ts
async function listMyCasinos(userId: string): Promise<Casino[]> {
  const { data, error } = await supabase
    .from("casino_members")
    .select("casino:casinos(*)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((row: { casino: Casino | null }) => row.casino)
    .filter((c): c is Casino => c !== null);
}
```

- [ ] **Step 2: Add it to the returned object**

Change the final `return` line to include `listMyCasinos`:

```ts
return { createCasino, joinCasino, listCasinos, listMyCasinos, getCasinoBySlug };
```

> **Why the explicit `.eq("user_id", userId)` filter:** the `casino_members` RLS policy is "Casino members can view all members of same casino" — without the filter, the query returns every co-member of every casino the user is in, not just the user's own membership rows. Filtering by `user_id` matches the user's own rows exactly.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build`
Expected: passes.

- [ ] **Step 4: Commit (if git repo)**

```bash
git add src/hooks/useCasino.ts
git commit -m "feat(hooks): add listMyCasinos to useCasino"
```

---

## Task 6: Create `CasinoTile` component

**Files:**
- Create: `src/components/CasinoTile.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/CasinoTile.tsx`:

```tsx
import { useNavigate } from "react-router-dom";
import { gradientFromColor } from "../lib/utils";
import type { Casino } from "../types";

interface Props {
  casino: Casino;
  isMember?: boolean;
}

// Subtle grain overlay — a tiny SVG noise tiled at low opacity to break up the gradient.
const GRAIN_DATA_URI =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>";

export function CasinoTile({ casino, isMember }: Props) {
  const navigate = useNavigate();
  const { theme, member_count, name, slug } = casino;
  const hasBg = Boolean(theme.backgroundUrl);
  const memberLabel =
    member_count === 0
      ? "Be the first to join"
      : `${member_count} member${member_count === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={() => navigate(`/casino/${slug}`)}
      className="group block w-full text-left overflow-hidden rounded-xl bg-card border border-border transition duration-150 hover:-translate-y-1 hover:shadow-[0_0_24px_rgba(255,255,255,0.06)] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
    >
      {/* Art area, 4:5 portrait */}
      <div
        className="relative aspect-[4/5] w-full"
        style={
          hasBg
            ? undefined
            : { background: gradientFromColor(theme.primaryColor) }
        }
      >
        {hasBg && (
          <img
            src={theme.backgroundUrl!}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {/* grain overlay */}
        <div
          aria-hidden
          className="absolute inset-0 mix-blend-overlay pointer-events-none"
          style={{ backgroundImage: `url("${GRAIN_DATA_URI}")` }}
        />
        {/* bottom gradient for legibility */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent"
        />

        {/* logo top-left */}
        {theme.logoUrl && (
          <img
            src={theme.logoUrl}
            alt=""
            className="absolute top-2 left-2 h-10 w-10 rounded-md object-cover border border-white/20 bg-black/30"
          />
        )}

        {/* joined pill top-right */}
        {isMember && (
          <span className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-white/15 backdrop-blur px-2 py-0.5 text-white">
            Joined
          </span>
        )}

        {/* name bottom-left */}
        <div className="absolute bottom-2 left-3 right-3">
          <h3 className="text-white font-bold text-lg leading-tight line-clamp-2 drop-shadow">
            {name}
          </h3>
        </div>
      </div>

      {/* Footer strip */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
        />
        <span>{memberLabel}</span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Add `line-clamp` to Tailwind if not present**

Check `tailwind.config.ts` — Tailwind v3 ships `line-clamp-*` utilities by default since 3.3, so no plugin is needed. If `npm run build` later complains, add `@tailwindcss/line-clamp` plugin. (You likely won't need to.)

- [ ] **Step 3: Verify the component compiles**

Run: `npm run build`
Expected: passes. (You won't see the tile in a browser yet — it's wired up in Task 8.)

- [ ] **Step 4: Commit (if git repo)**

```bash
git add src/components/CasinoTile.tsx
git commit -m "feat(ui): add CasinoTile component"
```

---

## Task 7: Polish `Layout.tsx` (nav surface + avatar)

**Files:**
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: Replace the entire file**

Overwrite `src/components/Layout.tsx` with:

```tsx
import { Link, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { useAuthStore } from "../stores/authStore";

// Stable gradient per username — hash to a hue.
function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 70% 55%), hsl(${h2} 70% 40%))`;
}

function initialsOf(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, signOut } = useAuthStore();
  const navigate = useNavigate();
  const displayName = profile?.username ?? user?.email ?? "";

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold tracking-tight">
          OnlineCassie
        </Link>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ background: avatarGradient(displayName) }}
                >
                  {initialsOf(displayName)}
                </div>
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {displayName}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => signOut().then(() => navigate("/"))}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => navigate("/auth")}>
              Sign in
            </Button>
          )}
        </div>
      </nav>
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
```

Changes vs. previous version:
- Nav surface uses `bg-card border-border` (slightly brighter than page background).
- New `avatarGradient(seed)` + `initialsOf(seed)` helpers (kept local — not worth exporting).
- Gradient avatar circle next to username; username is hidden below `sm` (640px).
- Main container padding `py-8` → `py-6`.

- [ ] **Step 2: Verify in browser**

With dev server running, visit `http://localhost:5173/`.

Expected:
- Nav has a darker-than-page bar with a subtle bottom border.
- Signed-out: just shows `Sign in` button (no avatar).
- Signed-in: gradient avatar circle with first-letter-of-username; username text visible on desktop only.
- Other pages (e.g. `/auth`) still render correctly with the new padding.

- [ ] **Step 3: Commit (if git repo)**

```bash
git add src/components/Layout.tsx
git commit -m "feat(ui): polish nav with elevated surface + gradient avatar"
```

---

## Task 8: Rewrite `Home.tsx`

**Files:**
- Rewrite: `src/pages/Home.tsx`
- Delete: `src/components/CasinoCard.tsx`

- [ ] **Step 1: Overwrite `src/pages/Home.tsx`**

```tsx
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
```

- [ ] **Step 2: Delete the old `CasinoCard.tsx`**

It's no longer imported anywhere (the only consumer was the old `Home.tsx`, now rewritten):

```bash
# Verify nothing imports it (should print nothing):
grep -rn "CasinoCard" src
```

If clean, delete:

```bash
rm src/components/CasinoCard.tsx
```

PowerShell equivalent:

```powershell
Remove-Item src/components/CasinoCard.tsx
```

- [ ] **Step 3: Run a build**

Run: `npm run build`
Expected: passes with no TS errors.

If you see a `line-clamp-2` warning, install the plugin:
```bash
npm i -D @tailwindcss/line-clamp
```
and add it to `tailwind.config.ts` `plugins` array. (Usually not needed on Tailwind 3.3+.)

- [ ] **Step 4: Verify in browser — acceptance checklist**

With `npm run dev` running, test each scenario:

**Signed-out:**
- [ ] Visit `/` while signed out. Hero shows "Run your own play-money casino" + `Create account` / `Sign in` buttons.
- [ ] Sign-in callout appears (icon + "Sign in to track casinos you join." + `Sign in` button).
- [ ] Discover grid renders with all active casinos. No `Joined` pills.
- [ ] Clicking any tile navigates to `/casino/{slug}` which prompts you to sign in (existing CasinoDashboard behavior — unchanged).

**Signed-in with zero joined casinos:**
- [ ] Sign in (via `/auth`). Hero shows "Welcome back, {username}" + `Create casino` / `Browse` buttons.
- [ ] Clicking `Browse` smooth-scrolls to the Discover section.
- [ ] My Casinos section shows the empty-state panel: "You haven't joined any casinos yet — …" + `Create casino` button.
- [ ] Discover grid renders without any `Joined` pills.

**Signed-in with ≥1 joined casino:**
- [ ] Join a casino (click a tile → CasinoDashboard → `Join Casino`).
- [ ] Return to `/`. My Casinos row shows that casino with a horizontally-scrollable layout.
- [ ] The same casino in the Discover grid now has a `Joined` pill.
- [ ] The `member_count` on the tile incremented by 1 (compare to before joining).

**Search:**
- [ ] Type a few characters in the Discover search box. The grid filters live (after ~150ms debounce).
- [ ] Clear the search. The full grid returns.
- [ ] Type a query that matches nothing. The "No casinos match …" line appears.

**Responsive:**
- [ ] Resize to ~375px wide (Chrome DevTools mobile). No horizontal page scroll. Decorative hero tiles hidden. Discover grid is 2 columns. My Casinos still scrolls horizontally with touch.
- [ ] At ~1280px+ Discover grid is 5 columns; at ~1024px it's 4; at ~640px it's 3; below that it's 2.

**Theme:**
- [ ] No white flash on initial paint. Page background is deep teal-navy.
- [ ] No console errors on first paint of `/`.

If any item fails, fix and re-verify before moving on.

- [ ] **Step 5: Commit (if git repo)**

```bash
git add -A
git commit -m "feat(home): redesign homepage with hero, my casinos, and discover sections"
```

---

## Done

All spec acceptance criteria covered. The homepage now supports joining and creating casinos with a Stake-inspired dark aesthetic, while preserving the existing `CasinoDashboard` join-flow. No games are exposed directly from the homepage — all paths into game UI go through `/casino/{slug}`.
