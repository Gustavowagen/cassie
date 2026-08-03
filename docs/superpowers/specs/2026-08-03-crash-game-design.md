# Crash Game — Design Spec

Working title "x-builder"; player-facing name is **Crash** (`game_type_id = "crash"`, reusing the pre-existing, never-built `game_types` row of that name).

## Summary

A player places a bet and a multiplier starts at 1.00x, climbing continuously along a public formula. The player can cash out at any moment to lock in `bet × current multiplier`. At a secret, server-chosen point the round "crashes" — if the player hasn't cashed out by then, they lose the bet. House edge is fixed at 1% regardless of when a player cashes out, via the same crash-point formula used by established crash games (e.g. Bustabit-style).

## 1. Game Rules & Math

**Growth formula** (public, used by both client rendering and server verification):

```
multiplier(t) = e^(GROWTH_RATE × t)     // t = seconds since round started
GROWTH_RATE = 0.115                      // "Gentle" pacing, user-approved via live preview
```

**Crash point generation** (server-side only, generated once at `start`, never exposed while the round is active):

```
r = crypto-random in [0, 1)
crash_point = max(1.00, floor(((1 - HOUSE_EDGE) / (1 - r)) × 100) / 100)
crash_point = min(crash_point, MAX_CRASH_POINT)   // sanity cap, default 100

HOUSE_EDGE = 0.01        // 1%, user-selected
MAX_CRASH_POINT = 100    // tunable; only affects an astronomically rare tail
```

This formula guarantees a fixed 1% house edge **regardless of the multiplier a player targets**: `P(crash_point ≥ M) = (1 - HOUSE_EDGE) / M`, so expected payout at any cash-out target `M` is `bet × (1 - HOUSE_EDGE)`. The `MAX_CRASH_POINT` cap only ever removes rare, extreme upside for the player — it never increases house edge in the normal case and is undetectable in practice.

**Resolving a cash-out**: on request, server computes `elapsed = now − started_at`, `current = multiplier(elapsed)`:
- `current < crash_point` → **win**: `payout = roundMoney(bet × current)`.
- `current >= crash_point` → **bust**: `payout = 0`.

In both cases the response includes `crash_point` — this is the one point in the flow where it's safe to reveal it, since the round is now resolved. This lets the UI always tell the player either "you cashed out at X, it would have busted at `crash_point`" (win) or "busted at `crash_point`" (loss).

**No auto-cash-out in v1** (explicit scope decision) — cash-out is always a manual click.

**Bust detection is lazy, not live** (explicit architecture decision, see rationale below): there is no polling and no realtime push. The crash point is only ever checked against elapsed time when the player actually clicks Cash Out. A player who never clicks won't see a live "explosion" the instant a round secretly busts — they'll only find out on their next action. This was chosen over polling (steady background requests) and Supabase Realtime (would require adding a scheduler/cron that nothing else in this codebase uses, purely to flip a row at an arbitrary wall-clock instant) because it needs zero new infrastructure and matches the single-request-response model every other game (Dice, Roulette, Mines) already uses.

## 2. Data Model & Server Architecture

New table, identical shape/guarantees to `mines_rounds`:

```sql
create table public.crash_rounds (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crash_rounds_active_idx
  on public.crash_rounds (casino_id, user_id, status);

-- At most one active (non-complete) crash round per user per casino.
create unique index crash_rounds_one_active_idx
  on public.crash_rounds (casino_id, user_id)
  where status <> 'complete';

-- RLS on with NO policies: only the service-role key (used by the edge
-- function) can touch this table.
alter table public.crash_rounds enable row level security;
```

`state` jsonb shape: `{ bet: number, startedAt: string (ISO), crashPoint: number, outcome?: "cashed_out" | "busted", payout?: number }`.

**Edge function** `supabase/functions/crash/` — `engine.ts` (pure logic) + `index.ts` (HTTP/DB glue), same skeleton as every other game (CORS headers, `json()` helper, crypto `rng()`, `userClient` for RLS-scoped reads + `admin` service-role client for privileged writes). Single function, dispatched on `body.action`:

- **`start`** — request `{ casino_id, casino_game_id, bet }`.
  1. Parallel-fetch `casino_members.balance` (via `userClient`) and `casino_games.min_bet/max_bet` (via `admin`, filtered `game_type_id: "crash"`).
  2. Validate membership exists, bet is finite/positive, within `[min_bet, max_bet]`, `<= balance`.
  3. Delete any stale non-complete `crash_rounds` row for this user/casino (abandoned-round cleanup, same as Mines).
  4. Generate `crash_point` via the formula above; insert row with `state: { bet, startedAt: now, crashPoint }, status: 'active'`.
  5. Deduct bet from balance, insert a `transactions` row (`amount: -bet`).
  6. Return sanitized state: `{ roundId, status, bet, startedAt, balance }` — **no `crashPoint`**.

- **`cashout`** — request `{ round_id }`.
  1. Fetch round by `id` AND `user_id`; 404 if missing, 400 `"Round already finished"` if `status === 'complete'`.
  2. Compute `elapsed`/`current`/outcome per Section 1.
  3. If won: credit `payout` to balance. Insert `transactions` row (`amount: payout` or `0` if busted).
  4. Update round to `status: 'complete'`, `state.outcome`, `state.payout`.
  5. Return sanitized state **including `crashPoint`** now, plus `{ won, payout, balance }`.

**Concurrency guard**: identical to Mines — every action re-fetches the round fresh by `id + user_id` and checks `status === 'active'` before mutating, so a duplicate/racing cash-out request can't double-pay. The DB's partial unique index is the hard guarantee against a double-started round; the app-level delete-stale-rounds step is just cleanup.

**Abandoned rounds**: if a player closes the tab mid-round, the round stays `active` (bet already deducted, no refund) until their next `start` call in that casino deletes it as stale — identical, pre-existing behavior to abandoned Mines rounds, not a new gap.

**Registration**: no `game_types` migration needed — reuse the existing `crash` row (`name: "Crash"`, `description: "Cash out before the multiplier crashes"`, already correct). Add `"crash"` to `PLAYABLE_GAME_IDS` in `src/pages/CasinoDashboard.tsx`, and add the render branch for `<Crash />` in the game modal switch (same shape as the other branches). `src/lib/gameArt.ts` already maps `crash: "/games/crash.svg"`, and `public/games/crash.svg` already exists on disk.

## 3. Frontend & Visuals

**Files**:
- `src/hooks/useCrash.ts` — mirrors `useMines.ts`: exposes `{ state, loading, error, start, cashOut, reset }`, thin wrappers around `supabase.functions.invoke("crash", { action, ... })`, same `FunctionsHttpError`-unwrapping idiom used by every existing hook.
- `src/components/games/Crash.tsx` — same prop shape as every game component: `{ casinoId, gameId, balance, minBet, maxBet, onExit }`.

**Balance handling** (multi-step-game convention, matching Mines exactly per CLAUDE.md): deduct instantly on `start`, credit straight from the server response on `cashout` — no optimistic pre-deduction/animation-gated dance, since cash-out itself is the reveal (there's no suspense layer sitting on top of an already-decided outcome the way Dice's slider or Roulette's wheel has).

**Centerpiece — "Rocket Ascent" theme, "Gentle" pacing** (both user-approved via live browser mockups):
- Starfield background, rocket sprite climbing a vertical track, big glowing multiplier readout.
- Rocket's vertical position: `percentage = min(1, log(multiplier) / log(DISPLAY_CAP))` of track height, `DISPLAY_CAP = 10` — the rocket reaches the top of the track around 10x and stays pinned there while the number keeps climbing beyond that (10x is already a rare outcome at 1% house edge, so pinning the sprite doesn't undersell typical rounds). This is a continuous percentage of the container, not a fixed-px position, so it scales naturally with viewport (satisfies the CLAUDE.md fill-sizing intent without needing a literal `clamp()` for this particular element).
- While `status === 'active'`, a `requestAnimationFrame` loop computes `elapsed = (Date.now() - startedAt) / 1000` and renders `multiplier(elapsed)` locally via the same public formula — cosmetic only; the server independently recomputes and is authoritative at cash-out, same "local mirror" convention as Dice's/Roulette's client-side preview math.
- Multiplier readout font-size uses `clamp()` for legibility across viewport sizes.

