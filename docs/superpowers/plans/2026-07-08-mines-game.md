# Mines Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mines as a fourth playable game on OnlineCassie — a 5×5 grid where the player reveals tiles to avoid a chosen number of hidden mines, cashing out any time for an increasing multiplier, styled after Stake's Mines.

**Architecture:** A new Supabase Edge Function (`mines`) owns mine placement and payout math, following the Blackjack function's multi-action, persisted-round pattern (`start` → `reveal` (repeatable) → `cashout`), backed by a new `mines_rounds` table. The frontend adds a hook + component following the existing `useBlackjack`/`Blackjack.tsx` conventions, reusing the shared `src/lib/sound.ts` module for sound effects, and wires into `CasinoDashboard.tsx` and `GameTile.tsx` alongside the other games.

**Tech Stack:** Deno Edge Function (TypeScript), Vitest for engine unit tests, React + Tailwind for the UI, Supabase Postgres for persistence.

Spec: `docs/superpowers/specs/2026-07-08-mines-game-design.md`

---

### Task 1: Migration — `mines` game type and `mines_rounds` table

**Files:**
- Create: `supabase/migrations/029_mines.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/029_mines.sql`:

```sql
insert into public.game_types (id, name, description, min_bet, max_bet) values
  ('mines', 'Mines', 'Find gems, avoid the mines', 100, 50000);

create table public.mines_rounds (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fast lookup of a user's active round in a casino.
create index mines_rounds_active_idx
  on public.mines_rounds (casino_id, user_id, status);

-- Guarantee at most one active (non-complete) mines round per user per
-- casino, closing the same double-deduction window Blackjack guards against.
create unique index mines_rounds_one_active_idx
  on public.mines_rounds (casino_id, user_id)
  where status <> 'complete';

-- RLS on with NO policies: the anon/authenticated roles get zero access.
-- The edge function uses the service role key, which bypasses RLS.
alter table public.mines_rounds enable row level security;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool against project `tvivhadsgtvfvxwpahef`, using the SQL above as the migration content and `029_mines` as the migration name.

Expected: migration applies with no error. Verify with the MCP `list_tables` tool that `mines_rounds` now exists, and confirm with `execute_sql` that `select * from game_types where id = 'mines'` returns one row with `min_bet = 100`, `max_bet = 50000`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/029_mines.sql
git commit -m "feat(mines): add game_types row and mines_rounds table"
```

---

### Task 2: Mines engine — pure math/state module (TDD)

