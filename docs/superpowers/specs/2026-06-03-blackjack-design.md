# Blackjack — Design Spec

**Date:** 2026-06-03
**Status:** Approved (design)

## Goal

Add Blackjack as the first playable game on OnlineCassie. Casino owners can
enable it from the Games tab; members play single-player against a dealer with
a modern online-casino look and feel. Game logic is **server-authoritative** so
results cannot be manipulated from the browser.

## Scope

- Single player vs. dealer (no shared/multiplayer table).
- Standard online-casino rules incl. split, double, insurance; blackjack 3:2.
- Owner UI to enable/disable games per casino.
- Member UI to launch and play Blackjack.

Out of scope: late surrender, side bets beyond insurance, multiplayer tables,
other games (slots/roulette/etc.).

## Architecture — cheat resistance

All game logic and the card shoe live on the server. The client never receives
the shoe or the dealer's hole card, so there is nothing to exploit client-side.

### Components

1. **Edge Function `blackjack`** (`supabase/functions/blackjack/index.ts`,
   Deno/TypeScript) — the authority. Verifies the caller's JWT (so it knows
   `auth.uid()`), validates every action, advances state, plays the dealer out,
   settles bets, and returns a sanitized state to the client. Runs with the
   service-role key so it can read/write the hidden round state and mutate
   balances.

2. **Pure engine module** (`supabase/functions/blackjack/engine.ts`) — all
   blackjack rules with **zero I/O**: shuffle, hand value (incl. soft/hard ace
   handling), legal-action computation, applying a move, dealer play, and payout
   math. Pure functions take state + input and return new state. Fully
   unit-tested (`engine.test.ts`) via TDD — this is where rule correctness lives.

3. **`blackjack_rounds` table** — stores round state as jsonb. RLS grants **no
   client access** (no SELECT/INSERT/UPDATE policy for the anon/authenticated
   roles); only the edge function (service role) touches it. Columns:
   - `id uuid pk`
   - `casino_id uuid` → casinos
   - `user_id uuid` → auth.users
   - `state jsonb` (full server state: shoe, dealer cards, player hands, bets,
     insurance, status, active hand index)
   - `status text` (`player_turn` | `dealer_turn` | `complete`)
   - `created_at`, `updated_at`

4. **Balance & transactions** — handled inside the function. On `start` it
   deducts the bet from `casino_members.balance`; on settle it credits
   winnings. Each balance change inserts a `transactions` row with
   `balance_after`, `game_type_id = 'blackjack'`, and a human description
   (e.g. "Blackjack bet", "Blackjack win"). The existing `useBalance` realtime
   subscription (on `casino_members` UPDATE) pushes the new balance to the UI.

### Server state shape (hidden from client)

```ts
interface RoundState {
  shoe: Card[];            // remaining cards, hidden
  dealer: Card[];          // full hand, hole card hidden until dealer turn
  hands: PlayerHand[];     // one per split
  activeHand: number;
  insuranceBet: number;
  baseBet: number;
  status: "player_turn" | "dealer_turn" | "complete";
}
interface PlayerHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  isSplitAces: boolean;
  done: boolean;
  outcome?: "win" | "lose" | "push" | "blackjack";
  payout?: number;
}
type Card = { rank: "A"|"2"|..."K"; suit: "S"|"H"|"D"|"C" };
```

### Sanitized client view (returned by function)

```ts
interface ClientState {
  roundId: string;
  status: "player_turn" | "dealer_turn" | "complete";
  dealer: { cards: Card[]; value: number | null; hidden: boolean };
  // during player_turn: only upcard + a face-down placeholder; value null
  hands: {
    cards: Card[];
    value: number;
    bet: number;
    doubled: boolean;
    outcome?: string;
    payout?: number;
  }[];
  activeHand: number;
  legalActions: ("hit"|"stand"|"double"|"split"|"insurance")[];
  insuranceOffered: boolean;
  balance: number;
}
```

## Function API

Invoked via `supabase.functions.invoke('blackjack', { body })`.

- **start** — `{ action: "start", casino_id, bet }`
  Validates: caller is a member; `bet` within `game_types` min/max for blackjack
  and ≤ current balance; no other active round. Deducts bet, deals two cards to
  player and dealer, peeks for dealer blackjack on Ace/10 upcard (immediate
  settle if dealer has BJ). Returns `ClientState`.