**Modal sizing**: `style={{ width: "min(98vw, 1300px)", height: "min(90vh, 760px)" }}`, `Modal size="xl"`, `dismissible={false}` (an Escape/backdrop click must never abandon a live bet — same as every other game).

**Cash-out win**: response is `{ won: true, payout, crashPoint, balance }`. Rocket plays a celebratory boost-off using the existing deterministic-particle win-overlay technique (fixed angle/distance/delay per particle, `key`-remounted so every win looks intentional rather than randomly jittery — same pattern as Dice/Mines/Roulette). Primary line: `+{payout} chips`. Secondary line: `"Busted at {crashPoint}x"` — shown as bonus flavor/FOMO info on a win screen.

**Bust (cashed out too late)**: response is `{ won: false, payout: 0, crashPoint, balance }`. Rocket plays a quick shatter/break animation (particle burst + red flash, same deterministic-array technique) with `"Busted at {crashPoint}x"` shown inline as part of that break animation.

> **Explicit exception to CLAUDE.md's general "no loss UI" rule**: this game always reveals the bust multiplier, on both win and loss, per explicit user instruction. This is intentionally baked into the break animation itself (comparable to Mines' shake+red-ring feedback on hitting a mine) rather than a separate modal/banner, so it doesn't reintroduce a "You Lost $X" banner — just the crash-point number as part of the visual.

**Sound**: reuse `src/lib/sound.ts` — `playWinChime()` on cash-out win, `playLoseThud()` on bust — both already gated behind `useSoundStore().muted`.

## 4. Testing & Edge Cases

**Unit tests** — `supabase/functions/crash/engine.test.ts` (vitest, same conventions as `dice/engine.test.ts`):
- `generateCrashPoint`: bounds (`>= 1.00`, respects `MAX_CRASH_POINT`), exact values for fixed `rng()` inputs, and a statistical check over many samples confirming ~1% house edge across a spread of simulated cash-out targets.
- `multiplierAt`: exact values at `t = 0` (must be `1.00`) and a few known points against `GROWTH_RATE`.
- Round resolution: win when `current < crashPoint`, bust when `current >= crashPoint` (boundary is a bust — strict less-than favors the house consistently), payout rounding via the existing `roundMoney` helper.

**Edge cases**:
- Double-submit/race on cash-out: guarded like Mines — round re-fetched fresh by `id + user_id`, rejected with 400 if not `active` before any mutation.
- Starting a new round while one is active: stale-round cleanup deletes it first (same as Mines).
- Bet validation: identical shape to Mines/Dice (finite positive number, within `casino_games` min/max for `game_type_id: "crash"`, `<=` current balance).
- Clock skew/network latency on cash-out: irrelevant to fairness — the server compares its own `now` to its own stored `startedAt`; the client's local animation is purely cosmetic and never trusted for payout.

**Manual verification** (Playwright, using the pre-seeded `claudetest.cassie@gmail.com` account): place a bet, watch the rocket climb, cash out for a win and confirm balance/celebration/reveal text are correct; place another bet and let it run past the crash point to confirm the bust path — balance stays deducted, break animation shows the correct busted-at value; sanity-check modal sizing at ~375px and ~1920px viewports per the CLAUDE.md fill-sizing checklist.

## Out of Scope (v1)

- Auto cash-out (target-multiplier pre-set).
- Live/real-time bust visuals for players who never click Cash Out (would require polling or realtime infra — noted as a natural v2 upgrade path).
- Any multiplayer/spectator feed of other players' live rounds.