**Files:**
- Create: `supabase/functions/mines/engine.ts`
- Test: `supabase/functions/mines/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/mines/engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  placeMines,
  multiplierForPicks,
  startRound,
  revealTile,
  cashOut,
  sanitize,
  roundMoney,
  GRID_SIZE,
  HOUSE_EDGE,
  MIN_MINES,
  MAX_MINES,
} from "./engine";

describe("constants", () => {
  it("grid is 5x5 with a 2% house edge and 1-24 mine range", () => {
    expect(GRID_SIZE).toBe(25);
    expect(HOUSE_EDGE).toBe(0.02);
    expect(MIN_MINES).toBe(1);
    expect(MAX_MINES).toBe(24);
  });
});

describe("placeMines", () => {
  it("returns exactly `count` unique indices within [0, GRID_SIZE)", () => {
    const mines = placeMines(5, Math.random);
    expect(mines).toHaveLength(5);
    expect(new Set(mines).size).toBe(5);
    for (const m of mines) {
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(GRID_SIZE);
    }
  });
});

describe("multiplierForPicks", () => {
  it("at 0 picks returns just the house-edge discount", () => {
    expect(multiplierForPicks(0, 3)).toBeCloseTo(0.98, 10);
  });
  it("matches the known fair-odds value for 3 mines, 1 pick", () => {
    expect(multiplierForPicks(1, 3)).toBeCloseTo((25 / 22) * 0.98, 10);
  });
  it("increases with each additional pick", () => {
    const m0 = multiplierForPicks(0, 3);
    const m1 = multiplierForPicks(1, 3);
    const m2 = multiplierForPicks(2, 3);
    expect(m1).toBeGreaterThan(m0);
    expect(m2).toBeGreaterThan(m1);
  });
  it("increases with more mines at the same pick count", () => {
    expect(multiplierForPicks(1, 10)).toBeGreaterThan(multiplierForPicks(1, 3));
  });
});

describe("startRound", () => {
  it("creates an active round with the requested mine count and no reveals", () => {
    const state = startRound({ bet: 100, minesCount: 5, rng: () => 0.5 });
    expect(state.status).toBe("active");
    expect(state.revealed).toEqual([]);
    expect(state.mines).toHaveLength(5);
    expect(state.bet).toBe(100);
    expect(state.minesCount).toBe(5);
  });
});

describe("revealTile", () => {
  it("appends a safe tile to revealed and stays active", () => {
    const start = startRound({ bet: 100, minesCount: 1, rng: () => 0 });
    const safeTile = [...Array(25).keys()].find((t) => !start.mines.includes(t))!;
    const next = revealTile(start, safeTile);
    expect(next.status).toBe("active");
    expect(next.revealed).toEqual([safeTile]);
  });

  it("completes with outcome hit_mine and payout 0 on a mine", () => {
    const start = startRound({ bet: 100, minesCount: 1, rng: () => 0 });
    const mineTile = start.mines[0];
    const next = revealTile(start, mineTile);
    expect(next.status).toBe("complete");
    expect(next.outcome).toBe("hit_mine");
    expect(next.payout).toBe(0);
  });

  it("auto-completes with outcome cleared and full payout on the last safe tile", () => {
    // 24 mines leaves exactly 1 safe tile.
    const start = startRound({ bet: 100, minesCount: 24, rng: () => 0.999999 });
    const safeTile = [...Array(25).keys()].find((t) => !start.mines.includes(t))!;
    const next = revealTile(start, safeTile);
    expect(next.status).toBe("complete");
    expect(next.outcome).toBe("cleared");
    expect(next.payout).toBe(roundMoney(100 * multiplierForPicks(1, 24)));
  });

  it("throws when revealing an already-revealed tile", () => {
    const start = startRound({ bet: 100, minesCount: 1, rng: () => 0.5 });
    const safeTile = [...Array(25).keys()].find((t) => !start.mines.includes(t))!;
    const next = revealTile(start, safeTile);
    expect(() => revealTile(next, safeTile)).toThrow("already revealed");
  });

  it("throws on an out-of-range tile", () => {
    const start = startRound({ bet: 100, minesCount: 1, rng: () => 0.5 });
    expect(() => revealTile(start, -1)).toThrow("out of range");
    expect(() => revealTile(start, 25)).toThrow("out of range");
  });

  it("throws when the round is already complete", () => {
    const start = startRound({ bet: 100, minesCount: 1, rng: () => 0.5 });
    const mineTile = start.mines[0];
    const done = revealTile(start, mineTile);
    const otherTile = [...Array(25).keys()].find((t) => t !== mineTile)!;
    expect(() => revealTile(done, otherTile)).toThrow("already complete");
  });
});

describe("cashOut", () => {
  it("throws with zero reveals", () => {
    const start = startRound({ bet: 100, minesCount: 3, rng: () => 0.5 });
    expect(() => cashOut(start)).toThrow("Reveal at least one tile");
  });

  it("pays out bet times the multiplier for the number of safe reveals", () => {
    const start = startRound({ bet: 100, minesCount: 3, rng: () => 0.5 });
    const safeTile = [...Array(25).keys()].find((t) => !start.mines.includes(t))!;
    const revealed = revealTile(start, safeTile);
    const cashed = cashOut(revealed);
    expect(cashed.status).toBe("complete");
    expect(cashed.outcome).toBe("cashed_out");
    expect(cashed.payout).toBe(roundMoney(100 * multiplierForPicks(1, 3)));
  });

  it("throws if the round is already complete", () => {
    const start = startRound({ bet: 100, minesCount: 3, rng: () => 0.5 });
    const mineTile = start.mines[0];
    const done = revealTile(start, mineTile);
    expect(() => cashOut(done)).toThrow("already complete");
  });
});

describe("sanitize", () => {
  it("hides mines while the round is active", () => {
    const start = startRound({ bet: 100, minesCount: 3, rng: () => 0.5 });
    const view = sanitize(start, "round-1", 900);
    expect(view.mines).toBeNull();
    expect(view.status).toBe("active");
    expect(view.balance).toBe(900);
  });

  it("reveals the full board once the round is complete", () => {
    const start = startRound({ bet: 100, minesCount: 3, rng: () => 0.5 });
    const mineTile = start.mines[0];
    const done = revealTile(start, mineTile);
    const view = sanitize(done, "round-1", 800);
    expect(view.mines).toEqual(done.mines);
    expect(view.payout).toBe(0);
  });

  it("nextMultiplier is set while active and null once complete", () => {
    const start = startRound({ bet: 100, minesCount: 3, rng: () => 0.5 });
    const activeView = sanitize(start, "round-1", 900);
    expect(activeView.nextMultiplier).toBeCloseTo(multiplierForPicks(1, 3), 10);

    const mineTile = start.mines[0];
    const done = revealTile(start, mineTile);
    const doneView = sanitize(done, "round-1", 800);
    expect(doneView.nextMultiplier).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run supabase/functions/mines/engine.test.ts`
