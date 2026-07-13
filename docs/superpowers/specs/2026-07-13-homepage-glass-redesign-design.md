# Homepage Glassmorphic Redesign — Design Spec

**Date:** 2026-07-13
**Status:** Approved (awaiting plan)
**Author:** brainstormed with Claude

## Goal

Restyle the existing homepage (`src/pages/Home.tsx`) into a "Glassmorphic Dark" aesthetic — frosted-glass cards floating over a deep violet ambient glow — while preserving every piece of existing functionality (auth-state copy, My Casinos row, Discover grid + search-adjacent behavior, empty states). Add two small new pieces of value: a live stats strip and a "How it works" onboarding strip for signed-out visitors.

This restyles on top of the structure established by the prior `2026-05-31-homepage-redesign` spec — that work is not being redone, only re-skinned and extended.

## Non-goals

- No changes to `Layout.tsx`, global CSS variables, or any other route (`/browse`, `/casino/:slug`). The glass background treatment is contained entirely within `Home.tsx`'s own wrapper.
- No changes to `CasinoTile.tsx` — it's shared with `/browse` and the dashboard; restyling it would leak the new look onto pages this work doesn't touch.
- No light-mode variant of the glass treatment (app is dark-only per existing `index.html`/`index.css` setup).
- No live/real-time stats (no websockets, no polling) — the stats strip fetches once on page load, same lifecycle as the existing casino lists.
- No fabricated data — every number shown must come from a real query. The "100% free" line is static copy, not a stat.
- No schema/migration changes. Stats are served by count-only queries against existing tables.

## Visual system

- `Home.tsx`'s root element becomes `relative overflow-hidden` (previously a plain `space-y-10` div) so decorative background elements can be clipped to the homepage only.
- Background layer: 2–3 absolutely-positioned `div`s with large blurred radial gradients (violet `#7c3aed`-ish and blue `#3b82f6`-ish), `blur-3xl`, low opacity (~15-20%), `pointer-events-none`, `z-0`. Positioned so they sit loosely behind the hero and stats strip (the areas with the most visual weight).
- All page content is wrapped in a `relative z-10` container so it renders above the background layer.
- Card surfaces across the page (hero, stats pills, sign-in callout, empty states, how-it-works cards) switch from `bg-card border-border` to a glass treatment: `bg-white/5 backdrop-blur-xl border border-white/10`, with the hero additionally getting a soft glow shadow (`shadow-[0_8px_32px_rgba(124,58,237,0.15)]` or similar).
- Primary CTAs (`Create casino`, `Create account`) switch from flat `bg-primary` to a gradient: `bg-gradient-to-r from-primary to-indigo-400`. Secondary/outline buttons keep the existing `variant="outline"` from the `Button` component, unchanged.
- No Tailwind config changes needed — `backdrop-blur`, `blur-3xl`, and arbitrary-value shadows are all core utilities already available.

## Hero section

- Same two-variant copy/CTA logic as today (signed-in "Welcome back, {name}" vs signed-out "Run your own play-money casino") — text and routing unchanged.
- Container restyled to the glass treatment described above.
- Decorative side tiles (currently flat gradient chips with `Dice5`/`Spade` icons) restyled to glass: `bg-white/5 backdrop-blur border border-white/10`, icons unchanged.

## New: stats strip

- Placed directly below the hero, visible in both auth states.
- Row of glass pill-cards (3 total):
  1. **Casinos** — count of active casinos.
  2. **Players** — count of registered profiles.
  3. **100% free · no real money** — static trust badge, not a data-driven stat.
- Data source: new `useCasino().getPlatformStats()`:
  ```ts
  async function getPlatformStats(): Promise<{ casinoCount: number; playerCount: number }> {
    const [casinos, profiles] = await Promise.all([
      supabase.from("casinos").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
    ]);
    return {
      casinoCount: casinos.count ?? 0,
      playerCount: profiles.count ?? 0,
    };
  }
  ```
  Both tables are publicly selectable under existing RLS (`casinos.is_active = true` rows, and all `profiles` rows per the "Public profiles are viewable by everyone" policy) — no policy changes needed.