- **action** — `{ action: "action", round_id, move, hand_index? }`
  `move ∈ hit | stand | double | split | insurance`. Validated against
  `legalActions` for the active hand server-side. `double`/`split`/`insurance`
  deduct the additional stake (validated ≤ balance). When the last hand is
  resolved, the dealer plays out and all bets settle; returns final
  `ClientState`.

Errors return `{ error: string }` with a 4xx status; the client surfaces them.

## Rules (standard online casino)

- 6-deck shoe; reshuffle when the shoe runs low (threshold ~25% penetration).
- **Blackjack pays 3:2.**
- Dealer stands on all 17s (S17), including soft 17.
- Dealer peeks for blackjack on Ace or 10-value upcard; round ends immediately
  if dealer has blackjack (player BJ pushes, others lose, insurance pays 2:1).
- Insurance offered only when the dealer upcard is an Ace; costs ½ the base bet,
  pays 2:1.
- Double down allowed on any first two cards; **double after split allowed**.
  Double draws exactly one card.
- Split allowed on equal-rank pairs (10/J/Q/K count as a pair), up to **4 hands**
  total. Split Aces receive exactly one card each; a two-card 21 on a split-ace
  hand pays 1:1 (not blackjack 3:2).
- Bust (>21) loses immediately; the active hand advances.

## Frontend

### Owner — Games tab (`CasinoDashboard.tsx`)
Replace `GamesPlaceholder` (owner branch) with a grid of all `game_types`. Each
card shows name/description and an enable toggle. Toggling writes/deletes the
`casino_games` row (RLS already restricts this to the owner). Enabled games are
visually marked. Only `blackjack` is wired to a real game in this iteration;
others can be enabled but render a "coming soon" tile.

### Member view
Show enabled games for the casino. Tapping Blackjack opens the table (rendered
inline within the dashboard, replacing the games grid, with a back control).

### Blackjack table (`src/components/games/Blackjack.tsx`)
Modern casino aesthetic, mobile-first:
- Felt-style table surface, dealer area up top, player hand(s) below.
- Card components with deal-in animation; face-down dealer hole card.
- Chip-stack bet selector + balance HUD.
- Action buttons (Hit / Stand / Double / Split / Insurance) rendered **only**
  when present in the server's `legalActions`; disabled while a request is in
  flight.
- Round result banner (win/lose/push/blackjack) with payout, and "New hand".
Built with care via the `frontend-design` skill.

### Data layer
- `src/hooks/useGames.ts` — list `game_types`, list/enable/disable `casino_games`
  for a casino (owner). Populate `casinoStore.enabledGames`.
- `src/hooks/useBlackjack.ts` — wraps `functions.invoke('blackjack', ...)` for
  `start` and `action`; holds current `ClientState`, loading, error.
- `casinoStore` already has `enabledGames`/`setEnabledGames`.

## New / changed files

**New**
- `supabase/migrations/011_blackjack_rounds.sql`
- `supabase/functions/blackjack/index.ts`
- `supabase/functions/blackjack/engine.ts`
- `supabase/functions/blackjack/engine.test.ts`
- `src/components/games/Blackjack.tsx`
- `src/hooks/useGames.ts`
- `src/hooks/useBlackjack.ts`

**Changed**
- `src/pages/CasinoDashboard.tsx` — Games tab (owner enable grid; member launch;
  inline Blackjack render)
- `src/types/index.ts` — `CasinoGame`, blackjack client-state types
- `src/stores/casinoStore.ts` — if needed for selected-game state

## Testing

- **Engine unit tests (TDD)**: hand values (hard/soft, multiple aces), blackjack
  detection, legal-action computation per state, split/resplit/split-ace rules,
  double, insurance resolution, dealer S17 play, payout math incl. 3:2 and 1:1
  split-ace 21, dealer-peek immediate settle, pushes.
- **Manual/integration**: enable blackjack as owner, play hands as a member,
  verify balance changes + transactions, and that the shoe/hole card are never
  present in network responses during `player_turn`.

## Security notes

- Edge function deployed with `verify_jwt` on; derives the player from the JWT,
  never trusts a client-supplied user id.
- `blackjack_rounds` has no client RLS policy → the shoe and hole card are
  unreachable via the anon key.
- All bet/payout arithmetic and legality checks happen server-side; the client
  only renders sanitized state and submits intent.
