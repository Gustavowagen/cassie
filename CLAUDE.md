# OnlineCassie

Platform for creating and joining free play-money online casinos. Built with Vite + React + TypeScript + Supabase.

## Dev Commands

- `npm run dev` — start dev server (localhost:5173)
- `npm run build` — production build
- `npm run preview` — preview production build

## Supabase

- Project: online-cassie (`tvivhadsgtvfvxwpahef`)
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
5. Win/loss feedback: on a loss, show nothing (no banner, no modal, no loss text) — the UI just returns to a neutral state. On a win, play a winning animation/effect (e.g. particle burst, payout pop-in). See `src/components/games/Mines.tsx` or `Dice.tsx` for the pattern to follow.
6. Balance must update instantly, both serverside and frontend, the moment a bet is placed:
   - **Serverside**: deduct the bet from `casino_members.balance` in the same request/action that places the bet (see any edge function in `supabase/functions/`). If the round resolves synchronously (Dice, Roulette, Plinko), compute `net = payout - bet` and apply it in one atomic update so the deduction and any payout land together. If the round is multi-step (Mines, Blackjack), deduct the bet on the "start" step and credit any payout on the step that resolves it — never leave a bet un-deducted while a round is in progress.
   - **Frontend**: for a game whose outcome is already decided when the bet is placed but revealed through a suspense animation (Dice's slide, Roulette's wheel/ball, Plinko's drop), deduct the full bet from local balance the instant the bet is placed — unconditionally, before the animation resolves and before the server response even needs to be waited on. Never let the balance jump straight to its final win/loss value ahead of the animation; that spoils the outcome (e.g. seeing you won roulette before the ball lands). Only apply the server's authoritative post-round balance — which is what credits any payout — once the animation has actually finished (await the animation's own completion signal, e.g. `wheelRef.current.spinTo()`'s promise; where there's no such promise, gate it behind a timeout matching the CSS transition, e.g. Dice's `REVEAL_MS`). If the request itself fails, roll back the optimistic deduction. For multi-step games (Mines, Blackjack) where each step's own action *is* the reveal (no separate suspense animation on top), keep updating balance straight from the server response as before — deduct on the "start" step, credit on the step that resolves it.
7. **Fill sizing**: the game's modal and its main visual centerpiece (reels, wheel, board, cards) must grow on larger screens instead of sitting small with empty space around them.
   - The outer modal root's inline `style` sets `width`/`height` as `min(<vw>vw, <px>px)` with a generous px cap (1300px+) — see `Slots.tsx` or `Roulette.tsx`. If the modal needs the `xl` size, check `Modal`'s `max-w-[1400px]` cap in `src/components/ui/modal.tsx` isn't clipping it.
   - The centerpiece's own scale (cell size, wheel diameter, card size, etc.) is a CSS `clamp(minPx, Nvw, maxPx)`, not a fixed px value or discrete breakpoint jump — so it grows continuously with viewport width up to a sensible cap, and floors at a usable minimum on mobile. See `--cell: clamp(64px, 6.5vw, 108px)` in `Slots.tsx`'s reel grid, or the wheel's `md:max-w-[clamp(320px,25vw,520px)]` in `Roulette.tsx` (that file's separate small-viewport/portrait sizing is intentional and shouldn't be folded into the same clamp).
   - Sanity-check at a small viewport (~375px) and a large one (~1920px) — both ends of the clamp should look right, not just the middle.
8. **Info button**: add a `GAME_INFO` entry for the game in `src/lib/gameInfo.ts` (title, description, and rules bullets sourced from the actual engine behavior — not guessed), then place `<GameInfoButton>` beside `<BackdropToggleButton>` in the game's header. Toggling it swaps the body content for `<GameInfoPanel>` (see `src/components/games/Mines.tsx` for the pattern); the header stays functional and no round state is lost.

## Test Account

A pre-seeded admin account exists for Playwright testing and UI verification:

- **Email**: `claudetest.cassie@gmail.com`
- **Password**: `ClaudeTest123!`
- **Nickname**: ClaudeTest
- **Role**: admin in all casinos, 1,000,000 chips starting balance

Use this account when you need to sign in via Playwright to verify UI changes. If the account is missing, re-create it: sign up with the credentials above, then run SQL to confirm the email (`UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'claudetest.cassie@gmail.com'`) and grant admin access to all casinos.

## Mobile

The app is designed mobile-first (Tailwind responsive classes). Future Capacitor/React Native conversion: all business logic lives in hooks and stores, decoupled from the browser DOM.
