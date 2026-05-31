# OnlineCassie

Platform for creating and joining free play-money online casinos. Built with Vite + React + TypeScript + Supabase.

## Dev Commands

- `npm run dev` — start dev server (localhost:5173)
- `npm run build` — production build
- `npm run preview` — preview production build

## Supabase

- Project: jackpot-jungle (`tvivhadsgtvfvxwpahef`)
- Region: eu-west-1
- URL: https://tvivhadsgtvfvxwpahef.supabase.co
- Migrations in `supabase/migrations/` — apply via Supabase MCP (`apply_migration`)

## Architecture

- **Auth**: Supabase Auth (email/password). Profile auto-created on signup via DB trigger.
- **State**: Zustand stores in `src/stores/` — `authStore` (session/user/profile), `casinoStore` (current casino, membership, games)
- **Routing**: React Router v6, all routes in `src/App.tsx`
- **DB access**: `src/lib/supabase.ts` singleton + hooks in `src/hooks/`
- **UI**: Hand-written shadcn-compatible components in `src/components/ui/` (no CLI dependency)

## Key Concepts

- **Casino slug**: URL-safe identifier derived from casino name at creation time. Used in routes `/casino/:slug` and `/casino/:slug/admin`.
- **join_casino RPC**: Call `supabase.rpc('join_casino', { p_casino_id })` — sets starting balance from casino settings automatically.
- **Balance**: Stored as integer chips in `casino_members.balance`. Use `formatChips()` from `src/lib/utils.ts` for display.
- **RLS**: Every table has Row Level Security. All access goes through the anon key; policies enforce per-user access.

## Database Schema

| Table | Purpose |
|---|---|
| `profiles` | Public user info (username, avatar). Auto-created on auth signup. |
| `casinos` | Casino metadata, owner, theme (jsonb), settings (jsonb) |
| `casino_members` | Join table: user ↔ casino with balance + role |
| `game_types` | Catalogue of available game types (slots, blackjack, etc.) |
| `casino_games` | Which games are enabled per casino |
| `transactions` | Balance change history per user per casino |

## Adding a New Game

1. If needed, insert a new row into `game_types` (via migration).
2. Create `src/components/games/<GameName>.tsx` with the game UI.
3. In `CasinoDashboard.tsx`, render the component when that game_type is in `enabledGames`.
4. Use the `transactions` table to record bet/win with `supabase.from('transactions').insert(...)`.

## Mobile

The app is designed mobile-first (Tailwind responsive classes). Future Capacitor/React Native conversion: all business logic lives in hooks and stores, decoupled from the browser DOM.
