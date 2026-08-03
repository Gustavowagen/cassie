# Crash Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a "Crash" casino game — bet, watch a multiplier climb from 1.00x, cash out any time before it secretly busts — matching the design in `docs/superpowers/specs/2026-08-03-crash-game-design.md`.

**Architecture:** Mirrors the existing Mines game's multi-step pattern (a `crash_rounds` table + single action-dispatch edge function with `start`/`cashout`, one active round per user per casino enforced by a partial unique index) grafted onto Dice/Roulette's server-authoritative-RNG discipline. The crash point is generated server-side at `start` and never exposed until the round resolves. There is no polling or realtime push (the user's explicit "lazy reveal" choice) — the client renders a cosmetic local copy of the public growth formula, and the only truth check happens when the player clicks Cash Out.

**Tech Stack:** Supabase Edge Functions (Deno + TypeScript), Postgres (via migration), React + TypeScript, Tailwind, vitest for engine unit tests.

---

## Reference: existing conventions this plan follows

- `supabase/functions/mines/engine.ts` + `index.ts` — the multi-step round pattern (table shape, one-active-round guard, action dispatch, sanitize-before-resolution).
- `supabase/functions/dice/engine.ts` + `engine.test.ts` — the pure-engine/vitest-test pattern.
- `src/hooks/useMines.ts` — the hook shape (`{ state, loading, error, start, cashOut, reset }`, `functions.invoke` + `FunctionsHttpError` unwrapping).
- `src/components/games/Mines.tsx` — component shape, header/sidebar layout, deterministic-particle win-overlay technique.
- Only `engine.ts` files get vitest unit tests in this codebase; `index.ts` (the Deno HTTP handler) has no test harness and is verified via manual/Playwright checks instead — this plan follows that existing convention rather than introducing a new one.

---

### Task 1: Database migration — `crash_rounds` table

**Files:**
- Create: `supabase/migrations/039_crash_rounds.sql`

- [x] **Step 1: Write the migration**

```sql
-- crash_rounds mirrors mines_rounds' shape and guarantees exactly: one
-- active (non-complete) round per user per casino, RLS-on-no-policies
-- since only the service-role key (used by the edge function) touches it.
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

create unique index crash_rounds_one_active_idx
  on public.crash_rounds (casino_id, user_id)
  where status <> 'complete';

alter table public.crash_rounds enable row level security;
```

- [x] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool against project `tvivhadsgtvfvxwpahef`, with `name: "crash_rounds"` and `query` set to the exact SQL above.

- [x] **Step 3: Verify the table exists**

Use the Supabase MCP `list_tables` tool (schema `public`) and confirm `crash_rounds` appears with columns `id, casino_id, user_id, state, status, created_at, updated_at` and RLS enabled.

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/039_crash_rounds.sql
git commit -m "feat(crash): add crash_rounds table"
```

---

### Task 2: Crash engine — pure game logic

**Files:**
- Create: `supabase/functions/crash/engine.ts`
- Test: `supabase/functions/crash/engine.test.ts`

- [x] **Step 1: Write the failing tests**

Create `supabase/functions/crash/engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  generateCrashPoint,
  multiplierAt,
  startRound,
  resolveCashout,
  sanitize,
  roundMoney,
  HOUSE_EDGE,
  GROWTH_RATE,
  MAX_CRASH_POINT,
  type CrashRoundState,
} from "./engine";

