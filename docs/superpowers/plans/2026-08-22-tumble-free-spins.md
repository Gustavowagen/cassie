# Tumble Free Spins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Tumble player buy a prepaid batch of free spins at a stake they choose (within an admin-configured range), which then auto-play back-to-back with no further payment.

**Architecture:** No new database table. A purchase resolves entirely in one atomic edge-function request — `spinsPerPurchase` rounds are computed server-side with the existing `playRound`/`payoutFor` engine functions (identical odds/house edge to a manual spin), cost and total payout are netted into one balance update, and the client replays each round's cascade animation in sequence, crediting that round's own payout to local balance only once its own animation finishes.

**Tech Stack:** TypeScript, React, Supabase Edge Functions (Deno), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-tumble-free-spins-design.md`

## Global Constraints

- Buying `N` spins at stake `S` costs exactly `N × S` — no premium multiplier. Every round in the batch uses the same `houseEdge` as a manual spin.
- Free-spin min bet floor is always 1, regardless of the instance's regular `min_bet`. Max bet is capped at 10,000,000 (same `MAX_BET_CEILING` the regular bet fields already use).
- `spinsPerPurchase` is an integer in [1, 50]. Default 10.
- The whole batch auto-plays with no per-round manual step, no skip/stop-mid-batch control.
- Settings default to `{ enabled: false, minBet: 1, maxBet: max(1, regularMaxBet), spinsPerPurchase: 10 }` when missing/invalid — resolved authoritatively server-side, never trusted from the client (same rule `resolveHouseEdge` already follows).
- Frontend balance rule (CLAUDE.md item 6, extended to a batch): a round's payout must never reach local balance before that round's own cascade animation has finished — no spoilers, per spin, not just per batch.

---

### Task 1: Types

**Files:**
- Modify: `src/types/index.ts:246-265`

**Interfaces:**
- Produces: `TumbleFreeSpinsSettings { enabled: boolean; minBet: number; maxBet: number; spinsPerPurchase: number }`, `TumbleInstanceSettings.freeSpins?: TumbleFreeSpinsSettings`, `TumbleFreeSpinsResult { rounds: TumbleRound[]; bet: number; cost: number; payout: number; balance: number }` — every later task imports these from `src/types`.

- [ ] **Step 1: Add the new types**

Replace this block:

```ts
export interface TumbleResult {
  round: TumbleRound;
  bet: number;
  payout: number;
  balance: number;
}

// Shape of CasinoGame.settings for a tumble instance. Board size and reward
// mode are fixed by the game, so unlike slots there is nothing to configure
// but the edge and the skin.
export interface TumbleInstanceSettings {
  // Fixed menu of 1%-5% in 1% steps — note there is no 0% option, unlike
  // slots. Missing/off-menu defaults to 0.03, both here and server-side in
  // supabase/functions/tumble/engine.ts (HOUSE_EDGE_OPTIONS /
  // DEFAULT_HOUSE_EDGE), which is the authoritative gate.
  houseEdge?: 0.01 | 0.02 | 0.03 | 0.04 | 0.05;
  // Visual design id from src/lib/slotsDesigns.ts, shared with slots.
  // Missing defaults to DEFAULT_SLOTS_DESIGN_ID. Never affects odds.
  design?: string;
}
```

with:

```ts
export interface TumbleResult {
  round: TumbleRound;
  bet: number;
  payout: number;
  balance: number;
}

// A purchasable batch of pre-paid spins at a chosen stake. Buying N spins at
// stake S costs exactly N x S -- same odds/house edge as a manual spin, just
// prepaid and auto-played. Mirrors supabase/functions/tumble/engine.ts's
// resolveFreeSpinsSettings, which is the authoritative source of these
// values (this type describes the shape only).
export interface TumbleFreeSpinsSettings {
  enabled: boolean;
  // Floor is always 1, never lower, regardless of the instance's regular
  // min_bet -- enforced both in GameSettingsModal.tsx and server-side.
  minBet: number;
  // >= minBet, capped at GameSettingsModal.tsx's MAX_BET_CEILING.
  maxBet: number;
  // Integer, 1-50.
  spinsPerPurchase: number;
}

// Shape of CasinoGame.settings for a tumble instance. Board size and reward
// mode are fixed by the game, so unlike slots there is nothing to configure
// but the edge, the skin, and (optionally) free spins.
export interface TumbleInstanceSettings {
  // Fixed menu of 1%-5% in 1% steps — note there is no 0% option, unlike
  // slots. Missing/off-menu defaults to 0.03, both here and server-side in
  // supabase/functions/tumble/engine.ts (HOUSE_EDGE_OPTIONS /
  // DEFAULT_HOUSE_EDGE), which is the authoritative gate.
  houseEdge?: 0.01 | 0.02 | 0.03 | 0.04 | 0.05;
  // Visual design id from src/lib/slotsDesigns.ts, shared with slots.
  // Missing defaults to DEFAULT_SLOTS_DESIGN_ID. Never affects odds.
  design?: string;
  // Missing/invalid defaults to { enabled: false, minBet: 1, maxBet: ...,
  // spinsPerPurchase: 10 }, resolved authoritatively server-side by
  // resolveFreeSpinsSettings in supabase/functions/tumble/engine.ts.
  freeSpins?: TumbleFreeSpinsSettings;
}