- Fetched in the same `Promise.allSettled` batch as the existing casino-list fetches in `Home.tsx`'s load effect, so it doesn't add a second loading waterfall.
- **Loading state:** the two numeric pills show a pulsing skeleton block in place of the number until the fetch resolves. The static trust-badge pill renders immediately (no data dependency).
- **Error handling:** if the stats query fails, the whole stats strip is omitted (return early / render `null`) rather than showing an error — consistent with how the existing casino-list fetches already swallow failures via `Promise.allSettled` without surfacing an error banner. This is decorative, non-critical content.

## My Casinos row / sign-in callout

- Logic, data source (`listMyCasinos`), and empty-state copy are unchanged.
- Container and empty-state panel restyled to the glass treatment.
- Sign-in callout (signed-out state) restyled to glass; icon, copy, and button unchanged.

## New: "How it works" strip

- Rendered **only when signed out**, placed between the sign-in callout and the Discover section.
- Three glass cards in a row (stacking on mobile), each with a lucide icon + short label:
  1. **Create** (`Plus` icon) — "Start a casino and set the rules."
  2. **Invite** (`Share2` icon) — "Bring your friends in with a join link."
  3. **Play** (`PlayCircle` icon) — "Free chips, real bragging rights."
- Purely presentational — no data, no interactivity beyond hover state consistent with other glass cards.

## Discover

- Logic, data source (`listCasinos`), the existing teaser-filtering behavior (excludes already-joined casinos, capped at `TEASER_COUNT`), and empty states are unchanged.
- Section heading and empty-state panels restyled to glass.
- `CasinoTile` itself is **not modified** (see Non-goals) — tiles render exactly as they do today, which already includes hover glow and the `member_count` footer, so they read fine against the new background without changes.

## Data flow summary

`Home.tsx`'s load effect currently does:
```
Promise.allSettled([listCasinos(...), listMyCasinos(user.id)?])
```
This becomes:
```
Promise.allSettled([listCasinos(...), listMyCasinos(user.id)?, getPlatformStats()])
```
Each result is independent — a stats failure doesn't affect casino lists rendering and vice versa, matching the existing resilience pattern.

## Files touched

| File | Change |
|---|---|
| `src/pages/Home.tsx` | Restyle all sections to glass; add background layer, stats strip, how-it-works strip |
| `src/hooks/useCasino.ts` | Add `getPlatformStats()` |

No other files change. No migrations, no `Layout.tsx` edits, no `CasinoTile.tsx` edits.

## Responsive behavior

- Stats strip: 3 pills in a row on `sm:` and above; stacks to a single column on mobile (matches existing hero stacking breakpoint).
- How-it-works strip: 3 cards in a row on `sm:` and above; stacks to a single column on mobile.
- All other responsive behavior (hero two-column, My Casinos horizontal scroll, Discover grid column counts) is unchanged from the current implementation.

## Acceptance checklist

- [ ] Visiting `/` signed-out shows: glass hero (signed-out copy), stats strip, sign-in callout, how-it-works strip, Discover grid.
- [ ] Visiting `/` signed-in shows: glass hero (signed-in copy), stats strip, My Casinos row (or empty-state), Discover grid. No how-it-works strip.
- [ ] Stats strip shows real casino/player counts once loaded; renders a skeleton before load; disappears entirely (not an error message) if the stats query fails.
- [ ] All existing behavior is intact: CTAs route correctly, My Casinos empty state and Discover empty/search-adjacent states render as before, `Joined` pills still show on tiles.
- [ ] `/browse` and `/casino/:slug` are visually unchanged (no leakage of the glass treatment via shared components).
- [ ] App renders correctly on a 375px-wide viewport, no horizontal overflow.
- [ ] No console errors on first paint of `/`.