describe("generateCrashPoint", () => {
  it("never returns below 1.00", () => {
    expect(generateCrashPoint(() => 0)).toBe(1);
  });

  it("respects MAX_CRASH_POINT", () => {
    expect(generateCrashPoint(() => 0.9999999)).toBeLessThanOrEqual(MAX_CRASH_POINT);
  });

  it("computes the expected value for a known random draw", () => {
    // r = 0.5 -> raw = (1 - 0.01) / (1 - 0.5) = 1.98
    expect(generateCrashPoint(() => 0.5)).toBeCloseTo(1.98, 10);
  });

  it("HOUSE_EDGE is 1%", () => {
    expect(HOUSE_EDGE).toBe(0.01);
  });

  it("maintains ~1% house edge across many samples at a fixed cash-out target", () => {
    // P(crash_point >= M) = (1 - edge) / M, so average payout per unit bet
    // when always cashing out at M should be ~ (1 - edge) regardless of M.
    const target = 2;
    const N = 200000;
    let wins = 0;
    for (let i = 0; i < N; i++) {
      const r = (i + 0.5) / N; // deterministic stratified sample of [0, 1)
      if (generateCrashPoint(() => r) >= target) wins++;
    }
    const avgPayout = (wins / N) * target;
    expect(avgPayout).toBeGreaterThan(0.95);
    expect(avgPayout).toBeLessThan(1.0);
  });
});

describe("multiplierAt", () => {
  it("is 1.00 at t=0", () => {
    expect(multiplierAt(0)).toBe(1);
  });

  it("matches e^(GROWTH_RATE * t)", () => {
    expect(multiplierAt(5)).toBeCloseTo(Math.exp(GROWTH_RATE * 5), 10);
  });
});

describe("resolveCashout", () => {
  const started = new Date("2026-01-01T00:00:00.000Z");
  function makeRound(crashPoint: number): CrashRoundState {
    return { bet: 100, startedAt: started.toISOString(), crashPoint, status: "active" };
  }

  it("wins when the current multiplier is still below the crash point", () => {
    const round = makeRound(5);
    const now = started.getTime() + 1000; // 1s elapsed -> mult = e^0.115 ~= 1.122
    const next = resolveCashout(round, now);
    expect(next.status).toBe("complete");
    expect(next.outcome).toBe("cashed_out");
    expect(next.payout).toBeCloseTo(100 * Math.exp(GROWTH_RATE * 1), 4);
    expect(next.cashedOutAt).toBeCloseTo(Math.exp(GROWTH_RATE * 1), 4);
  });

  it("busts when the current multiplier has reached or passed the crash point", () => {
    const round = makeRound(1.01); // crashes almost immediately
    const now = started.getTime() + 5000; // plenty of time to exceed 1.01
    const next = resolveCashout(round, now);
    expect(next.status).toBe("complete");
    expect(next.outcome).toBe("busted");
    expect(next.payout).toBe(0);
    expect(next.cashedOutAt).toBeUndefined();
  });

  it("throws if the round is already complete", () => {
    const round: CrashRoundState = { ...makeRound(2), status: "complete" };
    expect(() => resolveCashout(round, started.getTime())).toThrow("already complete");
  });
});

describe("sanitize", () => {
  const started = new Date("2026-01-01T00:00:00.000Z");

  it("hides crashPoint while active", () => {
    const state = startRound({ bet: 50, startedAt: started.toISOString(), rng: () => 0.5 });
    const view = sanitize(state, "round-1", 950);
    expect(view.crashPoint).toBeNull();
    expect(view.status).toBe("active");
  });

  it("reveals crashPoint once complete", () => {
    const state = resolveCashout(
      { bet: 50, startedAt: started.toISOString(), crashPoint: 1.01, status: "active" },
      started.getTime() + 5000
    );
    const view = sanitize(state, "round-1", 950);
    expect(view.crashPoint).toBe(1.01);
    expect(view.outcome).toBe("busted");
  });
});