Expected: FAIL — `./engine` cannot be found (module doesn't exist yet).

- [ ] **Step 3: Implement the engine module**

Create `supabase/functions/mines/engine.ts`:

```ts
export type Rng = () => number;

export const GRID_SIZE = 25;
export const HOUSE_EDGE = 0.02;
export const MIN_MINES = 1;
export const MAX_MINES = 24;

export type Outcome = "cashed_out" | "hit_mine" | "cleared";

export interface RoundState {
  mines: number[];
  revealed: number[];
  minesCount: number;
  bet: number;
  status: "active" | "complete";
  outcome?: Outcome;
  payout?: number;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Fisher-Yates partial shuffle: pick `count` unique indices from [0, GRID_SIZE).
export function placeMines(count: number, rng: Rng): number[] {
  const pool = Array.from({ length: GRID_SIZE }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

// Fair multiplier for surviving `picks` reveals with `minesCount` mines on
// the board, scaled down by HOUSE_EDGE. picks = 0 returns (1 - HOUSE_EDGE).
export function multiplierForPicks(picks: number, minesCount: number): number {
  let fairOdds = 1;
  for (let i = 0; i < picks; i++) {
    fairOdds *= (GRID_SIZE - minesCount - i) / (GRID_SIZE - i);
  }
  return (1 / fairOdds) * (1 - HOUSE_EDGE);
}

export function startRound(opts: { bet: number; minesCount: number; rng: Rng }): RoundState {
  return {
    mines: placeMines(opts.minesCount, opts.rng),
    revealed: [],
    minesCount: opts.minesCount,
    bet: opts.bet,
    status: "active",
  };
}

export function revealTile(prev: RoundState, tile: number): RoundState {
  if (prev.status !== "active") throw new Error("Round is already complete");
  if (!Number.isInteger(tile) || tile < 0 || tile >= GRID_SIZE) {
    throw new Error("Tile out of range");
  }
  if (prev.revealed.includes(tile)) throw new Error("Tile already revealed");

  const state: RoundState = { ...prev, revealed: [...prev.revealed, tile] };

  if (state.mines.includes(tile)) {
    state.status = "complete";
    state.outcome = "hit_mine";
    state.payout = 0;
    return state;
  }

  const safeTiles = GRID_SIZE - state.minesCount;
  if (state.revealed.length === safeTiles) {
    state.status = "complete";
    state.outcome = "cleared";
    state.payout = roundMoney(state.bet * multiplierForPicks(state.revealed.length, state.minesCount));
  }
  return state;
}

export function cashOut(prev: RoundState): RoundState {
  if (prev.status !== "active") throw new Error("Round is already complete");
  if (prev.revealed.length === 0) throw new Error("Reveal at least one tile before cashing out");
  return {
    ...prev,
    status: "complete",
    outcome: "cashed_out",
    payout: roundMoney(prev.bet * multiplierForPicks(prev.revealed.length, prev.minesCount)),
  };
}

export interface MinesState {
  roundId: string;
  status: "active" | "complete";
  minesCount: number;
  bet: number;
  revealed: number[];
  mines: number[] | null;
  outcome?: Outcome;
  multiplier: number;
  nextMultiplier: number | null;
  payout: number | null;
  balance: number;
}

export function sanitize(state: RoundState, roundId: string, balance: number): MinesState {
  const safeTiles = GRID_SIZE - state.minesCount;
  const atMax = state.revealed.length >= safeTiles;
  return {
    roundId,
    status: state.status,
    minesCount: state.minesCount,
    bet: state.bet,
    revealed: state.revealed,
    mines: state.status === "complete" ? state.mines : null,
    outcome: state.outcome,
    multiplier: multiplierForPicks(state.revealed.length, state.minesCount),
    nextMultiplier:
      state.status === "complete" || atMax
        ? null
        : multiplierForPicks(state.revealed.length + 1, state.minesCount),
    payout: state.payout ?? null,
    balance,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/mines/engine.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mines/engine.ts supabase/functions/mines/engine.test.ts
git commit -m "feat(mines): add pure engine module with mine placement and payout math"
```

---

### Task 3: Mines edge function

**Files:**
- Create: `supabase/functions/mines/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/mines/index.ts`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startRound,
  revealTile,
  cashOut,
  sanitize,
  roundMoney,
  MIN_MINES,
  MAX_MINES,
  type RoundState,
} from "./engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: auth } = await userClient.auth.getUser();
    const user = auth.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json();

    if (body.action === "start") {
      const { casino_id, bet, mines_count } = body as {
        casino_id: string;
        bet: number;
        mines_count: number;
      };

      if (!Number.isInteger(mines_count) || mines_count < MIN_MINES || mines_count > MAX_MINES) {
        return json({ error: `Mines must be between ${MIN_MINES} and ${MAX_MINES}` }, 400);
      }

      // Membership/balance and bet limits don't depend on each other — fetch both at once.
      const [{ data: member }, { data: gt }] = await Promise.all([
        userClient
          .from("casino_members")
          .select("balance")
          .eq("casino_id", casino_id)
          .eq("user_id", user.id)
          .single(),
        admin.from("game_types").select("min_bet, max_bet").eq("id", "mines").single(),
      ]);
      if (!member) return json({ error: "You are not a member of this casino" }, 403);
      if (typeof bet !== "number" || !isFinite(bet) || bet <= 0) {
        return json({ error: "Invalid bet" }, 400);
      }
      const validBet = roundMoney(bet);
      if (validBet < Number(gt!.min_bet) || validBet > Number(gt!.max_bet)) {
        return json({ error: `Bet must be between ${gt!.min_bet} and ${gt!.max_bet}` }, 400);
      }
      if (validBet > member.balance) return json({ error: "Insufficient balance" }, 400);

      // One active round at a time.
      await admin
        .from("mines_rounds")
        .delete()
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .neq("status", "complete");

      const state = startRound({ bet: validBet, minesCount: mines_count, rng });
      const balance = roundMoney(member.balance - validBet);

      const [{ data: round }] = await Promise.all([
        admin
          .from("mines_rounds")
          .insert({ casino_id, user_id: user.id, state, status: state.status })
          .select("id")
          .single(),
        admin.from("casino_members").update({ balance }).eq("casino_id", casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id,
          user_id: user.id,
          amount: -validBet,
          balance_after: balance,
          game_type_id: "mines",
          description: `Mines bet (${mines_count} mines)`,
        }),
      ]);

      return json(sanitize(state, round!.id, balance));
    }

    if (body.action === "reveal") {
      const { round_id, tile } = body as { round_id: string; tile: number };

      const { data: round } = await admin
        .from("mines_rounds")
        .select("*")
        .eq("id", round_id)
        .eq("user_id", user.id)
        .single();
      if (!round) return json({ error: "Round not found" }, 404);
      if (round.status === "complete") return json({ error: "Round already finished" }, 400);

      const prev = round.state as RoundState;
      let next: RoundState;
      try {
        next = revealTile(prev, tile);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }

      const writes: Promise<unknown>[] = [
        admin
          .from("mines_rounds")
          .update({ state: next, status: next.status, updated_at: new Date().toISOString() })
          .eq("id", round_id),
      ];

      const { data: member } = await admin
        .from("casino_members")
        .select("balance")
        .eq("casino_id", round.casino_id)
        .eq("user_id", user.id)
        .single();

      let balance = member!.balance;
      if (next.status === "complete") {
        balance = roundMoney(member!.balance + (next.payout ?? 0));
        writes.push(
          admin.from("casino_members").update({ balance }).eq("casino_id", round.casino_id).eq("user_id", user.id),
          admin.from("transactions").insert({
            casino_id: round.casino_id,
            user_id: user.id,
            amount: next.payout ?? 0,
            balance_after: balance,
            game_type_id: "mines",
            description: next.outcome === "hit_mine" ? "Mines: hit a mine" : "Mines: cleared the board",
          })
        );
      }

      await Promise.all(writes);
      return json(sanitize(next, round_id, balance));
    }

    if (body.action === "cashout") {
      const { round_id } = body as { round_id: string };

      const { data: round } = await admin
        .from("mines_rounds")
        .select("*")
        .eq("id", round_id)
        .eq("user_id", user.id)
        .single();
      if (!round) return json({ error: "Round not found" }, 404);
      if (round.status === "complete") return json({ error: "Round already finished" }, 400);

      const prev = round.state as RoundState;
      let next: RoundState;
      try {
        next = cashOut(prev);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }

      const { data: member } = await admin
        .from("casino_members")
        .select("balance")
        .eq("casino_id", round.casino_id)
        .eq("user_id", user.id)
        .single();
      const balance = roundMoney(member!.balance + (next.payout ?? 0));

      await Promise.all([
        admin
          .from("mines_rounds")
          .update({ state: next, status: next.status, updated_at: new Date().toISOString() })
          .eq("id", round_id),
        admin.from("casino_members").update({ balance }).eq("casino_id", round.casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id: round.casino_id,
          user_id: user.id,
          amount: next.payout ?? 0,
          balance_after: balance,
          game_type_id: "mines",
          description: "Mines: cashed out",
        }),
      ]);

      return json(sanitize(next, round_id, balance));
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Deploy the function**

