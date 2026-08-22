# Tumble — buy free spins

Date: 2026-08-22

A purchasable batch of pre-paid Tumble spins. The player picks a stake within
an admin-configured range, buys a fixed number of spins at that stake in one
purchase, and watches them auto-play back-to-back. Each spin uses the exact
same odds and house edge as a normal manual spin — this is a prepay/batch
convenience, not a separate boosted bonus mode, since Tumble has no distinct
"bonus" RTP to sell. Buying `N` spins at stake `S` costs exactly `N × S`.

## Settings

New nested field on `TumbleInstanceSettings` (`src/types/index.ts`):

```ts
export interface TumbleFreeSpinsSettings {
  enabled: boolean;
  minBet: number;        // floor 1, always — never lower, regardless of the
                          // instance's regular min_bet
  maxBet: number;        // >= minBet, capped at MAX_BET_CEILING (10,000,000),
                          // same ceiling GameSettingsModal already uses for
                          // regular bet limits
  spinsPerPurchase: number; // integer, 1-50
}
```

Added to `TumbleInstanceSettings` as `freeSpins?: TumbleFreeSpinsSettings`.

Defaults when missing/invalid — resolved server-side, authoritative, mirrors
`resolveHouseEdge`'s "never trust the client" pattern:

```
{ enabled: false, minBet: 1, maxBet: max(1, cg.max_bet), spinsPerPurchase: 10 }
```

### Admin UI — `GameSettingsModal.tsx`

New "Free Spins" section, tumble-only (`isTumble`), placed below the existing
House edge section:

- An enable/disable toggle, styled as a two-option button pair identical in
  spirit to the existing Reward Mode buttons (no new UI component/dependency
  introduced).
- Min bet / Max bet / Spins per purchase number inputs, editable only while
  enabled.
- Validation (blocks Save, same pattern as the existing `betRangeValid`
  check): min bet ≥ 1, max bet ≥ min bet, max bet ≤ `MAX_BET_CEILING`, spins
  per purchase an integer in [1, 50]. Validation only applies while the
  toggle is on — a disabled section can't block Save.
- On save, `settings.freeSpins` is written as `{ enabled, minBet, maxBet,
  spinsPerPurchase }` (booleans/numbers only, same shape the server resolves).

## Server — `supabase/functions/tumble/index.ts`

The function starts dispatching on `body.action`, mirroring the pattern
already used by `supabase/functions/mines/index.ts`:

- Missing `action` or `action === "spin"` → today's existing single-round
  flow, entirely unchanged.
- `action === "buy_free_spins"` → new flow below.

No new database table. Because the whole batch auto-plays with no per-spin
player choice, it resolves exactly like a single spin does today: everything
computed and settled in one atomic request, matching the codebase's existing
"whole round resolves server-side in one request" rule for Tumble.

`resolveFreeSpinsSettings(settings, cg)` — new function in `index.ts`,
co-located with `resolveHouseEdge` and following the same convention (settings
resolution/IO lives in `index.ts`; pure game math lives in `engine.ts`).
Returns the defaulted/clamped shape above, clamping any admin-saved value that
is somehow out of range (min < 1, max < min, spins outside [1,50]) rather than
trusting it.

Request body: `{ action: "buy_free_spins", casino_id, casino_game_id, bet }`
— `bet` is the per-spin stake the player picked.

Validation, in order:

1. `freeSpins.enabled` must be true, else 400 `"Free spins are not enabled for
   this game."`
2. `bet` must be a finite positive number within
   `[freeSpins.minBet, freeSpins.maxBet]`, else 400 (same style as the
   existing bet-range error).
3. `totalCost = spinsPerPurchase * validBet` must be `<= member.balance`, else
   400 `"Insufficient balance"`.

Resolution: run `playRound(rng, houseEdge)` `spinsPerPurchase` times, compute
each round's payout via the existing `payoutFor(round, validBet)`, sum into
`totalPayout`. Apply one atomic update: `net = totalPayout - totalCost`,
`balance = member.balance + net`. Write one summary transaction row (not one
per round) describing the purchase, e.g. `Tumble free spins: 10 × 5 chips,
total payout 42`, via a new `describeFreeSpins(rounds, bet)` helper alongside
the existing `describeRound`.

Response: new `TumbleFreeSpinsResult` type —

```ts
export interface TumbleFreeSpinsResult {
  rounds: TumbleRound[];
  bet: number;    // the per-spin stake
  cost: number;   // spinsPerPurchase * bet
  payout: number; // summed payout across all rounds
  balance: number; // authoritative final balance
}
```