describe("roundMoney", () => {
  it("rounds to 4 decimal places", () => {
    expect(roundMoney(1.00005)).toBe(1.0001);
    expect(roundMoney(1.00004)).toBe(1);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npm test -- supabase/functions/crash/engine.test.ts`
Expected: FAIL — `Cannot find module './engine'` (the file doesn't exist yet).

- [x] **Step 3: Write the implementation**

Create `supabase/functions/crash/engine.ts`:

```typescript
export type Rng = () => number;

export const HOUSE_EDGE = 0.01;
export const GROWTH_RATE = 0.115; // "Gentle" pacing, approved via live preview
export const MAX_CRASH_POINT = 100; // sanity cap on the rare extreme tail

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Standard crash-game formula: guarantees a fixed HOUSE_EDGE regardless of
// what multiplier a player targets. P(crash_point >= M) = (1 - HOUSE_EDGE) / M,
// so expected payout at any cash-out target M is bet * (1 - HOUSE_EDGE).
export function generateCrashPoint(rng: Rng): number {
  const r = rng();
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  const capped = Math.min(raw, MAX_CRASH_POINT);
  return Math.max(1, Math.floor(capped * 100) / 100);
}

// Public growth formula — same one the client mirrors for cosmetic
// rendering. t = seconds elapsed since the round started.
export function multiplierAt(elapsedSeconds: number): number {
  return Math.exp(GROWTH_RATE * elapsedSeconds);
}

export type CrashOutcome = "cashed_out" | "busted";

export interface CrashRoundState {
  bet: number;
  startedAt: string; // ISO timestamp
  crashPoint: number;
  status: "active" | "complete";
  outcome?: CrashOutcome;
  payout?: number;
  cashedOutAt?: number; // the multiplier at the moment of a winning cashout
}

export function startRound(opts: { bet: number; startedAt: string; rng: Rng }): CrashRoundState {
  return {
    bet: opts.bet,
    startedAt: opts.startedAt,
    crashPoint: generateCrashPoint(opts.rng),
    status: "active",
  };
}

export function resolveCashout(prev: CrashRoundState, now: number): CrashRoundState {
  if (prev.status !== "active") throw new Error("Round is already complete");

  const elapsed = (now - new Date(prev.startedAt).getTime()) / 1000;
  const current = multiplierAt(elapsed);

  if (current < prev.crashPoint) {
    return {
      ...prev,
      status: "complete",
      outcome: "cashed_out",
      cashedOutAt: roundMoney(current),
      payout: roundMoney(prev.bet * current),
    };
  }

  return {
    ...prev,
    status: "complete",
    outcome: "busted",
    payout: 0,
  };
}

export interface CrashSanitizedState {
  roundId: string;
  status: "active" | "complete";
  bet: number;
  startedAt: string;
  crashPoint: number | null; // only revealed once the round is complete
  outcome?: CrashOutcome;
  payout: number | null;
  cashedOutAt: number | null;
  balance: number;
}

export function sanitize(state: CrashRoundState, roundId: string, balance: number): CrashSanitizedState {
  return {
    roundId,
    status: state.status,
    bet: state.bet,
    startedAt: state.startedAt,
    crashPoint: state.status === "complete" ? state.crashPoint : null,
    outcome: state.outcome,
    payout: state.payout ?? null,
    cashedOutAt: state.cashedOutAt ?? null,
    balance,
  };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test -- supabase/functions/crash/engine.test.ts`
Expected: PASS (13 tests).

- [x] **Step 5: Commit**

```bash
git add supabase/functions/crash/engine.ts supabase/functions/crash/engine.test.ts
git commit -m "feat(crash): add crash engine with 1% house edge"
```

---

### Task 3: Crash edge function — HTTP handler

**Files:**
- Create: `supabase/functions/crash/index.ts`

- [x] **Step 1: Write the edge function**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startRound, resolveCashout, sanitize, roundMoney, type CrashRoundState } from "./engine.ts";

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
      const { casino_id, casino_game_id, bet } = body as {
        casino_id: string;
        casino_game_id: string;
        bet: number;
      };

      const [{ data: member }, { data: cg }] = await Promise.all([
        userClient
          .from("casino_members")
          .select("balance")
          .eq("casino_id", casino_id)
          .eq("user_id", user.id)
          .single(),
        admin
          .from("casino_games")
          .select("min_bet, max_bet")
          .eq("id", casino_game_id)
          .eq("casino_id", casino_id)
          .eq("game_type_id", "crash")
          .single(),
      ]);
      if (!member) return json({ error: "You are not a member of this casino" }, 403);
      if (!cg) return json({ error: "Game not found" }, 400);
      if (typeof bet !== "number" || !isFinite(bet) || bet <= 0) {
        return json({ error: "Invalid bet" }, 400);
      }
      const validBet = roundMoney(bet);
      if (validBet < Number(cg.min_bet) || validBet > Number(cg.max_bet)) {
        return json({ error: `Bet must be between ${cg.min_bet} and ${cg.max_bet}` }, 400);
      }
      if (validBet > member.balance) return json({ error: "Insufficient balance" }, 400);

      // One active round at a time — clean up any abandoned round first.
      await admin
        .from("crash_rounds")
        .delete()
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .neq("status", "complete");

      const state = startRound({ bet: validBet, startedAt: new Date().toISOString(), rng });
      const balance = roundMoney(member.balance - validBet);

      const [{ data: round }] = await Promise.all([
        admin
          .from("crash_rounds")
          .insert({ casino_id, user_id: user.id, state, status: state.status })
          .select("id")
          .single(),
        admin.from("casino_members").update({ balance }).eq("casino_id", casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id,
          user_id: user.id,
          amount: -validBet,
          balance_after: balance,
          game_type_id: "crash",
          description: "Crash bet placed",
        }),
      ]);

      return json(sanitize(state, round!.id, balance));
    }

    if (body.action === "cashout") {
      const { round_id } = body as { round_id: string };

      const { data: round } = await admin
        .from("crash_rounds")
        .select("*")
        .eq("id", round_id)
        .eq("user_id", user.id)
        .single();
      if (!round) return json({ error: "Round not found" }, 404);
      if (round.status === "complete") return json({ error: "Round already finished" }, 400);

      const prev = round.state as CrashRoundState;
      let next: CrashRoundState;
      try {
        next = resolveCashout(prev, Date.now());
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
          .from("crash_rounds")
          .update({ state: next, status: next.status, updated_at: new Date().toISOString() })
          .eq("id", round_id),
        admin.from("casino_members").update({ balance }).eq("casino_id", round.casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id: round.casino_id,
          user_id: user.id,
          amount: next.payout ?? 0,
          balance_after: balance,
          game_type_id: "crash",
          description: next.outcome === "busted" ? "Crash: busted" : "Crash: cashed out",
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

- [x] **Step 2: Deploy the edge function**

Use the Supabase MCP `deploy_edge_function` tool to deploy the `crash` function (both `engine.ts` and `index.ts`) to project `tvivhadsgtvfvxwpahef`. Local edits under `supabase/functions/` do not go live until this is called.

- [x] **Step 3: Verify it deployed**

Use the Supabase MCP `list_edge_functions` tool and confirm `crash` appears and its status is `ACTIVE`.

- [x] **Step 4: Commit**

```bash
git add supabase/functions/crash/index.ts
git commit -m "feat(crash): add crash edge function (start/cashout)"
```

---

### Task 4: Shared TypeScript type

**Files:**
- Modify: `src/types/index.ts`

- [x] **Step 1: Add the `CrashState` type**

Append to the end of `src/types/index.ts`:

```typescript
export type CrashOutcome = "cashed_out" | "busted";

export interface CrashState {
  roundId: string;
  status: "active" | "complete";
  bet: number;
  startedAt: string;
  crashPoint: number | null;
  outcome?: CrashOutcome;
  payout: number | null;
  cashedOutAt: number | null;
  balance: number;
}
```

- [x] **Step 2: Verify the project still type-checks**

Run: `npm run build`
Expected: builds successfully (this type isn't consumed anywhere yet, so it can't break anything, but confirms no syntax error was introduced).

- [x] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(crash): add CrashState type"
```

---

### Task 5: React hook — `useCrash`

**Files:**
- Create: `src/hooks/useCrash.ts`

- [x] **Step 1: Write the hook**

```typescript
import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { CrashState } from "../types";

export function useCrash(casinoId: string | undefined, gameId: string | undefined) {
  const [state, setState] = useState<CrashState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("crash", { body });
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
    setState(data as CrashState);
    return data as CrashState;
  }, []);

  const start = useCallback(
    (bet: number) => invoke({ action: "start", casino_id: casinoId, casino_game_id: gameId, bet }),
    [invoke, casinoId, gameId]
  );

  const cashOut = useCallback(() => {
    if (!state) throw new Error("No active round");
    return invoke({ action: "cashout", round_id: state.roundId });
  }, [invoke, state]);

  const reset = useCallback(() => setState(null), []);

  return { state, loading, error, start, cashOut, reset };
}
```

- [x] **Step 2: Verify the project type-checks**

Run: `npm run build`
Expected: builds successfully.

- [x] **Step 3: Commit**

```bash
git add src/hooks/useCrash.ts
git commit -m "feat(crash): add useCrash hook"
```

---

### Task 6: Game component — `Crash.tsx`

**Files:**
- Create: `src/components/games/Crash.tsx`

- [x] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { formatChips } from "../../lib/utils";
import { useCrash } from "../../hooks/useCrash";
import { playWinChime, playLoseThud } from "../../lib/sound";

// Mirrors supabase/functions/crash/engine.ts — cosmetic only, the server
// independently recomputes and is authoritative at cash-out time.
const GROWTH_RATE = 0.115;
// The rocket sprite reaches the top of its track around this multiplier and
// stays pinned there while the number keeps climbing beyond it (10x is
// already a rare outcome at 1% house edge).
const DISPLAY_CAP = 10;

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface Props {
  casinoId: string;
  gameId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

// Precomputed particle bursts (deterministic so every celebration/break looks
// intentional rather than random-jittery) — mirrors Dice's CASH_PARTICLES.
const CASH_PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const angle = (i - 4.5) * 16;
  return { angle, dist: 90 + (i % 3) * 45, delay: (i % 5) * 40, spin: i % 2 === 0 ? 240 : -240 };
});
const DEBRIS_PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const angle = (i - 4.5) * 16;
  return { angle, dist: 90 + (i % 3) * 45, delay: (i % 5) * 30, spin: i % 2 === 0 ? 180 : -180 };
});

export function Crash({ casinoId, gameId, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { state, loading, error: reqError, start, cashOut } = useCrash(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [liveMultiplier, setLiveMultiplier] = useState(1);

  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;

  const hasActiveRound = state?.status === "active";
  const isComplete = state?.status === "complete";

  // Live-render the public growth formula while a round is active. Purely
  // cosmetic — the server independently recomputes and is authoritative.
  useEffect(() => {
    if (!hasActiveRound || !state) {
      setLiveMultiplier(1);
      return;
    }
    const startedAt = new Date(state.startedAt).getTime();
    let frame: number;
    function tick() {
      const elapsed = (Date.now() - startedAt) / 1000;
      setLiveMultiplier(Math.exp(GROWTH_RATE * elapsed));
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hasActiveRound, state]);

  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  async function handleBet() {
    if (loading || hasActiveRound || !betValid) return;
    setFormError(null);
    try {
      const res = await start(bet);
      setLocalBalance(res.balance);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Bet failed");
    }
  }

  async function handleCashOut() {
    if (loading || !state || state.status !== "active") return;
    setFormError(null);
    try {
      const res = await cashOut();
      setLocalBalance(res.balance);
      if (res.outcome === "cashed_out") {
        playWinChime();
      } else {
        playLoseThud();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Cash out failed");
    }
  }

  const currentPayout = state ? roundMoney(state.bet * liveMultiplier) : 0;

  const displayMultiplier = hasActiveRound
    ? liveMultiplier
    : isComplete
    ? state!.outcome === "cashed_out"
      ? state!.cashedOutAt!
      : state!.crashPoint!
    : 1;

  const rocketPct = Math.min(1, Math.log(displayMultiplier) / Math.log(DISPLAY_CAP));
  const rocketVisible = !isComplete || state!.outcome === "cashed_out";

  return (
    <div
      className="relative bg-card overflow-hidden flex flex-col rounded-2xl"
      style={{ width: "min(98vw, 1300px)", height: "min(90vh, 760px)" }}
    >
      <CrashStyles />
      <div className="flex items-center justify-between px-4 py-2 sm:px-5 sm:py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Crash</p>
          <p className="text-xs text-muted-foreground">Balance: {formatChips(localBalance)} chips</p>
        </div>
        <div className="flex items-center gap-3">
          <BackdropToggleButton />
          <MuteButton />
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
            Exit
          </button>
        </div>
      </div>

      {isComplete && (
        <div
          className={`px-5 py-2 text-center font-bold text-white text-sm shrink-0 ${
            state!.outcome === "cashed_out" ? "bg-emerald-700" : "bg-red-900/80"
          }`}
        >
          {state!.outcome === "cashed_out"
            ? `Cashed out at ${state!.cashedOutAt!.toFixed(2)}x — it would have busted at ${state!.crashPoint!.toFixed(2)}x`
            : `Busted at ${state!.crashPoint!.toFixed(2)}x`}
        </div>
      )}

      {isComplete && state!.outcome === "cashed_out" && (
        <div
          key={`win-${state!.roundId}`}
          className="cx-win-overlay absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          {CASH_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="cx-cash"
              style={{
                "--cx-rot": `${p.angle}deg`,
                "--cx-dist": `-${p.dist}px`,
                "--cx-spin": `${p.spin}deg`,
                animationDelay: `${p.delay}ms`,
              } as CSSProperties}
            >
              💵
            </span>
          ))}
          <p className="cx-win-text text-3xl font-black text-emerald-400 drop-shadow-[0_2px_8px_rgba(16,185,129,0.6)]">
            +{formatChips(state!.payout ?? 0)} chips
          </p>
        </div>
      )}

      {isComplete && state!.outcome === "busted" && (
        <div
          key={`bust-${state!.roundId}`}
          className="cx-bust-overlay absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
        >
          {DEBRIS_PARTICLES.map((p, i) => (
            <span
              key={i}
              className="cx-debris"
              style={{
                "--cx-rot": `${p.angle}deg`,
                "--cx-dist": `-${p.dist}px`,
                "--cx-spin": `${p.spin}deg`,
                animationDelay: `${p.delay}ms`,
              } as CSSProperties}
            >
              💥
            </span>
          ))}
          <p className="cx-bust-text text-3xl font-black text-red-400 drop-shadow-[0_2px_8px_rgba(239,68,68,0.6)]">
            Busted at {state!.crashPoint!.toFixed(2)}x
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

          <Button
            onClick={hasActiveRound ? handleCashOut : handleBet}
            disabled={loading || (!hasActiveRound && !betValid)}
            className="mt-1 h-11 text-base font-bold"
          >
            {loading ? "…" : hasActiveRound ? `Cash Out ${formatChips(currentPayout)} chips` : "Bet"}
          </Button>

          {(formError || reqError) && <p className="text-xs text-destructive">{formError ?? reqError}</p>}
        </div>

        <div className="cx-scene relative flex flex-1 items-center justify-center min-w-0 overflow-hidden">
          <div className="cx-stars absolute inset-0" />
          <p className="cx-readout absolute top-4 right-5 font-mono font-black text-amber-400">
            {displayMultiplier.toFixed(2)}x
          </p>
          <div
            className="cx-rocket absolute left-1/2"
            style={{
              bottom: `${8 + rocketPct * 78}%`,
              transform: "translateX(-50%) rotate(-25deg)",
              opacity: rocketVisible ? 1 : 0,
            }}
          >
            <div className="cx-rocket-body" />
            <div className="cx-rocket-flame" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Scoped styles: starfield backdrop, rocket sprite, and win/bust feedback.
// Everything finishes within ~950ms; reduced-motion disables all of it.
function CrashStyles() {
  return (
    <style>{`
      .cx-scene {
        background: linear-gradient(180deg, #0a0e27 0%, #1a1040 60%, #2d1b4e 100%);
      }
      .cx-stars {
        background-image:
          radial-gradient(2px 2px at 20% 30%, white, transparent),
          radial-gradient(2px 2px at 60% 15%, white, transparent),
          radial-gradient(1px 1px at 80% 40%, white, transparent),
          radial-gradient(1px 1px at 30% 70%, white, transparent),
          radial-gradient(2px 2px at 90% 80%, white, transparent),
          radial-gradient(1px 1px at 45% 85%, white, transparent);
        opacity: 0.6;
      }
      .cx-readout {
        font-size: clamp(28px, 3.4vw, 52px);
        text-shadow: 0 0 12px rgba(251, 191, 36, 0.6);
      }
      .cx-rocket {
        width: clamp(28px, 3vw, 44px);
        height: clamp(46px, 5vw, 74px);
        transition: bottom 80ms linear, opacity 300ms ease-out;
      }
      .cx-rocket-body {
        width: 100%;
        height: 100%;
        background: linear-gradient(180deg, #e2e8f0, #94a3b8);
        border-radius: 50% 50% 20% 20%;
      }
      .cx-rocket-flame {
        position: absolute;
        bottom: -18px;
        left: 50%;
        transform: translateX(-50%);
        width: 40%;
        height: 24px;
        background: linear-gradient(180deg, #fb923c, #ef4444, #fbbf24);
        border-radius: 0 0 50% 50%;
        filter: blur(1px);
        animation: cxFlameFlicker 200ms ease-in-out infinite alternate;
      }
      @keyframes cxFlameFlicker {
        0%   { transform: translateX(-50%) scaleY(1); }
        100% { transform: translateX(-50%) scaleY(0.8); }
      }

      .cx-win-overlay, .cx-bust-overlay {
        animation: cxOverlayFade 950ms ease-out both;
      }
      @keyframes cxOverlayFade {
        0%, 70% { opacity: 1; }
        100%    { opacity: 0; }
      }

      .cx-win-text, .cx-bust-text {
        animation: cxTextPop 950ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      @keyframes cxTextPop {
        0%   { opacity: 0; transform: scale(0.5) translateY(16px); }
        25%  { opacity: 1; transform: scale(1.12) translateY(0); }
        40%  { transform: scale(1); }
        100% { opacity: 1; transform: scale(1); }
      }

      .cx-cash, .cx-debris {
        position: absolute;
        top: 50%; left: 50%;
        font-size: 22px;
        line-height: 1;
        animation: cxParticleFly 800ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      }
      @keyframes cxParticleFly {
        0% {
          opacity: 1;
          transform: translate(-50%, -50%) rotate(var(--cx-rot)) translateY(0) rotate(0deg) scale(0.6);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) rotate(var(--cx-rot)) translateY(var(--cx-dist)) rotate(var(--cx-spin)) scale(1.1);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cx-cash, .cx-debris, .cx-rocket-flame { display: none; animation: none; }
        .cx-win-overlay, .cx-bust-overlay, .cx-win-text, .cx-bust-text { animation: none; }
        .cx-win-overlay, .cx-bust-overlay { opacity: 0; }
        .cx-rocket { transition: none; }
      }
    `}</style>
  );
}
```

- [x] **Step 2: Verify the project type-checks and builds**

Run: `npm run build`
Expected: builds successfully (the component isn't wired into any page yet, so this only confirms it compiles in isolation).

- [x] **Step 3: Commit**

```bash
git add src/components/games/Crash.tsx
git commit -m "feat(crash): add Crash game component"
```

---

### Task 7: Wire into `CasinoDashboard`

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx`

- [x] **Step 1: Add the import**

Find this block (around line 20-21):

```tsx
import { Mines } from "../components/games/Mines";
import { Slots } from "../components/games/Slots";
```

Change it to:

```tsx
import { Mines } from "../components/games/Mines";
import { Crash } from "../components/games/Crash";
import { Slots } from "../components/games/Slots";
```

- [x] **Step 2: Register the game type as playable and managed**

Find (around line 36-37):

```tsx
const PLAYABLE_GAME_IDS = new Set(["blackjack", "roulette", "dice", "mines", "slots", "plinko"]);
const MANAGED_GAME_IDS = ["blackjack", "slots", "roulette", "dice", "mines", "plinko"];
```

Change it to:

```tsx
const PLAYABLE_GAME_IDS = new Set(["blackjack", "roulette", "dice", "mines", "slots", "plinko", "crash"]);
const MANAGED_GAME_IDS = ["blackjack", "slots", "roulette", "dice", "mines", "plinko", "crash"];
```

- [x] **Step 3: Add the render branch**

Find the `mines` branch inside the game modal switch (around line 395-404):

```tsx
          {activeGame.game_type_id === "mines" && (
            <Mines
              casinoId={currentCasino.id}
              gameId={activeGame.id}
              balance={membership?.balance ?? 0}
              minBet={activeGame.min_bet}
              maxBet={activeGame.max_bet}
              onExit={() => setActiveGame(null)}
            />
          )}
```

Add this immediately after it:

```tsx
          {activeGame.game_type_id === "crash" && (
            <Crash
              casinoId={currentCasino.id}
              gameId={activeGame.id}
              balance={membership?.balance ?? 0}
              minBet={activeGame.min_bet}
              maxBet={activeGame.max_bet}
              onExit={() => setActiveGame(null)}
            />
          )}
```

- [x] **Step 4: Verify the project builds**

Run: `npm run build`
Expected: builds successfully.

- [x] **Step 5: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "feat(crash): wire Crash into CasinoDashboard"
```

---

### Task 8: Manual verification

**No files** — this task drives the running app to confirm the feature actually works end-to-end, per this project's rule that UI changes must be verified in a browser, not just type-checked.

- [x] **Step 1: Start the dev server**

Run: `npm run dev` (leave running; it serves on `http://localhost:5173`)

- [x] **Step 2: Sign in as the test account**

Using Playwright (or claude-in-chrome), navigate to `http://localhost:5173`, sign in with `claudetest.cassie@gmail.com` / `ClaudeTest123!` (per CLAUDE.md — this account is admin in all casinos).

- [x] **Step 3: Enable the Crash game in a casino**

Open any casino's admin "Games" settings tab, add a new game instance choosing **Crash** from the game type dropdown (it's now in `MANAGED_GAME_IDS`), accept the default min/max bet, and create it.

- [x] **Step 4: Play a winning round**

From the casino dashboard, open the new Crash tile. Confirm: the modal opens at a large size, balance shows in the header, the "Bet Amount" field defaults to the game's min bet. Click **Bet**. Confirm: balance decreases immediately by the bet amount, the rocket starts climbing, the multiplier readout ticks up continuously. After a couple of seconds, click **Cash Out**. Confirm: balance increases by the payout shown, a green banner reads "Cashed out at X.XXx — it would have busted at Y.YYx", and the cash-particle celebration plays once.

- [x] **Step 5: Play a losing round**

Click **Bet** again. This time, wait without clicking Cash Out — at `GROWTH_RATE = 0.115`, by ~30 seconds the multiplier has climbed to roughly 31x, and `P(crash_point >= 31x) = (1 - HOUSE_EDGE) / 31 ≈ 3%`, so waiting that long makes it about 97% likely the round has already secretly busted. Then click **Cash Out** anyway. Confirm: balance does **not** increase (bet stays deducted), a red banner reads "Busted at Z.ZZx", and the debris-burst animation plays once. (On the rare chance it hasn't busted yet, just wait a little longer and click Cash Out again.)

- [x] **Step 6: Sanity-check responsive sizing**

Resize the browser (or use Playwright's viewport resize) to roughly 375px wide, then to roughly 1920px wide, reopening the Crash modal at each size. Confirm: the modal and rocket scene visibly grow at the larger size rather than sitting small with empty space, and nothing overflows or clips at the smaller size.

- [x] **Step 7: Report results**

Summarize pass/fail for each of steps 4-6. If anything fails, fix the underlying code (not this test task) and re-run the relevant step before considering Task 8 done.