Deploy via the Supabase MCP `deploy_edge_function` tool:
- name: `mines`
- entrypoint: `index.ts`
- files: `index.ts` and `engine.ts` (both from `supabase/functions/mines/`).

Expected: deploy succeeds; function listed by `list_edge_functions`.

- [ ] **Step 3: Smoke-test the deployed function**

Using the test account (`claudetest.cassie@gmail.com`, see `CLAUDE.md`), sign in via the running app, and invoke the function from the browser console (`supabase.functions.invoke("mines", { body: {...} })`) with a real `casino_id` you are a member of:

```json
{ "action": "start", "casino_id": "<real-casino-id>", "bet": 500, "mines_count": 3 }
```

Expected: JSON response with `status: "active"`, `revealed: []`, `mines: null`, `multiplier` ≈ 0.98, `balance` reduced by 500. Confirm `mines_rounds` has one new row with `status = 'active'` and `transactions` has a `mines` row for `-500`.

Then reveal a tile using the returned `roundId`:

```json
{ "action": "reveal", "round_id": "<roundId from above>", "tile": 0 }
```

Expected: either `status: "active"` with `revealed: [0]` and a higher `multiplier`, or (if tile 0 was a mine) `status: "complete"`, `outcome: "hit_mine"`, `mines` populated, and the balance unchanged from the post-bet value (no further deduction).

Then cash out (if still active):

```json
{ "action": "cashout", "round_id": "<roundId>" }
```