// Mirror of the edge function's buy_free_spins response.
export interface TumbleFreeSpinsResult {
  rounds: TumbleRound[];
  // The per-spin stake the player chose.
  bet: number;
  // spinsPerPurchase * bet.
  cost: number;
  // Summed payout across every round in the batch.
  payout: number;
  // Authoritative final balance after cost and payout are both applied.
  balance: number;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS (no consumers yet, so nothing else changes)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(tumble): add free-spins settings and result types"
```

---

### Task 2: Server — settings resolution, purchase action, deploy

**Files:**
- Modify: `supabase/functions/tumble/engine.ts` (append near the bottom)
- Modify: `supabase/functions/tumble/engine.test.ts` (append near the bottom)
- Modify: `supabase/functions/tumble/index.ts` (full rewrite of the dispatch + new action)

**Interfaces:**
- Consumes: `playRound(rng, houseEdge?) => TumbleRound`, `payoutFor(round, bet) => number`, `roundMoney(n) => number` (all already in `engine.ts`).
- Produces: `resolveFreeSpinsSettings(settings: unknown, regularMaxBet: number) => { enabled: boolean; minBet: number; maxBet: number; spinsPerPurchase: number }` (exported from `engine.ts`) — consumed by `index.ts`'s new `buy_free_spins` handler. Edge function now accepts `{ action?: "spin" | "buy_free_spins", casino_id, casino_game_id, bet }`; `buy_free_spins` responds with `{ rounds, bet, cost, payout, balance }` matching `TumbleFreeSpinsResult`.

- [ ] **Step 1: Write the failing tests for `resolveFreeSpinsSettings`**

Two edits to `supabase/functions/tumble/engine.test.ts`: add `resolveFreeSpinsSettings` to the existing import, and append a new `describe` block at the end of the file (after the final `describe("BASELINE_RTP", ...)` block).

Find:

```ts
import {
  ROWS,
  COLS,
  CELLS,
  SYMBOLS,
  X_WEIGHT,
  X_VALUES,
  BASELINE_RTP,
  HOUSE_EDGE_OPTIONS,
  MIN_HOUSE_EDGE,
  MAX_HOUSE_EDGE,
  DEFAULT_HOUSE_EDGE,
  edgeScale,
  tierIndex,
  countSymbols,
  xValueOnBoard,
  evaluateBoard,
  tumble,
  spinBoard,
  playRound,
  payoutFor,
  pickSymbol,
  pickCell,
  type Board,
  type SymbolId,
} from "./engine";
```

Replace with:

```ts
import {
  ROWS,
  COLS,
  CELLS,
  SYMBOLS,
  X_WEIGHT,
  X_VALUES,
  BASELINE_RTP,
  HOUSE_EDGE_OPTIONS,
  MIN_HOUSE_EDGE,
  MAX_HOUSE_EDGE,
  DEFAULT_HOUSE_EDGE,
  edgeScale,
  tierIndex,
  countSymbols,
  xValueOnBoard,
  evaluateBoard,
  tumble,
  spinBoard,
  playRound,
  payoutFor,
  pickSymbol,
  pickCell,
  resolveFreeSpinsSettings,
  type Board,
  type SymbolId,
} from "./engine";
```

Append this block at the end of the file:

```ts
describe("resolveFreeSpinsSettings", () => {
  it("defaults to disabled with a floor of 1 and 10 spins when settings is missing", () => {
    const resolved = resolveFreeSpinsSettings(undefined, 500);
    expect(resolved).toEqual({ enabled: false, minBet: 1, maxBet: 500, spinsPerPurchase: 10 });
  });

  it("defaults maxBet to at least 1 when the instance's regular max bet is below 1", () => {
    const resolved = resolveFreeSpinsSettings(undefined, 0.5);
    expect(resolved.maxBet).toBe(1);
  });

  it("defaults to disabled when freeSpins.enabled is not exactly true", () => {
    expect(resolveFreeSpinsSettings({ freeSpins: {} }, 500).enabled).toBe(false);
    expect(resolveFreeSpinsSettings({ freeSpins: { enabled: "yes" } }, 500).enabled).toBe(false);
  });

  it("passes through valid enabled settings unchanged", () => {
    const resolved = resolveFreeSpinsSettings(
      { freeSpins: { enabled: true, minBet: 2, maxBet: 20, spinsPerPurchase: 25 } },
      500
    );
    expect(resolved).toEqual({ enabled: true, minBet: 2, maxBet: 20, spinsPerPurchase: 25 });
  });

  it("clamps minBet up to the floor of 1", () => {
    const resolved = resolveFreeSpinsSettings(
      { freeSpins: { enabled: true, minBet: 0, maxBet: 20, spinsPerPurchase: 10 } },
      500
    );
    expect(resolved.minBet).toBe(1);
  });

  it("clamps maxBet up to at least minBet", () => {
    const resolved = resolveFreeSpinsSettings(
      { freeSpins: { enabled: true, minBet: 10, maxBet: 5, spinsPerPurchase: 10 } },
      500
    );
    expect(resolved.maxBet).toBe(10);
  });

  it("clamps maxBet down to the 10,000,000 ceiling", () => {
    const resolved = resolveFreeSpinsSettings(
      { freeSpins: { enabled: true, minBet: 1, maxBet: 50_000_000, spinsPerPurchase: 10 } },
      500
    );
    expect(resolved.maxBet).toBe(10_000_000);
  });

  it("clamps spinsPerPurchase into [1, 50] and falls back to 10 when non-integer", () => {
    expect(
      resolveFreeSpinsSettings({ freeSpins: { enabled: true, minBet: 1, maxBet: 20, spinsPerPurchase: 0 } }, 500)
        .spinsPerPurchase
    ).toBe(1);
    expect(
      resolveFreeSpinsSettings({ freeSpins: { enabled: true, minBet: 1, maxBet: 20, spinsPerPurchase: 999 } }, 500)
        .spinsPerPurchase
    ).toBe(50);
    expect(
      resolveFreeSpinsSettings({ freeSpins: { enabled: true, minBet: 1, maxBet: 20, spinsPerPurchase: 3.5 } }, 500)
        .spinsPerPurchase
    ).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- supabase/functions/tumble/engine.test.ts` (there's an `engine.test.ts` per game type, so the full path keeps this scoped to tumble's)
Expected: FAIL — `resolveFreeSpinsSettings is not a function` (or similar), since it doesn't exist in `engine.ts` yet.

- [ ] **Step 3: Implement `resolveFreeSpinsSettings` in `engine.ts`**

Append to the end of `supabase/functions/tumble/engine.ts` (after `payoutFor`):

```ts
// Bounds for the free-spins settings menu — enforced here, never trusted
// from the client (same rule as HOUSE_EDGE_OPTIONS above).
export const FREE_SPINS_MIN_BET_FLOOR = 1;
export const FREE_SPINS_MAX_BET_CEILING = 10_000_000;
export const FREE_SPINS_SPINS_MIN = 1;
export const FREE_SPINS_SPINS_MAX = 50;
export const DEFAULT_FREE_SPINS_COUNT = 10;

// Missing/invalid settings default to a disabled feature. Even when
// enabled, every field is clamped into range rather than trusted — the
// admin UI (GameSettingsModal.tsx) is not the authority, same rule
// index.ts's resolveHouseEdge follows for the house edge menu. Pure and
// dependency-free (no Deno/Supabase imports) so it's directly testable here,
// unlike resolveHouseEdge which stays in index.ts.
export function resolveFreeSpinsSettings(
  settings: unknown,
  regularMaxBet: number
): { enabled: boolean; minBet: number; maxBet: number; spinsPerPurchase: number } {
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).freeSpins : undefined;
  const fs = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;

  const defaultMaxBet = Math.max(FREE_SPINS_MIN_BET_FLOOR, regularMaxBet);
  if (!fs || fs.enabled !== true) {
    return {
      enabled: false,
      minBet: FREE_SPINS_MIN_BET_FLOOR,
      maxBet: defaultMaxBet,
      spinsPerPurchase: DEFAULT_FREE_SPINS_COUNT,
    };
  }

  let minBet = typeof fs.minBet === "number" && isFinite(fs.minBet) ? fs.minBet : FREE_SPINS_MIN_BET_FLOOR;
  minBet = Math.min(Math.max(minBet, FREE_SPINS_MIN_BET_FLOOR), FREE_SPINS_MAX_BET_CEILING);

  let maxBet = typeof fs.maxBet === "number" && isFinite(fs.maxBet) ? fs.maxBet : defaultMaxBet;
  maxBet = Math.min(Math.max(maxBet, minBet), FREE_SPINS_MAX_BET_CEILING);

  let spinsPerPurchase =
    typeof fs.spinsPerPurchase === "number" && Number.isInteger(fs.spinsPerPurchase)
      ? fs.spinsPerPurchase
      : DEFAULT_FREE_SPINS_COUNT;
  spinsPerPurchase = Math.min(Math.max(spinsPerPurchase, FREE_SPINS_SPINS_MIN), FREE_SPINS_SPINS_MAX);

  return { enabled: true, minBet, maxBet, spinsPerPurchase };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- supabase/functions/tumble/engine.test.ts`
Expected: PASS, all `resolveFreeSpinsSettings` cases plus every pre-existing test in the file.

- [ ] **Step 5: Add the `buy_free_spins` action to the edge function**

Replace the full contents of `supabase/functions/tumble/index.ts` with:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  playRound,
  payoutFor,
  roundMoney,
  resolveFreeSpinsSettings,
  HOUSE_EDGE_OPTIONS,
  DEFAULT_HOUSE_EDGE,
  type TumbleRound,
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

// Missing/off-menu settings fall back to DEFAULT_HOUSE_EDGE — which is what
// every freshly enabled casino_games row (settings = '{}') gets. This is also
// the authoritative gate on the 1-5% menu: even if the admin UI's dropdown
// were bypassed, an out-of-range edge is coerced rather than trusted. Float
// tolerant because `raw` round-trips through JSON.
function resolveHouseEdge(settings: unknown): number {
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).houseEdge : undefined;
  if (typeof raw === "number" && HOUSE_EDGE_OPTIONS.some((o) => Math.abs(o - raw) < 1e-9)) {
    return raw;
  }
  return DEFAULT_HOUSE_EDGE;
}

function describeRound(round: TumbleRound): string {
  if (round.steps.length === 0) return "Tumble: no win";
  const symbols = round.steps
    .flatMap((s) => s.wins)
    .map((w) => `${w.count}x ${w.symbol}`)
    .join("+");
  const tumbles = round.steps.length > 1 ? `, ${round.steps.length} tumbles` : "";
  const mult = round.multiplier > 1 ? `, x${round.multiplier}` : "";
  return `Tumble: ${symbols}${tumbles}${mult}`;
}

function describeFreeSpins(spins: number, bet: number, payout: number): string {
  return `Tumble free spins: ${spins} x ${bet} chips, total payout ${payout}`;
}

async function handleSpin(
  body: unknown,
  userId: string,
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>
): Promise<Response> {
  const { casino_id, casino_game_id, bet } = body as {
    casino_id: string;
    casino_game_id: string;
    bet: number;
  };

  // Membership/balance and bet limits don't depend on each other.
  const [{ data: member }, { data: cg }] = await Promise.all([
    userClient.from("casino_members").select("balance").eq("casino_id", casino_id).eq("user_id", userId).single(),
    admin
      .from("casino_games")
      .select("min_bet, max_bet, settings")
      .eq("id", casino_game_id)
      .eq("casino_id", casino_id)
      .eq("game_type_id", "tumble")
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

  const houseEdge = resolveHouseEdge(cg.settings);
  // The whole cascade resolves here, so bet and payout settle in one atomic
  // update — the client only replays the returned steps.
  const round = playRound(rng, houseEdge);
  const payout = payoutFor(round, validBet);
  const net = roundMoney(payout - validBet);
  const balance = roundMoney(member.balance + net);

  await Promise.all([
    admin.from("casino_members").update({ balance }).eq("casino_id", casino_id).eq("user_id", userId),
    admin.from("transactions").insert({
      casino_id,
      user_id: userId,
      amount: net,
      balance_after: balance,
      game_type_id: "tumble",
      description: describeRound(round),
    }),
  ]);

  return json({ round, bet: validBet, payout, balance });
}

async function handleBuyFreeSpins(
  body: unknown,
  userId: string,
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>
): Promise<Response> {
  const { casino_id, casino_game_id, bet } = body as {
    casino_id: string;
    casino_game_id: string;
    bet: number;
  };

  const [{ data: member }, { data: cg }] = await Promise.all([
    userClient.from("casino_members").select("balance").eq("casino_id", casino_id).eq("user_id", userId).single(),
    admin
      .from("casino_games")
      .select("min_bet, max_bet, settings")
      .eq("id", casino_game_id)
      .eq("casino_id", casino_id)
      .eq("game_type_id", "tumble")
      .single(),
  ]);
  if (!member) return json({ error: "You are not a member of this casino" }, 403);
  if (!cg) return json({ error: "Game not found" }, 400);

  const freeSpins = resolveFreeSpinsSettings(cg.settings, Number(cg.max_bet));
  if (!freeSpins.enabled) {
    return json({ error: "Free spins are not enabled for this game" }, 400);
  }
  if (typeof bet !== "number" || !isFinite(bet) || bet <= 0) {
    return json({ error: "Invalid bet" }, 400);
  }
  const validBet = roundMoney(bet);
  if (validBet < freeSpins.minBet || validBet > freeSpins.maxBet) {
    return json({ error: `Free spins bet must be between ${freeSpins.minBet} and ${freeSpins.maxBet}` }, 400);
  }
  const cost = roundMoney(freeSpins.spinsPerPurchase * validBet);
  if (cost > member.balance) return json({ error: "Insufficient balance" }, 400);

  const houseEdge = resolveHouseEdge(cg.settings);
  // Every round resolves here, all at once — spinsPerPurchase is capped at
  // 50 (see resolveFreeSpinsSettings), so this is cheap even at MAX_TUMBLES
  // worst case per round.
  const rounds: TumbleRound[] = [];
  for (let i = 0; i < freeSpins.spinsPerPurchase; i++) {
    rounds.push(playRound(rng, houseEdge));
  }
  const payout = roundMoney(rounds.reduce((sum, r) => sum + payoutFor(r, validBet), 0));
  const net = roundMoney(payout - cost);
  const balance = roundMoney(member.balance + net);

  await Promise.all([
    admin.from("casino_members").update({ balance }).eq("casino_id", casino_id).eq("user_id", userId),
    admin.from("transactions").insert({
      casino_id,
      user_id: userId,
      amount: net,
      balance_after: balance,
      game_type_id: "tumble",
      description: describeFreeSpins(rounds.length, validBet, payout),
    }),
  ]);

  return json({ rounds, bet: validBet, cost, payout, balance });
}

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
    const action = (body as { action?: string }).action ?? "spin";

    if (action === "buy_free_spins") {
      return await handleBuyFreeSpins(body, user.id, userClient, admin);
    }
    return await handleSpin(body, user.id, userClient, admin);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 6: Deploy the edge function**

Use the `mcp__claude_ai_Supabase__deploy_edge_function` tool (project id `tvivhadsgtvfvxwpahef`) to deploy the `tumble` function, including both `supabase/functions/tumble/index.ts` (entry point) and `supabase/functions/tumble/engine.ts` (imported module). Confirm the deploy reports success.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/tumble/engine.ts supabase/functions/tumble/engine.test.ts supabase/functions/tumble/index.ts
git commit -m "feat(tumble): add buy_free_spins edge function action"
```

---

### Task 3: Hook — `buyFreeSpins`

**Files:**
- Modify: `src/hooks/useTumble.ts` (full rewrite)

**Interfaces:**
- Consumes: `TumbleFreeSpinsResult` (Task 1).
- Produces: `useTumble(casinoId, gameId) => { result, loading, error, spin, buyFreeSpins }` where `buyFreeSpins(bet: number) => Promise<TumbleFreeSpinsResult>` — consumed by `Tumble.tsx` in Task 6.

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/hooks/useTumble.ts` with:

```ts
import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { TumbleResult, TumbleFreeSpinsResult } from "../types";

// supabase-js returns non-2xx as FunctionsHttpError; the JSON { error } body
// lives on error.context (a Response), not on `data`. When the request never
// reached the function (network failure) there's no context to parse, so
// fall back to a message a player can act on instead of the raw SDK error
// text. Shared by spin and buyFreeSpins below, which both call the same
// edge function and hit the same failure shapes.
async function parseFunctionError(error: unknown): Promise<string> {
  let message = "Failed to place bet, please try again";
  const ctx = (error as unknown as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const parsed = await ctx.json();
      if (parsed?.error) message = parsed.error as string;
    } catch {
      /* keep the fallback message */
    }
  }
  return message;
}

export function useTumble(casinoId: string | undefined, gameId: string | undefined) {
  const [result, setResult] = useState<TumbleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spin = useCallback(
    async (bet: number) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("tumble", {
        body: { casino_id: casinoId, casino_game_id: gameId, bet },
      });
      setLoading(false);
      if (error) {
        const message = await parseFunctionError(error);
        setError(message);
        throw new Error(message);
      }
      setResult(data as TumbleResult);
      return data as TumbleResult;
    },
    [casinoId, gameId]
  );

  const buyFreeSpins = useCallback(
    async (bet: number) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("tumble", {
        body: { action: "buy_free_spins", casino_id: casinoId, casino_game_id: gameId, bet },
      });
      setLoading(false);
      if (error) {
        const message = await parseFunctionError(error);
        setError(message);
        throw new Error(message);
      }
      return data as TumbleFreeSpinsResult;
    },
    [casinoId, gameId]
  );

  return { result, loading, error, spin, buyFreeSpins };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTumble.ts
git commit -m "feat(tumble): add buyFreeSpins to useTumble hook"
```

---

### Task 4: Admin settings UI — Free Spins section

**Files:**
- Modify: `src/components/GameSettingsModal.tsx`

**Interfaces:**
- Produces: on save, `settings.freeSpins = { enabled, minBet, maxBet, spinsPerPurchase }` is included in the object passed to `onSave` for a tumble instance — this is what Task 2's `resolveFreeSpinsSettings` (already deployed) reads.

- [ ] **Step 1: Add free-spins constants**

Find this block near the top of the file:

```ts
const MIN_BET_FLOOR = 0.01;
const MAX_BET_CEILING = 10_000_000;
```

Replace with:

```ts
const MIN_BET_FLOOR = 0.01;
const MAX_BET_CEILING = 10_000_000;

// Mirrors supabase/functions/tumble/engine.ts's FREE_SPINS_* constants —
// this UI is not the authority, the edge function re-clamps everything.
const FREE_SPINS_MIN_BET_FLOOR = 1;
const FREE_SPINS_MAX_BET_CEILING = MAX_BET_CEILING;
const FREE_SPINS_SPINS_MIN = 1;
const FREE_SPINS_SPINS_MAX = 50;
const DEFAULT_FREE_SPINS_COUNT = 10;
```

- [ ] **Step 2: Add free-spins state**

Find this block:

```ts
  const [design, setDesign] = useState<string>(
    typeof initialSettings.design === "string" ? initialSettings.design : DEFAULT_SLOTS_DESIGN_ID
  );
  const [view, setView] = useState<"settings" | "design">("settings");
```

Replace with:

```ts
  const [design, setDesign] = useState<string>(
    typeof initialSettings.design === "string" ? initialSettings.design : DEFAULT_SLOTS_DESIGN_ID
  );
  const initialFreeSpins =
    initialSettings.freeSpins && typeof initialSettings.freeSpins === "object"
      ? (initialSettings.freeSpins as Partial<{
          enabled: boolean;
          minBet: number;
          maxBet: number;
          spinsPerPurchase: number;
        }>)
      : undefined;
  const [freeSpinsEnabled, setFreeSpinsEnabled] = useState(initialFreeSpins?.enabled === true);
  const [freeSpinsMinBetText, setFreeSpinsMinBetText] = useState(
    String(initialFreeSpins?.minBet ?? FREE_SPINS_MIN_BET_FLOOR)
  );
  const [freeSpinsMaxBetText, setFreeSpinsMaxBetText] = useState(
    String(initialFreeSpins?.maxBet ?? initialMaxBet)
  );
  const [freeSpinsCountText, setFreeSpinsCountText] = useState(
    String(initialFreeSpins?.spinsPerPurchase ?? DEFAULT_FREE_SPINS_COUNT)
  );
  const [view, setView] = useState<"settings" | "design">("settings");
```

- [ ] **Step 3: Add free-spins validation and wire it into `canSave`**

Find:

```ts
  const trimmed = name.trim();
  const minBet = parseFloat(minBetText);
  const maxBet = parseFloat(maxBetText);
  const betRangeValid =
    isFinite(minBet) &&
    minBet >= MIN_BET_FLOOR &&
    isFinite(maxBet) &&
    maxBet <= MAX_BET_CEILING &&
    maxBet >= minBet;
  const canSave = trimmed && betRangeValid;
```

Replace with:

```ts
  const trimmed = name.trim();
  const minBet = parseFloat(minBetText);
  const maxBet = parseFloat(maxBetText);
  const betRangeValid =
    isFinite(minBet) &&
    minBet >= MIN_BET_FLOOR &&
    isFinite(maxBet) &&
    maxBet <= MAX_BET_CEILING &&
    maxBet >= minBet;
  const freeSpinsMinBet = parseFloat(freeSpinsMinBetText);
  const freeSpinsMaxBet = parseFloat(freeSpinsMaxBetText);
  const freeSpinsCount = parseInt(freeSpinsCountText, 10);
  // Only blocks Save while the toggle is on — a disabled section can't
  // block Save, so its numbers (however malformed) never gate the form.
  const freeSpinsValid =
    !freeSpinsEnabled ||
    (isFinite(freeSpinsMinBet) &&
      freeSpinsMinBet >= FREE_SPINS_MIN_BET_FLOOR &&
      isFinite(freeSpinsMaxBet) &&
      freeSpinsMaxBet <= FREE_SPINS_MAX_BET_CEILING &&
      freeSpinsMaxBet >= freeSpinsMinBet &&
      Number.isInteger(freeSpinsCount) &&
      freeSpinsCount >= FREE_SPINS_SPINS_MIN &&
      freeSpinsCount <= FREE_SPINS_SPINS_MAX);
  const canSave = trimmed && betRangeValid && freeSpinsValid;
```

- [ ] **Step 4: Include `freeSpins` in the saved settings**

Find:

```ts
      const settings = isSlots
        ? { ...initialSettings, rewardMode, houseEdge, design, boardSize }
        : isTumble
          ? { ...initialSettings, houseEdge, design }
          : initialSettings;
```

Replace with:

```ts
      const sanitizedFreeSpins = {
        enabled: freeSpinsEnabled,
        minBet: isFinite(freeSpinsMinBet) ? freeSpinsMinBet : FREE_SPINS_MIN_BET_FLOOR,
        maxBet: isFinite(freeSpinsMaxBet) ? freeSpinsMaxBet : initialMaxBet,
        spinsPerPurchase: Number.isInteger(freeSpinsCount) ? freeSpinsCount : DEFAULT_FREE_SPINS_COUNT,
      };
      const settings = isSlots
        ? { ...initialSettings, rewardMode, houseEdge, design, boardSize }
        : isTumble
          ? { ...initialSettings, houseEdge, design, freeSpins: sanitizedFreeSpins }
          : initialSettings;
```

- [ ] **Step 5: Add the Free Spins section to the UI**

Find:

```tsx
        {hasSkin && (
          <div>
            <Label>House edge</Label>
            <div className={`mt-1.5 grid gap-1.5 ${isTumble ? "grid-cols-5" : "grid-cols-6"}`}>
              {edgeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setHouseEdge(option)}
                  className={`rounded-lg border py-1.5 text-sm font-medium transition-colors ${
                    houseEdge === option
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  {Math.round(option * 100)}%
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Only changes the payout multiplier for a win — never how often players win.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
```

Replace with:

```tsx
        {hasSkin && (
          <div>
            <Label>House edge</Label>
            <div className={`mt-1.5 grid gap-1.5 ${isTumble ? "grid-cols-5" : "grid-cols-6"}`}>
              {edgeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setHouseEdge(option)}
                  className={`rounded-lg border py-1.5 text-sm font-medium transition-colors ${
                    houseEdge === option
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  {Math.round(option * 100)}%
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Only changes the payout multiplier for a win — never how often players win.
            </p>
          </div>
        )}

        {isTumble && (
          <div>
            <Label>Free Spins</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setFreeSpinsEnabled(false)}
                className={`rounded-lg border py-1.5 text-sm font-medium transition-colors ${
                  !freeSpinsEnabled ? "border-primary bg-primary/10" : "border-border hover:border-foreground/30"
                }`}
              >
                Disabled
              </button>
              <button
                type="button"
                onClick={() => setFreeSpinsEnabled(true)}
                className={`rounded-lg border py-1.5 text-sm font-medium transition-colors ${
                  freeSpinsEnabled ? "border-primary bg-primary/10" : "border-border hover:border-foreground/30"
                }`}
              >
                Enabled
              </button>
            </div>

            {freeSpinsEnabled && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="game-settings-fs-min-bet">Free spin min bet</Label>
                    <Input
                      id="game-settings-fs-min-bet"
                      type="number"
                      min={FREE_SPINS_MIN_BET_FLOOR}
                      max={FREE_SPINS_MAX_BET_CEILING}
                      step="any"
                      value={freeSpinsMinBetText}
                      onChange={(e) => setFreeSpinsMinBetText(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="game-settings-fs-max-bet">Free spin max bet</Label>
                    <Input
                      id="game-settings-fs-max-bet"
                      type="number"
                      min={FREE_SPINS_MIN_BET_FLOOR}
                      max={FREE_SPINS_MAX_BET_CEILING}
                      step="any"
                      value={freeSpinsMaxBetText}
                      onChange={(e) => setFreeSpinsMaxBetText(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="game-settings-fs-count">Free spins per purchase</Label>
                  <Input
                    id="game-settings-fs-count"
                    type="number"
                    min={FREE_SPINS_SPINS_MIN}
                    max={FREE_SPINS_SPINS_MAX}
                    step="1"
                    value={freeSpinsCountText}
                    onChange={(e) => setFreeSpinsCountText(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
                {!freeSpinsValid && (
                  <p className="text-xs text-destructive">
                    Free spin min bet must be at least {FREE_SPINS_MIN_BET_FLOOR}, max bet can't exceed{" "}
                    {FREE_SPINS_MAX_BET_CEILING.toLocaleString()} and must be at least the min bet, and spins
                    per purchase must be a whole number between {FREE_SPINS_SPINS_MIN} and {FREE_SPINS_SPINS_MAX}.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 7: Manual verification in the browser**

Start the dev server (`npm run dev`) if not already running, sign in as the test account (`claudetest.cassie@gmail.com` / `ClaudeTest123!`), open a casino's admin view, open the settings for a Tumble game. Confirm: the Free Spins section appears below House edge; toggling Enabled reveals the three inputs; entering an invalid range (e.g. max bet below min bet) shows the error text and disables Save; entering a valid range and saving persists it — reopening the settings modal shows the saved values.

- [ ] **Step 8: Commit**

```bash
git add src/components/GameSettingsModal.tsx
git commit -m "feat(tumble): add Free Spins settings section to admin UI"
```

---

### Task 5: `Tumble.tsx` — extract `playOutRound` (pure refactor, no behavior change)

**Files:**
- Modify: `src/components/games/Tumble.tsx`

**Interfaces:**
- Produces: `payoutFor(round: TumbleRound, bet: number): number` (local mirror of the engine's function) and `playOutRound(round: TumbleRound, bet: number, token: number): Promise<void>` — both consumed by `handleSpin` here and by `handleBuyFreeSpins` in Task 6.

This task changes no visible behavior — it only extracts the per-round animate/credit/banner logic that already exists inline in `handleSpin` into a helper both a manual spin and (in Task 6) each round of a purchased batch will call. Verify with a manual regression check, not a new automated test (there's no component test harness in this repo — see `package.json`).

- [ ] **Step 1: Add the local `payoutFor` mirror**

Find:

```ts
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
```

Replace with:

```ts
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
// Mirrors supabase/functions/tumble/engine.ts's payoutFor — used to credit
// each round's own payout locally as it finishes animating (see
// playOutRound below). Never used to decide an outcome, only to read one
// already-decided by the server.
function payoutFor(round: TumbleRound, bet: number): number {
  return roundMoney(bet * round.totalMultiplier);
}
```

- [ ] **Step 2: Extract `playOutRound` and simplify `handleSpin`**

Find:

```ts
  async function handleSpin() {
    if (!betValid || busy) return;
    setFormError(null);
    resetRound();
    setAnimating(true);

    const token = ++runId.current;
    // The outcome is already decided when the bet is placed but revealed
    // through the cascade, so the bet leaves the balance immediately and the
    // server's authoritative balance is only applied once the reveal ends —
    // otherwise the balance would spoil the result mid-animation.
    setLocalBalance((b) => roundMoney(b - bet));

    let result;
    try {
      result = await spin(bet);
    } catch (err) {
      if (runId.current === token) {
        setLocalBalance((b) => roundMoney(b + bet)); // roll the deduction back
        setFormError(err instanceof Error ? err.message : "Failed to place bet");
        setAnimating(false);
      }
      return;
    }
    if (runId.current !== token) return;

    await replay(result.round, token);
    if (runId.current !== token) return;

    setLocalBalance(result.balance);
    setAnimating(false);
    if (result.payout > 0) {
      setSettled({ payout: result.payout, multiplier: result.round.multiplier });
      playWinChime();
      setTimeout(() => {
        if (runId.current === token) setSettled(null);
      }, BANNER_MS + 400);
    }
  }
```

Replace with:

```ts
  // Plays one already-resolved round's cascade animation, then credits that
  // round's own payout into local balance and shows its win banner — the
  // shared per-round contract a manual spin (below) and each round of a
  // purchased free-spin batch (handleBuyFreeSpins) both use. Nothing here
  // computes an outcome; `round` and `bet` are already decided server-side.
  async function playOutRound(round: TumbleRound, bet: number, token: number) {
    resetRound();
    await replay(round, token);
    if (runId.current !== token) return;

    const payout = payoutFor(round, bet);
    if (payout > 0) {
      setLocalBalance((b) => roundMoney(b + payout));
      setSettled({ payout, multiplier: round.multiplier });
      playWinChime();
      setTimeout(() => {
        if (runId.current === token) setSettled(null);
      }, BANNER_MS + 400);
    }
  }

  async function handleSpin() {
    if (!betValid || busy) return;
    setFormError(null);
    setAnimating(true);

    const token = ++runId.current;
    // The outcome is already decided when the bet is placed but revealed
    // through the cascade, so the bet leaves the balance immediately and the
    // server's authoritative balance is only applied once the reveal ends —
    // otherwise the balance would spoil the result mid-animation.
    setLocalBalance((b) => roundMoney(b - bet));

    let result;
    try {
      result = await spin(bet);
    } catch (err) {
      if (runId.current === token) {
        setLocalBalance((b) => roundMoney(b + bet)); // roll the deduction back
        setFormError(err instanceof Error ? err.message : "Failed to place bet");
        setAnimating(false);
      }
      return;
    }
    if (runId.current !== token) return;

    await playOutRound(result.round, bet, token);
    if (runId.current !== token) return;

    setLocalBalance(result.balance);
    setAnimating(false);
  }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 4: Manual regression check in the browser**

Start the dev server, sign in as the test account, open a Tumble game, place a manual spin. Confirm: bet is deducted from the balance the instant Spin is pressed, the cascade animates exactly as before, a win shows the banner/chime only once the cascade finishes, and the final balance matches bet vs. payout. Also spin until you get a loss and confirm no banner/chime appears.

- [ ] **Step 5: Commit**

```bash
git add src/components/games/Tumble.tsx
git commit -m "refactor(tumble): extract playOutRound from handleSpin"
```

---

### Task 6: `Tumble.tsx` — buy panel, batch playback, info bullet

**Files:**
- Modify: `src/components/games/Tumble.tsx`

**Interfaces:**
- Consumes: `playOutRound(round, bet, token)` (Task 5), `buyFreeSpins(bet)` (Task 3), `TumbleFreeSpinsSettings`/`TumbleFreeSpinsResult` (Task 1).
- Produces: `Tumble`'s `Props.freeSpins?: TumbleFreeSpinsSettings` (defaults to a disabled config when omitted, so `CasinoDashboard.tsx` doesn't need to pass it until Task 7 — keeps this task independently type-checkable).

- [ ] **Step 1: Import the new types and add a default**

Find:

```ts
import type { SlotSymbolId, TumbleBoard, TumbleRound, TumbleStep } from "../../types";
```

Replace with:

```ts
import type {
  SlotSymbolId,
  TumbleBoard,
  TumbleFreeSpinsResult,
  TumbleFreeSpinsSettings,
  TumbleRound,
  TumbleStep,
} from "../../types";
```

Find:

```ts
function randomSymbolId(): SlotSymbolId {
  return SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
}
```

Replace with:

```ts
function randomSymbolId(): SlotSymbolId {
  return SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
}
// Used only when a parent hasn't wired the freeSpins prop yet — CasinoDashboard
// passes the real resolved settings in Task 7 of the free-spins plan.
const DEFAULT_FREE_SPINS: TumbleFreeSpinsSettings = {
  enabled: false,
  minBet: 1,
  maxBet: 100,
  spinsPerPurchase: 10,
};
```

- [ ] **Step 2: Add the `freeSpins` prop**

Find:

```ts
interface Props {
  casinoId: string;
  gameId: string;
  houseEdge: number;
  design?: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Tumble({
  casinoId,
  gameId,
  houseEdge,
  design,
  balance: initialBalance,
  minBet,
  maxBet,
  onExit,
}: Props) {
  const { loading, spin } = useTumble(casinoId, gameId);
```

Replace with:

```ts
interface Props {
  casinoId: string;
  gameId: string;
  houseEdge: number;
  design?: string;
  freeSpins?: TumbleFreeSpinsSettings;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Tumble({
  casinoId,
  gameId,
  houseEdge,
  design,
  freeSpins = DEFAULT_FREE_SPINS,
  balance: initialBalance,
  minBet,
  maxBet,
  onExit,
}: Props) {
  const { loading, spin, buyFreeSpins } = useTumble(casinoId, gameId);
```

- [ ] **Step 3: Add free-spin purchase state**

Find:

```ts
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
```

Replace with:

```ts
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [freeSpinBetText, setFreeSpinBetText] = useState(String(freeSpins.minBet));
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState<{ index: number; total: number } | null>(null);
```

- [ ] **Step 4: Add free-spin bet validity and the purchase handler**

Find:

```ts
  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;
  const busy = loading || animating;
```

Replace with:

```ts
  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;
  const freeSpinBet = Math.max(0, parseFloat(freeSpinBetText) || 0);
  const freeSpinCost = roundMoney(freeSpinBet * freeSpins.spinsPerPurchase);
  const freeSpinBetValid =
    freeSpins.enabled &&
    freeSpinBet >= freeSpins.minBet &&
    freeSpinBet <= freeSpins.maxBet &&
    freeSpinCost <= localBalance;
  const busy = loading || animating;
```

Find (this is the end of `handleSpin`, right before the `tumbleInfo` `useMemo`):

```ts
    setLocalBalance(result.balance);
    setAnimating(false);
  }

  const tumbleInfo: GameInfoEntry = useMemo(
```

Replace with:

```ts
    setLocalBalance(result.balance);
    setAnimating(false);
  }

  async function handleBuyFreeSpins() {
    if (!freeSpinBetValid || busy) return;
    setFormError(null);
    setAnimating(true);

    const token = ++runId.current;
    const cost = freeSpinCost;
    // Same "deduct before the reveal" rule as a manual spin, extended to
    // cover the whole prepaid batch at once — the balance must never spoil
    // any individual spin's outcome ahead of that spin's own animation.
    setLocalBalance((b) => roundMoney(b - cost));

    let result: TumbleFreeSpinsResult;
    try {
      result = await buyFreeSpins(freeSpinBet);
    } catch (err) {
      if (runId.current === token) {
        setLocalBalance((b) => roundMoney(b + cost)); // roll the deduction back
        setFormError(err instanceof Error ? err.message : "Failed to buy free spins");
        setAnimating(false);
      }
      return;
    }
    if (runId.current !== token) return;

    for (let i = 0; i < result.rounds.length; i++) {
      setFreeSpinsRemaining({ index: i + 1, total: result.rounds.length });
      await playOutRound(result.rounds[i], result.bet, token);
      if (runId.current !== token) return;
    }

    setFreeSpinsRemaining(null);
    setLocalBalance(result.balance);
    setAnimating(false);
  }

  const tumbleInfo: GameInfoEntry = useMemo(
```

- [ ] **Step 5: Add the free-spins rule to the info panel**

Find:

```ts
        `This machine's house edge is ${(houseEdge * 100).toFixed(0)}%, already applied to the payouts shown.`,
      ],
    }),
    [houseEdge]
  );
```

Replace with:

```ts
        `This machine's house edge is ${(houseEdge * 100).toFixed(0)}%, already applied to the payouts shown.`,
        ...(freeSpins.enabled
          ? [
              `Buy ${freeSpins.spinsPerPurchase} free spins for a stake between ${formatChips(
                freeSpins.minBet
              )} and ${formatChips(freeSpins.maxBet)} chips — each spin plays out with the exact same odds as a normal spin.`,
            ]
          : []),
      ],
    }),
    [houseEdge, freeSpins]
  );
```

- [ ] **Step 6: Add the buy panel to the sidebar**

Find:

```tsx
            <Button onClick={handleSpin} disabled={!betValid || busy} className="w-full">
              {busy ? "Spinning…" : "Spin"}
            </Button>
            {formError && <p className="text-xs text-destructive">{formError}</p>}

            <div className="mt-1">
```

Replace with:

```tsx
            <Button onClick={handleSpin} disabled={!betValid || busy} className="w-full">
              {busy ? "Spinning…" : "Spin"}
            </Button>
            {formError && <p className="text-xs text-destructive">{formError}</p>}

            {freeSpins.enabled && (
              <div className="pt-3 border-t border-border">
                <label className="text-xs text-muted-foreground">Free Spins</label>
                <input
                  type="number"
                  min={0}
                  value={freeSpinBetText}
                  onChange={(e) => setFreeSpinBetText(e.target.value)}
                  disabled={busy}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Min {formatChips(freeSpins.minBet)} · Max {formatChips(freeSpins.maxBet)} per spin
                </p>
                <Button
                  onClick={handleBuyFreeSpins}
                  disabled={!freeSpinBetValid || busy}
                  variant="outline"
                  className="w-full mt-2"
                >
                  Buy {freeSpins.spinsPerPurchase} Free Spins — {formatChips(freeSpinCost)}
                </Button>
              </div>
            )}

            <div className="mt-1">
```

- [ ] **Step 7: Show the "Free Spin i of N" indicator**

Find:

```tsx
            <div className="flex h-6 items-center gap-3 text-sm">
              {runningPay > 0 && (
```

Replace with:

```tsx
            <div className="flex h-6 items-center gap-3 text-sm">
              {freeSpinsRemaining && (
                <span className="font-semibold text-muted-foreground">
                  Free Spin {freeSpinsRemaining.index} of {freeSpinsRemaining.total}
                </span>
              )}
              {runningPay > 0 && (
```

- [ ] **Step 8: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/components/games/Tumble.tsx
git commit -m "feat(tumble): add free-spins buy panel and batch playback"
```

---

### Task 7: `CasinoDashboard.tsx` — wire the `freeSpins` prop

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx:442-456`

**Interfaces:**
- Consumes: `Tumble`'s `freeSpins?: TumbleFreeSpinsSettings` prop (Task 6).

- [ ] **Step 1: Pass the resolved free-spins settings**

Find:

```tsx
          {activeGame.game_type_id === "tumble" && (
            <Tumble
              casinoId={currentCasino.id}
              gameId={activeGame.id}
              // Mirrors the tumble edge function's DEFAULT_HOUSE_EDGE
              // fallback (supabase/functions/tumble/engine.ts) for rows whose
              // settings an admin hasn't touched yet.
              houseEdge={(activeGame.settings as TumbleInstanceSettings)?.houseEdge ?? 0.03}
              design={(activeGame.settings as TumbleInstanceSettings)?.design ?? DEFAULT_SLOTS_DESIGN_ID}
              balance={membership?.balance ?? 0}
              minBet={activeGame.min_bet}
              maxBet={activeGame.max_bet}
              onExit={() => setActiveGame(null)}
            />
          )}
```

Replace with:

```tsx
          {activeGame.game_type_id === "tumble" && (
            <Tumble
              casinoId={currentCasino.id}
              gameId={activeGame.id}
              // Mirrors the tumble edge function's DEFAULT_HOUSE_EDGE
              // fallback (supabase/functions/tumble/engine.ts) for rows whose
              // settings an admin hasn't touched yet.
              houseEdge={(activeGame.settings as TumbleInstanceSettings)?.houseEdge ?? 0.03}
              design={(activeGame.settings as TumbleInstanceSettings)?.design ?? DEFAULT_SLOTS_DESIGN_ID}
              // Mirrors resolveFreeSpinsSettings's default fallback
              // (supabase/functions/tumble/engine.ts) for rows whose
              // settings an admin hasn't touched yet.
              freeSpins={
                (activeGame.settings as TumbleInstanceSettings)?.freeSpins?.enabled
                  ? (activeGame.settings as TumbleInstanceSettings).freeSpins!
                  : { enabled: false, minBet: 1, maxBet: Math.max(1, activeGame.max_bet), spinsPerPurchase: 10 }
              }
              balance={membership?.balance ?? 0}
              minBet={activeGame.min_bet}
              maxBet={activeGame.max_bet}
              onExit={() => setActiveGame(null)}
            />
          )}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "feat(tumble): wire freeSpins settings into CasinoDashboard"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: PASS (compiles and bundles with no errors)

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — every existing test plus the new `resolveFreeSpinsSettings` suite from Task 2.

- [ ] **Step 3: Playwright walkthrough**

Start the dev server (`npm run dev`) if not already running. Using Playwright, signed in as the test account (`claudetest.cassie@gmail.com` / `ClaudeTest123!`):

1. Open a casino's admin view, open a Tumble game's settings, enable Free Spins with min bet 1, max bet 10, spins per purchase 5. Save.
2. Open that Tumble game as a player. Confirm the Free Spins panel is visible with the stake input defaulting near the configured min, and "Buy 5 Free Spins — …" showing a cost that updates as the stake input changes.
3. Note the current balance. Set the free-spin stake to 2 (cost = 10) and click Buy.
4. Confirm the balance drops by 10 immediately (before any spin animates).
5. Watch all 5 spins auto-play in sequence: the "Free Spin i of 5" indicator advances 1→5, each spin's cascade animates, and any win's banner/chime only appears after that spin's own cascade finishes (not before).
6. After the batch ends, confirm the indicator disappears and the final balance equals the pre-purchase balance minus 10 plus the sum of whatever each spin paid.
7. Reopen the game settings, disable Free Spins, save, and confirm the buy panel disappears from the player view while the regular Spin flow still works.
8. Open the game info panel (the "i" button) and confirm the free-spins rule bullet is present while enabled and absent while disabled.

- [ ] **Step 4: Report results**

If every check in Step 3 passes, the feature is done. If anything fails, note exactly which check and what was observed — do not mark the task complete.
