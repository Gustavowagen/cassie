# Homepage Redesign — Design Spec

**Date:** 2026-05-31
**Status:** Approved (awaiting plan)
**Author:** brainstormed with Claude

## Goal

Replace the placeholder `Home.tsx` with a homepage where a user can both **join an existing casino** and **create their own**, taking visual inspiration from Stake.com (dark casino aesthetic, hero banner, horizontal card rows). The list of "games" in the inspiration becomes the list of **casinos the user has joined**. No games are launched directly from the homepage — game access remains gated behind a casino.

## Non-goals

- Light/dark toggle UI (we commit to dark for now; vars stay defined for a future toggle).
- Real-time online presence ("X playing now"). We show total member count, not live count.
- Server-side search / pagination of Discover.
- Categories, tags, featured rows, promotions sections.
- Avatar uploads.
- Sidebar navigation (the inspiration has one — we don't yet have enough top-level destinations to justify it).
- Social-auth (Google/Facebook) hero buttons. Current `Auth.tsx` is email-only; adding social login is a separate spec.

## Page structure

Single page, three vertical sections in order. The top nav from `Layout.tsx` is preserved (with minor polish).

```
┌────────────────────────────────────────────────┐
│  NAV: logo · sign in / avatar                  │
├────────────────────────────────────────────────┤
│  HERO BAND                                     │
│  (copy + CTAs left, decorative tiles right)    │
├────────────────────────────────────────────────┤
│  ► My Casinos                  View all →      │   ← signed-in
│  [tile] [tile] [tile] [tile] [tile] [tile]    │
│                                                │
│    OR                                          │
│                                                │
│  → Sign in to track casinos you join  [Sign in]│   ← signed-out
├────────────────────────────────────────────────┤
│  Discover                              [🔍 ]   │
│  [tile] [tile] [tile] [tile] [tile]            │
│  [tile] [tile] [tile] [tile] [tile]            │
└────────────────────────────────────────────────┘
```

## Visual aesthetic

- **Dark mode is the default.** Set `<html class="dark">` in `index.html`. Light theme CSS vars stay defined so we can add a toggle later, but no toggle UI ships in this work.
- **Palette shift** (in `src/index.css`, `.dark` block):

  | Variable | Old | New | Hex (approx) |
  |---|---|---|---|
  | `--background` | `222.2 84% 4.9%` | `220 35% 8%` | `#0f1923` |
  | `--card` | `222.2 84% 4.9%` | `220 30% 12%` | `#16222e` |
  | `--border` | `217.2 32.6% 17.5%` | `220 25% 18%` | `#212f3d` |

  All other variables stay as they are. The purple primary (`263.4 70% 50.4%`) keeps being the CTA / accent color. The single elevated surface (`--card`) is used by hero panels, the sign-in callout, the My Casinos empty-state panel, and the footer strip of tiles — we don't need a second elevation tier.

## Hero band

- Sits inside the main container, ~280px tall on desktop, full-width edge-to-edge of the container.
- **Two-column layout** at `md:` breakpoint and above; stacks vertically on mobile (copy on top, decorative tiles below).
- **Left ~60%** — copy + CTAs.
- **Right ~40%** — two stacked decorative "casino" tiles, CSS-only:
  - Each tile is a gradient panel (`from-primary/40 to-primary/10`) with a centered `lucide-react` icon (`Dice5`, `Spade` or similar) at large size.
  - No real artwork; purely decorative. Hidden below `md` (768px) to avoid crowding the copy on mobile.

### Copy variants

| Auth state | Headline | Subhead | Primary CTA | Secondary CTA |
|---|---|---|---|---|
| Signed-in  | "Welcome back, {username}" | "Jump back into your casinos or start a new one." | `Create casino` → `/create` | `Browse` → scrolls to `#discover` (the Discover section gets `id="discover"`) |
| Signed-out | "Run your own play-money casino" | "Free, social, no real money — your friends, your rules." | `Create account` → `/auth?mode=signup` | `Sign in` → `/auth` |

> **Note:** `Auth.tsx` currently doesn't read a `mode` query param — link to `/auth` and let the user toggle; or as a tiny polish, accept an optional `?mode=signup` query and initialize state from it. This is a nice-to-have, not a blocker.

## My Casinos row (signed-in only)

- Heading line: bold "My Casinos" on the left; `View all →` link on the right rendered **only when count > 6**.
- **Horizontal scroll container** (`overflow-x-auto`, hidden scrollbar via utility), ~6 tiles visible on desktop without scrolling, native touch scroll on mobile. Tiles use the same `CasinoTile` component as Discover (see below).
- **Empty state** (signed-in user with zero joined casinos): a centered panel inside the section:
  - Text: "You haven't joined any casinos yet — pick one below or create your own."
  - Button: `Create casino` → `/create`.
  - Subtle styling, matches elevated surface color.
- Data source: new `useCasino().listMyCasinos()` returning `Casino[]` for the current user.

## Sign-in callout (signed-out only — replaces My Casinos)

- Single full-width elevated panel (`bg-card`):
  - Left: icon (`LogIn` from lucide) + text "Sign in to track casinos you join".
  - Right: `Sign in` button → `/auth`.

## Discover

- Heading row: "Discover" on the left, search input on the right (icon-prefixed, ~280px wide on desktop, full-width on mobile).
- **Search**: client-side, debounced (~150ms), case-insensitive substring match on `casino.name`. Catalog is small enough that this is fine. When the search is non-empty and yields zero results, show a small "No casinos match '{query}'." line in place of the grid.
- **Grid**: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`, gap `gap-4`.
- Tiles you're already a member of show a small `Joined` pill in the top-right (so users can see at a glance which appear in their My Casinos row).
- **Empty state** (zero casinos exist at all): centered: "No casinos yet — be the first to create one." + `Create casino` button.
- Data source: existing `useCasino().listCasinos()` (already implemented, returns all `is_active = true` casinos).

## CasinoTile component (new, replaces `CasinoCard`)

Location: `src/components/CasinoTile.tsx`. The old `CasinoCard.tsx` is deleted.

**Structure:**

```
┌────────────────┐
│ [logo]    [✓ Joined] ← optional badge
│                │
│   (background  │
│    art or      │
│    gradient)   │  ← 4:5 aspect ratio
│                │
│  Casino Name   │
├────────────────┤
│ ● 42 members   │  ← footer strip
└────────────────┘
```

**Behavior:**

- **Aspect ratio**: `aspect-[4/5]` for the art area; small footer strip below.
- **Background:**
  - If `casino.theme.backgroundUrl` is set → render an `<img>` covering the art area with `object-cover`.
  - Else → render a CSS linear gradient generated from `casino.theme.primaryColor`:
    - Top: the color at full saturation.
    - Bottom: the color darkened by ~40% (HSL lightness reduction).
    - Helper: `gradientFromColor(hex: string): string` returns a `linear-gradient(...)` CSS value. Added to `src/lib/utils.ts`.
  - Subtle grain overlay via a low-opacity tiled SVG noise `data:` URI for non-flat texture.
- **Overlay** (absolute-positioned inside the art area):
  - Top-left: `<img>` of `casino.theme.logoUrl` at 40px square, if present.
  - Top-right: `Joined` pill (small, rounded, semi-transparent background) if the current user is already a member.
  - Bottom-left: casino name, large bold white text with text-shadow for legibility.
- **Footer strip** (inside the tile, below the art area):
  - Green `●` (1.5 Tailwind units) + `{member_count} members` muted-foreground text. If `member_count === 0`, show "Be the first to join".
- **Hover** (desktop only): tile lifts 4px (`hover:-translate-y-1`), soft glow (`hover:shadow-[0_0_24px_rgba(255,255,255,0.06)]`), transition 150ms.
- **Click**: navigates to `/casino/{slug}`. CasinoDashboard already handles "join if not member, otherwise enter" — no changes needed there.
- **Props**: `{ casino: Casino; isMember?: boolean }`. Parent passes `isMember` based on cross-referencing with My Casinos list.

## Layout / nav polish (in `src/components/Layout.tsx`)

- Nav background gets a slight contrast bump — use `bg-card border-b border-border` instead of just `border-b`.
- Replace the plain username text with a **gradient avatar circle + initials**:
  - 32px circle, gradient background derived from a hash of the username (so it's stable per user).
  - First letter of `profile.username ?? user.email` inside, white, bold.
  - Username text still rendered next to the avatar at desktop; hidden at `sm:` and below.
- Main container padding: `py-8` → `py-6` (hero handles top breathing room).

No avatar uploads, no dropdown menu, no sidebar — just a visual polish.

## Data model: member count

The RLS policy on `casino_members` only permits viewing members of casinos you're already in. A `count(*)` from the client for casinos you haven't joined therefore returns 0. We fix this with a denormalized counter on `casinos`.

**Migration `006_member_count.sql`:**

```sql
alter table public.casinos
  add column member_count int not null default 0;

-- Backfill
update public.casinos c
set member_count = (
  select count(*) from public.casino_members m where m.casino_id = c.id
);

create or replace function public.casinos_member_count_sync()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.casinos set member_count = member_count + 1 where id = new.casino_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.casinos set member_count = greatest(member_count - 1, 0) where id = old.casino_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger casino_members_count_sync
  after insert or delete on public.casino_members
  for each row execute function public.casinos_member_count_sync();
```

Notes:
- Function is `security definer` so the trigger can update `casinos` regardless of who's inserting into `casino_members` (the RLS on `casinos.update` only allows the owner — without `security definer` the trigger would fail).
- `greatest(... , 0)` guards against drift; not strictly needed, but cheap insurance.

## New hooks / types

### `src/types/index.ts`

Add to `Casino`:

```ts
member_count: number;
```

### `src/hooks/useCasino.ts`

Add a new function:

```ts
async function listMyCasinos(userId: string): Promise<Casino[]> {
  const { data, error } = await supabase
    .from("casino_members")
    .select("casino:casinos(*)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: { casino: Casino }) => row.casino).filter(Boolean);
}
```

Export it alongside the existing functions. The `eq("user_id", userId)` filter is **required** — the RLS policy on `casino_members` permits "view all members of same casino", which would return co-members of every casino the user is in (not just the user's own membership rows) without this filter.

### `src/lib/utils.ts`

Add:

```ts
export function gradientFromColor(hex: string): string {
  // hex → hsl, drop lightness by ~25% for the bottom stop
  // returns: `linear-gradient(180deg, ${top}, ${bottom})`
}
```

Implementation details belong in the plan; the spec just commits the shape.

## Files touched

| File | Change |
|---|---|
| `src/pages/Home.tsx` | Rewrite |
| `src/components/CasinoTile.tsx` | New (replaces CasinoCard) |
| `src/components/CasinoCard.tsx` | Delete |
| `src/components/Layout.tsx` | Nav surface + avatar circle |
| `src/hooks/useCasino.ts` | Add `listMyCasinos` |
| `src/types/index.ts` | Add `member_count` to `Casino` |
| `src/lib/utils.ts` | Add `gradientFromColor` |
| `src/index.css` | New dark palette values |
| `index.html` | Set `<html class="dark">` |
| `supabase/migrations/006_member_count.sql` | New |

## Responsive behavior

| Breakpoint | Hero | My Casinos | Discover grid |
|---|---|---|---|
| Mobile (<640) | Copy stacked, decorative tiles hidden | Horizontal scroll, ~2 tiles peek | 2 cols |
| sm (640+) | Copy stacked, decorative tiles below | Horizontal scroll | 3 cols |
| lg (1024+) | Two columns | Horizontal scroll, ~6 tiles visible | 4 cols |
| xl (1280+) | Two columns | Horizontal scroll, ~7 tiles visible | 5 cols |

## Acceptance checklist

- [ ] Visiting `/` signed-out shows: hero (signed-out copy + CTAs), sign-in callout, Discover grid.
- [ ] Visiting `/` signed-in shows: hero (signed-in copy + CTAs), My Casinos row (or empty-state panel), Discover grid.
- [ ] Casinos the user has joined show a `Joined` pill in Discover and also appear in My Casinos.
- [ ] Search filters the Discover grid in real time.
- [ ] `member_count` updates when a user joins a casino (via `join_casino` RPC).
- [ ] Tile click navigates to `/casino/{slug}`; existing dashboard handles join-if-not-member.
- [ ] App renders correctly on a 375px-wide viewport (no horizontal page overflow).
- [ ] Dark theme is the only theme active; no light-mode flashes on initial paint.
- [ ] No console errors on first paint of `/`.