Expected: `status: "complete"`, `outcome: "cashed_out"`, `payout` and `balance` reflecting the multiplier at however many tiles were revealed. Also confirm rejections:
- `cashout` with zero reveals → 400 "Reveal at least one tile before cashing out"
- `start` with `mines_count: 30` → 400 "Mines must be between 1 and 24"
- a second `start` while a round is active → succeeds and the previous round's row is gone (deleted by the "one active round" cleanup), confirming no double-deduction.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mines/index.ts
git commit -m "feat(mines): edge function with start/reveal/cashout actions"
```

---

### Task 4: Frontend types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Append the Mines types**

Add to the end of `src/types/index.ts`:

```ts
export type MinesOutcome = "cashed_out" | "hit_mine" | "cleared";

export interface MinesState {
  roundId: string;
  status: "active" | "complete";
  minesCount: number;
  bet: number;
  revealed: number[];
  mines: number[] | null;
  outcome?: MinesOutcome;
  multiplier: number;
  nextMultiplier: number | null;
  payout: number | null;
  balance: number;
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(mines): add MinesOutcome and MinesState types"
```

---

### Task 5: Add a lose sound to the shared sound module

**Files:**
- Modify: `src/lib/sound.ts`

- [ ] **Step 1: Add `playLoseThud`**

Append to `src/lib/sound.ts`:

```ts
// Low descending thud for a loss (e.g. hitting a mine).
export function playLoseThud(): void {
  playTone({ freq: 180, duration: 0.35, volume: 0.12, type: "sawtooth" });
  playTone({ freq: 90, duration: 0.4, volume: 0.1, type: "sine", delay: 0.05 });
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sound.ts
git commit -m "feat(mines): add playLoseThud sound effect"
```

---

### Task 6: `useMines` hook

**Files:**
- Create: `src/hooks/useMines.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useMines.ts`:

```ts
import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { MinesState } from "../types";

export function useMines(casinoId: string | undefined) {
  const [state, setState] = useState<MinesState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("mines", { body });
    setLoading(false);
    if (error) {
      // supabase-js returns non-2xx as FunctionsHttpError; the JSON { error }
      // body lives on error.context (a Response), not on `data`.
      let message = error.message;
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const parsed = await ctx.json();
          if (parsed?.error) message = parsed.error as string;
        } catch {
          /* keep the default message */
        }
      }
      setError(message);
      throw new Error(message);
    }
    setState(data as MinesState);
    return data as MinesState;
  }, []);

  const start = useCallback(
    (bet: number, minesCount: number) =>
      invoke({ action: "start", casino_id: casinoId, bet, mines_count: minesCount }),
    [invoke, casinoId]
  );

  const reveal = useCallback(
    (tile: number) => {
      if (!state) throw new Error("No active round");
      return invoke({ action: "reveal", round_id: state.roundId, tile });
    },
    [invoke, state]
  );

  const cashOut = useCallback(() => {
    if (!state) throw new Error("No active round");
    return invoke({ action: "cashout", round_id: state.roundId });
  }, [invoke, state]);

  const reset = useCallback(() => setState(null), []);

  return { state, loading, error, start, reveal, cashOut, reset };
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMines.ts
git commit -m "feat(mines): add useMines hook"
```

---

### Task 7: `mines.svg` tile art

**Files:**
- Create: `public/games/mines.svg`

- [ ] **Step 1: Create the art asset**

Create `public/games/mines.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#166534"/>
  <g fill="#0f2f1f">
    <rect x="14" y="14" width="24" height="24" rx="4"/>
    <rect x="42" y="14" width="24" height="24" rx="4"/>
    <rect x="70" y="14" width="16" height="24" rx="4"/>
    <rect x="14" y="42" width="24" height="24" rx="4"/>
    <rect x="42" y="42" width="24" height="24" rx="4"/>
    <rect x="70" y="42" width="16" height="24" rx="4"/>
    <rect x="14" y="70" width="24" height="16" rx="4"/>
    <rect x="42" y="70" width="24" height="16" rx="4"/>
    <rect x="70" y="70" width="16" height="16" rx="4"/>
  </g>
  <polygon points="26,17 34,26 26,35 18,26" fill="#22c55e"/>
  <circle cx="54" cy="54" r="9" fill="#ef4444"/>
  <g stroke="#ef4444" stroke-width="2.5" stroke-linecap="round">
    <line x1="54" y1="40" x2="54" y2="45"/>
    <line x1="54" y1="63" x2="54" y2="68"/>
    <line x1="40" y1="54" x2="45" y2="54"/>
    <line x1="63" y1="54" x2="68" y2="54"/>
  </g>
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add public/games/mines.svg
git commit -m "feat(mines): add mines.svg tile art"
```

---

### Task 8: `Mines` game component

**Files:**
- Create: `src/components/games/Mines.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/games/Mines.tsx`:

```tsx
import { useState } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { formatChips } from "../../lib/utils";
import { useMines } from "../../hooks/useMines";
import { playTone, playWinChime, playLoseThud } from "../../lib/sound";

