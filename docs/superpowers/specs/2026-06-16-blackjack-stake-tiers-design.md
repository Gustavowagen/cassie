# Blackjack Stake Tiers

## Goal

Let the player pick a stake tier (Low / Medium / High) in the Blackjack UI, each tier exposing a different set of four chip denominations to build a bet with:

- **Low**: 0.1, 0.5, 1, 5
- **Medium**: 25, 100, 500, 1000
- **High**: 5000, 25000, 100000, 500000

## Why this requires a currency change

Money is currently stored as whole-number "chips" (`bigint`) everywhere: `casino_members.balance`, `game_types.min_bet`/`max_bet`, `transactions.amount`/`balance_after`, and the edge function's bet validation (`Number.isInteger(bet)`). The Low tier's 0.1 and 0.5 denominations require fractional balances, so this feature is really "switch the currency to decimal, then add a tier selector on top."

Decided approach (vs. scaling by 10 internally, or rounding away the fractional values): migrate to `numeric(14,2)` columns and validate/round to 2 decimal places everywhere money is touched. This is the most literal interpretation of the requested stake values and keeps the display logic simple.

## Data model changes

New migration (next sequential number after `017_blackjack_min_bet_1.sql`):

1. `alter table casino_members alter column balance type numeric(14,2)`
2. `alter table game_types alter column min_bet type numeric(14,2)`, same for `max_bet`
3. `alter table transactions alter column amount type numeric(14,2)`, same for `balance_after`
4. `update game_types set min_bet = 0.1, max_bet = 500000 where id = 'blackjack'` (High tier's ceiling exceeds the current 100000 max)
5. Update `join_casino()`: `v_starting_balance` local var `bigint` → `numeric(14,2)`, cast `(settings->>'startingBalance')::numeric(14,2)`
6. Update `give_chips()`: `p_amount` param and `v_new_balance` local var `bigint` → `numeric(14,2)` (otherwise the implicit cast back to a declared `bigint` variable would silently truncate decimal balances after step 1)

No other game types (`slots`, `roulette`, `crash`, `dice`) change their min/max bet values — they just inherit the wider column type.

## Edge function (`supabase/functions/blackjack/index.ts`)

- Replace `if (!Number.isInteger(bet) || bet < gt!.min_bet || bet > gt!.max_bet)` with a check that `bet` is a positive number, a multiple of `0.1` (within float tolerance), and within `[min_bet, max_bet]`.
- Add a `roundMoney(n) = Math.round(n * 100) / 100` helper; apply it to every computed balance/stake before persisting (deduction, credited payout, `extraStake`) to avoid floating-point drift accumulating across actions (e.g. `0.1 + 0.2`).

## Game engine (`supabase/functions/blackjack/engine.ts`)

Two spots currently use `Math.floor` to keep results as whole chips — both need to become "round to cents" instead of "truncate to whole number," since truncation on a fractional bet silently shorts the player:

- `settle()`: blackjack payout `Math.floor(hand.bet * 2.5)` → `roundMoney(hand.bet * 2.5)`. (A 0.1 bet blackjack must pay 0.25, not 0.)
- `applySplitOrInsurance()`: insurance bet `Math.floor(state.baseBet / 2)` → `roundMoney(state.baseBet / 2)`.

Add the same `roundMoney` helper here (duplicated locally, or exported and imported by `index.ts` — implementer's call, both files are Deno edge function modules without a shared util today).

## Frontend (`src/components/games/Blackjack.tsx`)

- Replace the single `CHIPS` array with three tier arrays (`CHIPS_LOW`, `CHIPS_MEDIUM`, `CHIPS_HIGH`), each reusing the existing chip color styling; add two new colors for the two additional High-tier denominations beyond today's four.
- Add `const [tier, setTier] = useState<"low" | "medium" | "high">("medium")` in the main component (Medium matches today's existing denominations most closely, so it's the least surprising default).
- Render a segmented control (three buttons) above the chip row in `BettingControls` to switch `tier`. Switching tiers does **not** reset `bet` — chips are just bet-building shortcuts, the underlying bet amount is tier-independent.
- `addChip` rounds the result to 2 decimals: `setBet((b) => roundMoney(Math.min(maxBet, Math.min(availableBalance, b + value))))`. Add a local `roundMoney` helper (same formula as the backend's).

## `formatChips()` (`src/lib/utils.ts`)

Currently `amount.toLocaleString("en-US")`. Add `{ maximumFractionDigits: 2 }` so:
- Whole balances still render with no decimals (`12,500`)
- Fractional chip values render cleanly (`0.1`, `0.5`)
- Any float noise that slips through is clamped to 2 decimals for display

## Testing

- Update `supabase/functions/blackjack/engine.test.ts`: existing tests that assert on `Math.floor`-truncated payout/insurance values need updating for the rounding change; add a case for a blackjack win and an insurance bet on a fractional (e.g. 0.1 or 5.5) base bet.
- Manual verification in the running app: place a bet in each of the three tiers, including a sub-1 fractional bet in Low, and confirm balance/payout display correctly through a full round (win, lose, and push).

## Out of scope

- The "give chips" owner-grant UI (`CasinoDashboard.tsx`) keeps its current whole-number input; it still works against the wider column type, just without a decimal-friendly UI. Not part of this request.
- Per-casino stake tier restrictions (e.g. owner disabling High stakes) — not requested.