## Client

### Hook — `useTumble.ts`

New `buyFreeSpins(bet)` alongside `spin(bet)`: same shape (loading/error
state, same error-parsing fallback for non-2xx responses), calls the edge
function with `{ action: "buy_free_spins", casino_id, casino_game_id, bet }`,
returns `TumbleFreeSpinsResult`.

### `Tumble.tsx` — buy panel

New sidebar section (shown only when `freeSpins.enabled`), below the existing
Bet Amount block: a stake input bounded to
`[freeSpins.minBet, freeSpins.maxBet]` (same half/double adjust buttons as the
regular bet field), and a button reading "Buy {spinsPerPurchase} Free Spins —
{cost} chips". Disabled whenever `busy` or `cost > localBalance` or the stake
is out of range.

### `Tumble.tsx` — batch playback

The per-round animate-then-credit logic currently inline in `handleSpin` gets
extracted into a shared helper, `playOutRound(round, bet, token)`, that: runs
`replay(round, token)`, then credits that round's own payout into local
balance, then shows the win banner/chime if it paid. Both a manual single spin
and each round of a purchased batch call this same helper — preserving the
existing no-spoiler rule (balance only reflects a round's outcome once that
round's own cascade animation has finished) per spin, not just per batch.

`handleBuyFreeSpins()`:

1. Guards on `!busy` and the stake/cost checks above.
2. Sets `animating = true`, deducts the full batch `cost` from local balance
   immediately (mirrors the existing "deduct before animation" rule, extended
   to cover the whole prepaid batch).
3. Calls `buyFreeSpins(stake)`.
4. On failure: rolls back the cost deduction, sets `formError`, clears
   `animating`.
5. On success: iterates `result.rounds` in order, calling `playOutRound` for
   each and updating a "Free Spin `i` of `spinsPerPurchase`" indicator shown
   near the board/counters (new small UI element, no existing equivalent to
   reuse).
6. After the last round finishes, snaps local balance to `result.balance` as
   an authoritative reconciliation (a no-op in the normal case, a safety net
   if any rounding drifted), clears `animating`.

Regular Spin and Buy Free Spins are both disabled for the whole batch's
duration via the existing `busy`/`animating` flag — no per-round pause, no
skip/stop-mid-batch control in this version (YAGNI; can be added later if
wanted).

### Game info

`tumbleInfo.rules` in `Tumble.tsx` gets one more bullet, appended only when
`freeSpins.enabled`, built from the actual resolved settings passed in as
props — e.g. `` `Buy ${spinsPerPurchase} free spins for a stake between
${minBet} and ${maxBet} chips — each spin plays out with the exact same odds
as a normal spin.` `` — matching CLAUDE.md's rule that info-panel copy must be
sourced from real engine/settings behavior, not guessed.

### `CasinoDashboard.tsx`

`<Tumble>` gets a new `freeSpins` prop, resolved from
`(activeGame.settings as TumbleInstanceSettings)?.freeSpins` with the same
default fallback shape the server uses (`{ enabled: false, minBet: 1, maxBet:
activeGame.max_bet, spinsPerPurchase: 10 }`), mirroring how `houseEdge` and
`design` are already defaulted there today.

## Testing

`engine.test.ts` needs no changes — per-round math (`playRound`, `payoutFor`)
is untouched; a purchase just calls `playRound` `spinsPerPurchase` times.

`resolveFreeSpinsSettings` and the `buy_free_spins` action's request
validation live in `index.ts`, same as `resolveHouseEdge` today — which is
not currently vitest-covered (it lives in a Deno edge function that isn't
imported by the node-based `engine.test.ts`). This design keeps that existing
boundary rather than introducing an inconsistency: free-spin settings
resolution and purchase validation are verified the same way the single-spin
endpoint's `resolveHouseEdge`/bet-range checks are today — manual/Playwright
verification against the deployed function, not a vitest suite. If that
boundary changes later (e.g. `resolveHouseEdge` moves into `engine.ts` for
testability), `resolveFreeSpinsSettings` should move with it.

Manual verification via Playwright against the running app: enable free
spins in the settings modal with a min/max/count, buy a batch from the game
UI, confirm the cost is deducted upfront, each spin's animation plays in
sequence with the "Free Spin i of N" indicator advancing, the balance ticks
per-spin (not spoiled ahead of each reveal), and the final balance matches
cost vs. summed payout. Also verify: buying is unavailable/hidden when the
feature is disabled, and the settings modal blocks saving an invalid
min/max/count.