const GRID_SIZE = 25;
const MIN_MINES = 1;
const MAX_MINES = 24;

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface Props {
  casinoId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

// Precomputed burst of flying gems for the win animation (deterministic so
// every win looks intentional rather than random-jittery) — mirrors Dice's
// CASH_PARTICLES treatment.
const GEM_PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const angle = (i - 4.5) * 16;
  return {
    angle,
    dist: 90 + (i % 3) * 45,
    delay: (i % 5) * 40,
    spin: i % 2 === 0 ? 240 : -240,
  };
});

export function Mines({ casinoId, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { state, loading, error: reqError, start, reveal, cashOut } = useMines(casinoId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [minesCount, setMinesCount] = useState(3);
  const [formError, setFormError] = useState<string | null>(null);
  const [winId, setWinId] = useState(0);

  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;

  const hasActiveRound = state?.status === "active";
  const isComplete = state?.status === "complete";
  const currentPayout = state ? roundMoney(state.bet * state.multiplier) : 0;

  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  async function handleBet() {
    if (loading || hasActiveRound || !betValid) return;
    setFormError(null);
    try {
      const res = await start(bet, minesCount);
      setLocalBalance(res.balance);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Bet failed");
    }
  }

  async function handleTileClick(tile: number) {
    if (loading || !state || state.status !== "active") return;
    if (state.revealed.includes(tile)) return;
    setFormError(null);
    try {
      const res = await reveal(tile);
      setLocalBalance(res.balance);
      if (res.status === "complete") {
        if (res.outcome === "hit_mine") {
          playLoseThud();
        } else {
          playWinChime();
          setWinId((id) => id + 1);
        }
      } else {
        playTone({ freq: 660, duration: 0.08, volume: 0.05, type: "triangle" });
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Reveal failed");
    }
  }

  async function handleCashOut() {
    if (loading || !state || state.status !== "active" || state.revealed.length === 0) return;
    setFormError(null);
    try {
      const res = await cashOut();
      setLocalBalance(res.balance);
      playWinChime();
      setWinId((id) => id + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Cash out failed");
    }
  }

  function tileContent(i: number): "hidden" | "gem" | "mine" {
    if (!state) return "hidden";
    if (state.status === "active") {
      return state.revealed.includes(i) ? "gem" : "hidden";
    }
    return state.mines?.includes(i) ? "mine" : "gem";
  }

  const hitTile =
    state?.status === "complete" && state.outcome === "hit_mine"
      ? state.revealed[state.revealed.length - 1]
      : null;

  return (
    <div
      className="relative bg-card rounded-2xl overflow-hidden flex flex-col"
      style={{ width: "min(98vw, 900px)", height: "min(90vh, 640px)" }}
    >
      <MinesStyles />
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Mines</p>
          <p className="text-xs text-muted-foreground">Balance: {formatChips(localBalance)} chips</p>
        </div>
        <button type="button" onClick={onExit} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>

      {isComplete && (
        <div
          className={`px-5 py-2 text-center font-bold text-white text-sm shrink-0 ${
            state!.outcome === "hit_mine" ? "bg-red-700" : "bg-emerald-700"
          }`}
        >
          {state!.outcome === "hit_mine"
            ? `Hit a mine — lost ${formatChips(state!.bet)} chips`
            : `Cashed out ${formatChips(state!.payout ?? 0)} chips`}
        </div>
      )}

      {winId > 0 && isComplete && state!.outcome !== "hit_mine" && (
        <div
          key={winId}
          className="mn-win-overlay absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          {GEM_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="mn-gem"
              style={{
                "--mn-rot": `${p.angle}deg`,
                "--mn-dist": `-${p.dist}px`,
                "--mn-spin": `${p.spin}deg`,
                animationDelay: `${p.delay}ms`,
              } as CSSProperties}
            >
              💎
            </span>
          ))}
          <p className="mn-win-text text-3xl font-black text-emerald-400 drop-shadow-[0_2px_8px_rgba(16,185,129,0.6)]">
            +{formatChips(state!.payout ?? 0)} chips
          </p>
        </div>
      )}

      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-auto">
        <div className="flex flex-col gap-3 p-4 md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border">
          <div>
            <label className="text-xs text-muted-foreground">Bet Amount</label>
            <input
              type="number"
              min={0}
              value={betText}
              onChange={(e) => setBetText(e.target.value)}
              disabled={loading || hasActiveRound}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => adjustBet(0.5)}
                disabled={loading || hasActiveRound}
                className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                ½
              </button>
              <button
                type="button"
                onClick={() => adjustBet(2)}
                disabled={loading || hasActiveRound}
                className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                2×
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Min {formatChips(minBet)} · Max {formatChips(maxBet)}
            </p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Mines</label>
            <select
              value={minesCount}
              onChange={(e) => setMinesCount(Number(e.target.value))}
              disabled={loading || hasActiveRound}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {Array.from({ length: MAX_MINES - MIN_MINES + 1 }, (_, i) => i + MIN_MINES).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {hasActiveRound && (
            <div className="rounded-lg border border-border px-3 py-2.5 space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Multiplier</span>
                <span className="font-mono">{state!.multiplier.toFixed(4)}x</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Next tile</span>
                <span className="font-mono">
                  {state!.nextMultiplier ? `${state!.nextMultiplier.toFixed(4)}x` : "—"}
                </span>
              </div>
            </div>
          )}

          <Button
            onClick={hasActiveRound ? handleCashOut : handleBet}
            disabled={loading || (hasActiveRound ? state!.revealed.length === 0 : !betValid)}
            className="mt-1 h-11 text-base font-bold"
          >
            {loading
              ? "…"
              : hasActiveRound
              ? state!.revealed.length === 0
                ? "Reveal a tile first"
                : `Cash Out ${formatChips(currentPayout)} chips`
              : "Bet"}
          </Button>

          {(formError || reqError) && (
            <p className="text-xs text-destructive">{formError ?? reqError}</p>
          )}
        </div>

        <div className="flex flex-1 items-center justify-center p-5 min-w-0">
          <div key={state?.roundId ?? "idle"} className="grid grid-cols-5 gap-2 w-full max-w-[420px]">
            {Array.from({ length: GRID_SIZE }, (_, i) => {
              const content = tileContent(i);
              const wasClicked = state?.revealed.includes(i) ?? false;
              const isHit = hitTile === i;
              const clickable = hasActiveRound && content === "hidden" && !loading;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleTileClick(i)}
                  disabled={!clickable}
                  className={`aspect-square rounded-lg flex items-center justify-center text-2xl transition-transform ${
                    content === "hidden"
                      ? "bg-muted/40 hover:bg-muted/70 disabled:hover:bg-muted/40"
                      : content === "gem"
                      ? `bg-emerald-500/20 ${wasClicked ? "" : "opacity-50"}`
                      : `bg-red-500/20 ${isHit ? "mn-hit-tile" : wasClicked ? "" : "opacity-50"}`
                  } ${clickable ? "cursor-pointer active:scale-95" : "cursor-default"} ${
                    isComplete && state!.outcome === "hit_mine" ? "mn-shake" : ""
                  }`}
                >
                  {content === "gem" && "💎"}
                  {content === "mine" && "💣"}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Scoped styles for the win/loss feedback. Everything finishes within ~950ms.
function MinesStyles() {
  return (
    <style>{`
      .mn-win-overlay {
        animation: mnOverlayFade 950ms ease-out both;
      }
      @keyframes mnOverlayFade {
        0%, 70% { opacity: 1; }
        100%    { opacity: 0; }
      }

      .mn-win-text {
        animation: mnWinPop 950ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes mnWinPop {
        0%   { opacity: 0; transform: scale(0.5) translateY(16px); }
        25%  { opacity: 1; transform: scale(1.12) translateY(0); }
        40%  { transform: scale(1); }
        100% { opacity: 1; transform: scale(1); }
      }

      .mn-gem {
        position: absolute;
        top: 50%; left: 50%;
        font-size: 22px;
        line-height: 1;
        animation: mnGemFly 800ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      }
      @keyframes mnGemFly {
        0% {
          opacity: 1;
          transform: translate(-50%, -50%) rotate(var(--mn-rot)) translateY(0) rotate(0deg) scale(0.6);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) rotate(var(--mn-rot)) translateY(var(--mn-dist)) rotate(var(--mn-spin)) scale(1.1);
        }
      }

      .mn-shake {
        animation: mnShake 400ms ease-in-out;
      }
      @keyframes mnShake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-3px); }
        40% { transform: translateX(3px); }
        60% { transform: translateX(-2px); }
        80% { transform: translateX(2px); }
      }

      .mn-hit-tile {
        animation: mnHitPulse 500ms ease-out;
      }
      @keyframes mnHitPulse {
        0%   { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
        100% { box-shadow: 0 0 0 14px rgba(239, 68, 68, 0); }
      }

      @media (prefers-reduced-motion: reduce) {
        .mn-gem { display: none; }
        .mn-win-overlay, .mn-win-text, .mn-shake, .mn-hit-tile { animation: none; }
        .mn-win-overlay { opacity: 0; }
      }
    `}</style>
  );
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/games/Mines.tsx
git commit -m "feat(mines): add Mines game UI component"
```

---

### Task 9: Wire Mines into `CasinoDashboard` and `GameTile`

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx`
- Modify: `src/components/GameTile.tsx`

- [ ] **Step 1: Import the component and mark mines playable/managed**

In `src/pages/CasinoDashboard.tsx`, change:

```ts
import { Dice } from "../components/games/Dice";
```
to:
```ts
import { Dice } from "../components/games/Dice";
import { Mines } from "../components/games/Mines";
```

And change:

```ts
const PLAYABLE_GAME_IDS = new Set(["blackjack", "roulette", "dice"]);
const MANAGED_GAME_IDS = ["blackjack", "slots", "roulette", "dice"];
```
to:
```ts
const PLAYABLE_GAME_IDS = new Set(["blackjack", "roulette", "dice", "mines"]);
const MANAGED_GAME_IDS = ["blackjack", "slots", "roulette", "dice", "mines"];
```

- [ ] **Step 2: Add mines art to `SETTINGS_GAME_ART`**

Change:

```ts
const SETTINGS_GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  dice: "/games/dice.svg",
};
```
to:
```ts
const SETTINGS_GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  dice: "/games/dice.svg",
  mines: "/games/mines.svg",
};
```

- [ ] **Step 3: Render Mines in the game modal**

Find the game modal block (the `dice` branch immediately before the closing `</Modal>`):

```tsx
          {activeGame.game_type_id === "dice" && (
            <Dice
              casinoId={currentCasino.id}
              balance={membership?.balance ?? 0}
              minBet={gameTypeMap["dice"]?.min_bet ?? 100}
              maxBet={gameTypeMap["dice"]?.max_bet ?? 50000}
              onExit={() => setActiveGame(null)}
            />
          )}
        </Modal>
      )}
```

Replace with:

```tsx
          {activeGame.game_type_id === "dice" && (
            <Dice
              casinoId={currentCasino.id}
              balance={membership?.balance ?? 0}
              minBet={gameTypeMap["dice"]?.min_bet ?? 100}
              maxBet={gameTypeMap["dice"]?.max_bet ?? 50000}
              onExit={() => setActiveGame(null)}
            />
          )}
          {activeGame.game_type_id === "mines" && (
            <Mines
              casinoId={currentCasino.id}
              balance={membership?.balance ?? 0}
              minBet={gameTypeMap["mines"]?.min_bet ?? 100}
              maxBet={gameTypeMap["mines"]?.max_bet ?? 50000}
              onExit={() => setActiveGame(null)}
            />
          )}
        </Modal>
      )}
```

- [ ] **Step 4: Add mines art to the dashboard `GameTile`**

In `src/components/GameTile.tsx`, change:

```ts
const GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  crash: "/games/crash.svg",
  dice: "/games/dice.svg",
};
```
to:
```ts
const GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  crash: "/games/crash.svg",
  dice: "/games/dice.svg",
  mines: "/games/mines.svg",
};
```

- [ ] **Step 5: Verify the project still type-checks and builds**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/pages/CasinoDashboard.tsx src/components/GameTile.tsx
git commit -m "feat(mines): wire Mines game into CasinoDashboard and GameTile"
```

---

### Task 10: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on `localhost:5173`.

- [ ] **Step 2: Sign in and enable Mines**

Using the test account (`claudetest.cassie@gmail.com` / `ClaudeTest123!`, admin in all casinos — see `CLAUDE.md`), open a casino's Settings tab and add a Mines game instance if one isn't already enabled (`MANAGED_GAME_IDS` already includes `"mines"` from Task 9, and it's in the playable set, so it should render as playable, not "Coming soon").

- [ ] **Step 3: Play a full round via the browser**

Open the Mines tile. Verify:
- The bet amount, ½/2×, and Mines dropdown controls work and are enabled before betting.
- Clicking Bet deducts the bet from the header balance, shows the 5×5 grid of hidden tiles, and disables the bet/mines controls.
- Clicking a hidden tile either reveals a 💎 (round stays active, multiplier and "next tile" values increase, a soft tick sound plays) or reveals 💣 and ends the round (red result banner, all other tiles fade in to their true contents, a mine-hit sound plays, the grid does a brief shake).
- After at least one safe reveal, the primary button reads "Cash Out N chips" and clicking it ends the round as a win (green result banner, gem-particle animation, chime sound, balance increases by the payout).
- After a round ends (win or loss), the bet/mines controls re-enable and clicking Bet again starts a fresh round with a clean grid.

- [ ] **Step 4: Verify the transaction ledger**

In the casino's Members tab (or via `execute_sql` against `transactions`), confirm `mines` rows appear for the bet and the final result (cash-out or mine-hit), with `amount`/`balance_after` matching what was shown in the UI.

- [ ] **Step 5: Confirm no regressions in the other games**

Play one round of Dice and one spin of Roulette to confirm the shared `Modal`/`CasinoDashboard` changes didn't break the existing games.

---

## Notes for the implementer

- The frontend does not duplicate the payout math from `engine.ts` the way `Dice.tsx` does — because Mines is a multi-step round, the live multiplier/next-tile values come from the server's `sanitize()` response on every action, so there's nothing to precompute client-side before the first bet.
- `src/lib/sound.ts` already exports `playTone`/`playWinChime` (used by `Roulette.tsx`); Task 5 only adds `playLoseThud`. Don't duplicate Dice's older inline `AudioContext` pattern.
- The one-active-round unique index (Task 1) and the `start` action's cleanup delete (Task 3) together prevent a double-bet race, mirroring Blackjack's existing protection — no additional locking needed.
- `GameTile.tsx` has its own `GAME_ART` map separate from `CasinoDashboard.tsx`'s `SETTINGS_GAME_ART` — both need the `mines` entry (Task 9) or the icon will be missing in one of the two places it's used.
