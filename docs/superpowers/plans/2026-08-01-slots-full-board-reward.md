# Slots Full Board Reward Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins pick a per-slots-instance "Reward Mode" — the existing middle-row-only payline ("Single row reward") or a new mode that scores all 3 rows combined ("Full board reward") — with the new mode's payout table solved so its house edge stays close to today's.

**Architecture:** A `settings jsonb` column on `casino_games` stores `{ rewardMode }` per instance. The slots edge function reads it (via the `casino_game_id` it's already handed for per-instance bet limits) and branches between the existing single-row evaluator/payout functions and new full-board ones. The frontend gets a matching `rewardMode` prop to render the right paytable and highlight the right cells.

**Tech Stack:** React + TypeScript (Vite), Supabase (Postgres + Deno edge functions), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md` — read it for the full math derivation before starting.

**Important — work on top of in-flight changes:** This repo currently has an uncommitted, in-progress feature (per-instance bet limits: `casino_games.min_bet`/`max_bet`, migration `supabase/migrations/036_casino_games_bet_limits.sql`) already applied to the database and wired through `CasinoGame`, `GameSettingsModal`, `useGames`, and `CasinoDashboard.tsx`. Every "current content" code block below reflects that in-progress state as of writing this plan. **Before editing any file in a task, re-read it** — if its content doesn't match what's shown here, stop and reconcile before proceeding (don't blindly overwrite someone else's concurrent edits).

---

## File Structure

| File | Change |
|---|---|
| `supabase/migrations/037_slots_reward_mode.sql` | New. Adds `casino_games.settings jsonb`. |
| `src/types/index.ts` | Modify. `CasinoGame.settings`, new `SlotsInstanceSettings`, `FullBoardSlotWin`, updated `SlotsResult`. |
| `supabase/functions/slots/engine.ts` | Modify. New `FULL_BOARD_SYMBOLS`, `evaluateFullBoardWin`, `payoutForFullBoard`. |
| `supabase/functions/slots/engine.test.ts` | Modify. Tests for the above, TDD. |
| `supabase/functions/slots/index.ts` | Modify. Reads `settings` from the `casino_games` row, branches reward mode, returns it. |
| `src/hooks/useGames.ts` | Modify. `createGame`/`updateGame` persist `settings`. |
| `src/components/GameSettingsModal.tsx` | Modify. Reward Mode picker (slots only). |
| `src/components/games/Slots.tsx` | Modify. `rewardMode` prop drives paytable, cell highlighting, win tier. |
| `src/pages/CasinoDashboard.tsx` | Modify. Threads settings through `onCreate`/`onUpdate`/`GameSettingsModal`/`<Slots>`. |

---

### Task 1: Database migration — `casino_games.settings`

**Files:**
- Create: `supabase/migrations/037_slots_reward_mode.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Per-instance settings blob for casino_games (e.g. slots' reward mode).
-- Defaults to '{}' so every existing instance keeps its current behavior.
alter table public.casino_games
  add column if not exists settings jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Apply it to the database via the Supabase MCP tool**

Call `mcp__claude_ai_Supabase__apply_migration` with:
- `project_id`: `tvivhadsgtvfvxwpahef`
- `name`: `slots_reward_mode_settings`
- `query`: the SQL from Step 1

- [ ] **Step 3: Verify the column exists**

Call `mcp__claude_ai_Supabase__execute_sql` with `project_id: tvivhadsgtvfvxwpahef` and query:

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'casino_games' and column_name = 'settings';
```

Expected: one row, `data_type = jsonb`, `column_default = '{}'::jsonb`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/037_slots_reward_mode.sql
git commit -m "feat(slots): add settings column to casino_games"
```

---

### Task 2: Shared types

**Files:**
- Modify: `src/types/index.ts:62-70` (the `CasinoGame` interface)
- Modify: `src/types/index.ts:132-147` (`SlotWin` / `SlotsResult`)

- [ ] **Step 1: Add `settings` to `CasinoGame` and a `SlotsInstanceSettings` type**

Replace:

```ts
export interface CasinoGame {
  id: string;
  casino_id: string;
  game_type_id: string;
  custom_name: string;
  is_active: boolean;
  min_bet: number;
  max_bet: number;
}
```

with:

```ts
export interface CasinoGame {
  id: string;
  casino_id: string;
  game_type_id: string;
  custom_name: string;
  is_active: boolean;
  min_bet: number;
  max_bet: number;
  settings: Record<string, unknown>;
}

// Shape of CasinoGame.settings for a slots instance.
export interface SlotsInstanceSettings {
  rewardMode?: "single_row" | "full_board";
}
```

- [ ] **Step 2: Add `FullBoardSlotWin` and update `SlotsResult`**

Replace:

```ts
export interface SlotWin {
  symbol: SlotSymbolId;
  count: 3 | 4 | 5;
  // Reel indices (0-based) holding the winning symbol — not necessarily
  // contiguous or left-aligned, since matches are scatter-style.
  positions: number[];
}

// Mirror of the edge function's response (supabase/functions/slots/engine.ts).
export interface SlotsResult {
  reels: SlotReel[];
  win: SlotWin | null;
  bet: number;
  payout: number;
  balance: number;
}
```

with:

```ts
export interface SlotWin {
  symbol: SlotSymbolId;
  count: 3 | 4 | 5;
  // Reel indices (0-based) holding the winning symbol — not necessarily
  // contiguous or left-aligned, since matches are scatter-style.
  positions: number[];
}

// Full-board mode win: count spans all 3 rows (7-15), so positions need a
// row alongside the reel index — kept as a separate type from SlotWin
// rather than unifying, so single-row's shape stays untouched.
export interface FullBoardSlotWin {
  symbol: SlotSymbolId;
  count: number;
  positions: { reel: number; row: "top" | "mid" | "bottom" }[];
}

// Mirror of the edge function's response (supabase/functions/slots/engine.ts).
export interface SlotsResult {
  reels: SlotReel[];
  win: SlotWin | FullBoardSlotWin | null;
  rewardMode: "single_row" | "full_board";
  bet: number;
  payout: number;
  balance: number;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: pre-existing errors only (if any) from files this task hasn't touched yet — no new errors in `src/types/index.ts`. (Tasks 6-9 will introduce their own consumers of the new types.)

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(slots): add types for per-instance reward mode"
```

---

### Task 3: Engine — full board evaluator and payout (TDD)

**Files:**
- Modify: `supabase/functions/slots/engine.ts` (append after `payoutFor`, currently ending at line 101)
- Test: `supabase/functions/slots/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/slots/engine.test.ts`, replace the import block:

```ts
import { describe, it, expect } from "vitest";
import {
  SYMBOLS,
  pickSymbol,
  spin,
  evaluateWin,
  payoutFor,
  roundMoney,
  REEL_COUNT,
  type Reel,
  type SymbolId,
} from "./engine";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
  SYMBOLS,
  pickSymbol,
  spin,
  evaluateWin,
  payoutFor,
  roundMoney,
  REEL_COUNT,
  FULL_BOARD_SYMBOLS,
  evaluateFullBoardWin,
  payoutForFullBoard,
  type Reel,
  type SymbolId,
} from "./engine";
```

Then append this to the end of the file (after the closing `});` of the existing `describe("RTP", ...)` block):

```ts
describe("evaluateFullBoardWin", () => {
  it("returns null when the max count across all 15 cells is below 7", () => {
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "square" },
      { top: "dot", mid: "dot", bottom: "square" },
      { top: "dot", mid: "square", bottom: "diamond" },
      { top: "diamond", mid: "star", bottom: "seven" },
      { top: "star", mid: "seven", bottom: "square" },
    ];
    expect(evaluateFullBoardWin(reels)).toBeNull();
  });

  it("counts matches across all 3 rows, not just mid, at the 7-cell threshold", () => {
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "square" },
      { top: "dot", mid: "dot", bottom: "square" },
      { top: "dot", mid: "dot", bottom: "diamond" },
      { top: "dot", mid: "square", bottom: "diamond" },
      { top: "star", mid: "seven", bottom: "square" },
    ];
    expect(evaluateFullBoardWin(reels)).toEqual({
      symbol: "dot",
      count: 7,
      positions: [
        { reel: 0, row: "top" },
        { reel: 0, row: "mid" },
        { reel: 1, row: "top" },
        { reel: 1, row: "mid" },
        { reel: 2, row: "top" },
        { reel: 2, row: "mid" },
        { reel: 3, row: "top" },
      ],
    });
  });

  it("reaches the 9-cell BIG WIN tier", () => {
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "diamond" },
      { top: "dot", mid: "square", bottom: "diamond" },
      { top: "star", mid: "seven", bottom: "square" },
    ];
    const win = evaluateFullBoardWin(reels);
    expect(win?.symbol).toBe("dot");
    expect(win?.count).toBe(9);
  });

  it("reaches the 11-cell MEGA WIN tier", () => {
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "diamond" },
      { top: "star", mid: "seven", bottom: "square" },
    ];
    const win = evaluateFullBoardWin(reels);
    expect(win?.symbol).toBe("dot");
    expect(win?.count).toBe(11);
  });

  it("breaks a tie in favor of the rarer symbol", () => {
    // dot and square both land exactly 7 times; square is rarer (later in
    // SYMBOLS) and must win the payout.
    const reels: Reel[] = [
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "dot", bottom: "dot" },
      { top: "dot", mid: "square", bottom: "square" },
      { top: "square", mid: "square", bottom: "square" },
      { top: "square", mid: "square", bottom: "diamond" },
    ];
    const win = evaluateFullBoardWin(reels);
    expect(win?.symbol).toBe("square");
    expect(win?.count).toBe(7);
  });
});

describe("payoutForFullBoard", () => {
  it("returns 0 for no win", () => {
    expect(payoutForFullBoard(null, 10)).toBe(0);
  });

  it("pays the tier-0 rate for 7-8 matches", () => {
    expect(payoutForFullBoard({ symbol: "dot", count: 7, positions: [] }, 10)).toBe(14.6);
    expect(payoutForFullBoard({ symbol: "dot", count: 8, positions: [] }, 10)).toBe(14.6);
  });

  it("pays the tier-1 rate for 9-10 matches", () => {
    expect(payoutForFullBoard({ symbol: "square", count: 9, positions: [] }, 10)).toBe(102.3);
    expect(payoutForFullBoard({ symbol: "square", count: 10, positions: [] }, 10)).toBe(102.3);
  });

  it("pays the tier-2 rate for 11+ matches", () => {
    expect(payoutForFullBoard({ symbol: "seven", count: 11, positions: [] }, 2)).toBe(759.96);
    expect(payoutForFullBoard({ symbol: "seven", count: 15, positions: [] }, 2)).toBe(759.96);
  });
});

describe("full board RTP", () => {
  // Exact multinomial enumeration over all compositions of 15 cells into
  // the 5 symbols (C(19,4) = 3,876 of them), recomputed independently of
  // evaluateFullBoardWin/payoutForFullBoard so a change to
  // FULL_BOARD_SYMBOLS or the tie-break rule can't silently drift the
  // payout curve without this test catching it. Same tie-break rule as
  // evaluateFullBoardWin: highest count wins, ties go to the rarer symbol.
  // See docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md.
  function factorial(n: number): number {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function tierIndex(count: number): 0 | 1 | 2 {
    if (count >= 11) return 2;
    if (count >= 9) return 1;
    return 0;
  }

  function theoreticalFullBoardRtp() {
    const n = 15;
    let rtp = 0;
    let hitFrequency = 0;

    function enumerate(idx: number, remaining: number, counts: number[]) {
      if (idx === SYMBOLS.length - 1) {
        counts[idx] = remaining;
        let coef = factorial(n);
        let pw = 1;
        for (let i = 0; i < SYMBOLS.length; i++) {
          coef /= factorial(counts[i]);
          pw *= SYMBOLS[i].weight ** counts[i];
        }
        const p = coef * pw;

        let bestIdx = -1;
        let bestCount = -1;
        for (let i = 0; i < counts.length; i++) {
          if (counts[i] >= bestCount) {
            bestCount = counts[i];
            bestIdx = i;
          }
        }
        if (bestCount >= 7) {
          rtp += p * FULL_BOARD_SYMBOLS[bestIdx].pay[tierIndex(bestCount)];
          hitFrequency += p;
        }
        return;
      }
      for (let c = 0; c <= remaining; c++) {
        counts[idx] = c;
        enumerate(idx + 1, remaining - c, counts);
      }
    }
    enumerate(0, n, new Array(SYMBOLS.length).fill(0));
    return { rtp, hitFrequency };
  }

  it("pays back roughly 97-99%, matching single-row's house edge", () => {
    const { rtp } = theoreticalFullBoardRtp();
    expect(rtp).toBeGreaterThan(0.97);
    expect(rtp).toBeLessThan(0.99);
  });

  it("hits noticeably less often than single-row, since it needs 7+ of 15 cells", () => {
    const { hitFrequency } = theoreticalFullBoardRtp();
    expect(hitFrequency).toBeGreaterThan(0.28);
    expect(hitFrequency).toBeLessThan(0.36);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run supabase/functions/slots/engine.test.ts`
Expected: FAIL — `evaluateFullBoardWin`, `payoutForFullBoard`, `FULL_BOARD_SYMBOLS` are not exported from `./engine`.

- [ ] **Step 3: Implement the full-board evaluator and payout in `engine.ts`**

Append to the end of `supabase/functions/slots/engine.ts` (after the existing `payoutFor` function):

```ts
// --- Full board reward mode -------------------------------------------
//
// "Full board" scores all 15 visible cells (top/mid/bottom x 5 reels)
// instead of just the mid-row payline. With 15 iid draws across 5
// symbols, some symbol has count >= 3 on effectively 100% of spins
// (pigeonhole: 15 cells / 5 symbols = 3 average), so reusing the
// single-row threshold of 3 would mean winning every spin. Exact
// multinomial enumeration (all 3,876 compositions of 15 into 5 parts,
// weighted by SYMBOLS' weights above) over "highest count wins, ties
// broken toward the rarer symbol" gives:
//
//   P(max count >= 7)  = 31.97%  <- win threshold
//   P(max count >= 9)  =  4.72%  <- BIG WIN tier
//   P(max count >= 11) =  0.30%  <- MEGA WIN tier
//
// The pay table below was solved (same weighted-sum-times-pay approach
// as SYMBOLS' RTP above, using those exact tier probabilities) to bring
// total RTP to ~0.9817 (house edge ~1.83%), matching single-row's ~0.9820
// (~1.80%). Full derivation:
// docs/superpowers/specs/2026-08-01-slots-full-board-reward-design.md
export interface FullBoardPosition {
  reel: number;
  row: "top" | "mid" | "bottom";
}

export interface FullBoardWin {
  symbol: SymbolId;
  count: number; // 7..15
  positions: FullBoardPosition[];
}

interface FullBoardSymbolDef {
  id: SymbolId;
  // Pay at tier 0 (7-8 cells), tier 1 (9-10 cells), tier 2 (11-15 cells).
  pay: [number, number, number];
}

export const FULL_BOARD_MIN_COUNT = 7;

export const FULL_BOARD_SYMBOLS: FullBoardSymbolDef[] = [
  { id: "dot", pay: [1.46, 7.31, 58.46] },
  { id: "square", pay: [2.19, 10.23, 80.38] },
  { id: "diamond", pay: [2.92, 14.61, 116.92] },
  { id: "star", pay: [4.38, 21.92, 189.99] },
  { id: "seven", pay: [7.31, 36.54, 379.98] },
];

function fullBoardTierIndex(count: number): 0 | 1 | 2 {
  if (count >= 11) return 2;
  if (count >= 9) return 1;
  return 0;
}

// Counts every cell (not just mid) per symbol, then picks the highest
// count. SYMBOLS is ordered low -> high tier (rarer last); scanning in
// that order and overwriting on `>=` lets a later (rarer) symbol win
// ties, matching the tie-break rule baked into the pay table's derivation.
export function evaluateFullBoardWin(reels: Reel[]): FullBoardWin | null {
  const cellsBySymbol = new Map<SymbolId, FullBoardPosition[]>();
  reels.forEach((reel, i) => {
    (["top", "mid", "bottom"] as const).forEach((row) => {
      const symbol = reel[row];
      const positions = cellsBySymbol.get(symbol) ?? [];
      positions.push({ reel: i, row });
      cellsBySymbol.set(symbol, positions);
    });
  });

  let best: { symbol: SymbolId; positions: FullBoardPosition[] } | null = null;
  for (const s of SYMBOLS) {
    const positions = cellsBySymbol.get(s.id) ?? [];
    if (positions.length > 0 && (!best || positions.length >= best.positions.length)) {
      best = { symbol: s.id, positions };
    }
  }

  if (!best || best.positions.length < FULL_BOARD_MIN_COUNT) return null;
  return { symbol: best.symbol, count: best.positions.length, positions: best.positions };
}

export function payoutForFullBoard(win: FullBoardWin | null, bet: number): number {
  if (!win) return 0;
  const symbol = FULL_BOARD_SYMBOLS.find((s) => s.id === win.symbol)!;
  return roundMoney(bet * symbol.pay[fullBoardTierIndex(win.count)]);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run supabase/functions/slots/engine.test.ts`
Expected: PASS — all tests including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/slots/engine.ts supabase/functions/slots/engine.test.ts
git commit -m "feat(slots): add full board reward evaluator and payout table"
```

---

### Task 4: Edge function — wire up reward mode

**Files:**
- Modify: `supabase/functions/slots/index.ts` (full file, currently 107 lines)

- [ ] **Step 1: Replace the file contents**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  spin,
  evaluateWin,
  evaluateFullBoardWin,
  payoutFor,
  payoutForFullBoard,
  roundMoney,
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

type RewardMode = "single_row" | "full_board";

// Unknown/missing settings, or any value other than "full_board", default
// to today's behavior — this is what keeps every pre-existing casino_games
// row (settings = '{}') playing exactly as before.
function resolveRewardMode(settings: unknown): RewardMode {
  if (
    settings &&
    typeof settings === "object" &&
    (settings as Record<string, unknown>).rewardMode === "full_board"
  ) {
    return "full_board";
  }
  return "single_row";
}

function describeSpin(rewardMode: RewardMode, win: { symbol: string; count: number } | null): string {
  if (!win) return "Slots: no win";
  const label = rewardMode === "full_board" ? "full board" : "row";
  return `Slots: ${win.count}x ${win.symbol} (${label})`;
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
    const { casino_id, casino_game_id, bet } = body as {
      casino_id: string;
      casino_game_id: string;
      bet: number;
    };

    // Membership/balance and bet limits don't depend on each other — fetch both at once.
    const [{ data: member }, { data: cg }] = await Promise.all([
      userClient
        .from("casino_members")
        .select("balance")
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .single(),
      admin
        .from("casino_games")
        .select("min_bet, max_bet, settings")
        .eq("id", casino_game_id)
        .eq("casino_id", casino_id)
        .eq("game_type_id", "slots")
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

    const rewardMode = resolveRewardMode(cg.settings);
    const reels = spin(rng);

    let win: ReturnType<typeof evaluateWin> | ReturnType<typeof evaluateFullBoardWin>;
    let payout: number;
    if (rewardMode === "full_board") {
      win = evaluateFullBoardWin(reels);
      payout = payoutForFullBoard(win, validBet);
    } else {
      win = evaluateWin(reels);
      payout = payoutFor(win, validBet);
    }
    const net = roundMoney(payout - validBet);
    const balance = roundMoney(member.balance + net);

    await Promise.all([
      admin
        .from("casino_members")
        .update({ balance })
        .eq("casino_id", casino_id)
        .eq("user_id", user.id),
      admin.from("transactions").insert({
        casino_id,
        user_id: user.id,
        amount: net,
        balance_after: balance,
        game_type_id: "slots",
        description: describeSpin(rewardMode, win),
      }),
    ]);

    return json({ reels, win, rewardMode, bet: validBet, payout, balance });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Deploy the edge function**

Call `mcp__claude_ai_Supabase__deploy_edge_function` with `project_id: tvivhadsgtvfvxwpahef`, `name: slots`, and the file contents from Step 1 (path `supabase/functions/slots/index.ts` — the tool reads the file, matching the project's existing deploy pattern for this function).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/slots/index.ts
git commit -m "feat(slots): branch spin resolution on per-instance reward mode"
```

---

### Task 5: `useGames` hook — persist settings

**Files:**
- Modify: `src/hooks/useGames.ts` (full file, currently 62 lines)

- [ ] **Step 1: Replace the file contents**

```ts
import { supabase } from "../lib/supabase";
import type { GameType, CasinoGame } from "../types";

export function useGames() {
  async function listGameTypes(): Promise<GameType[]> {
    const { data, error } = await supabase.from("game_types").select("*").order("name");
    if (error) throw error;
    return (data ?? []) as GameType[];
  }

  async function listCasinoGames(casinoId: string): Promise<CasinoGame[]> {
    const { data, error } = await supabase
      .from("casino_games")
      .select("*")
      .eq("casino_id", casinoId)
      .order("custom_name");
    if (error) throw error;
    return (data ?? []) as CasinoGame[];
  }

  async function createGame(
    casinoId: string,
    gameTypeId: string,
    customName: string,
    minBet: number,
    maxBet: number,
    settings: Record<string, unknown> = {}
  ): Promise<CasinoGame> {
    const { data, error } = await supabase
      .from("casino_games")
      .insert({
        casino_id: casinoId,
        game_type_id: gameTypeId,
        custom_name: customName,
        is_active: true,
        min_bet: minBet,
        max_bet: maxBet,
        settings,
      })
      .select()
      .single();
    if (error) throw error;
    return data as CasinoGame;
  }

  async function updateGame(
    id: string,
    customName: string,
    minBet: number,
    maxBet: number,
    settings: Record<string, unknown> = {}
  ): Promise<CasinoGame> {
    const { data, error } = await supabase
      .from("casino_games")
      .update({ custom_name: customName, min_bet: minBet, max_bet: maxBet, settings })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as CasinoGame;
  }

  async function deleteGame(id: string): Promise<void> {
    const { error } = await supabase.from("casino_games").delete().eq("id", id);
    if (error) throw error;
  }

  return { listGameTypes, listCasinoGames, createGame, updateGame, deleteGame };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useGames.ts
git commit -m "feat(games): persist per-instance settings on create/update"
```

---

### Task 6: `GameSettingsModal` — Reward Mode picker

**Files:**
- Modify: `src/components/GameSettingsModal.tsx` (full file, currently 143 lines)

- [ ] **Step 1: Replace the file contents**

```tsx
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const GLASS = "bg-white/5 backdrop-blur-xl border border-white/10";
const CARD_GLOW = "shadow-[0_8px_32px_rgba(124,58,237,0.15)]";

const REWARD_MODES = [
  {
    id: "single_row" as const,
    label: "Single row reward",
    description: "Win by matching symbols on the middle row.",
  },
  {
    id: "full_board" as const,
    label: "Full board reward",
    description: "Win by matching symbols anywhere across all 3 rows.",
  },
];

interface GameSettingsModalProps {
  title: string;
  imageUrl: string | undefined;
  gameTypeId: string;
  initialName: string;
  initialMinBet: number;
  initialMaxBet: number;
  initialSettings: Record<string, unknown>;
  onSave: (name: string, minBet: number, maxBet: number, settings: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export function GameSettingsModal({
  title,
  imageUrl,
  gameTypeId,
  initialName,
  initialMinBet,
  initialMaxBet,
  initialSettings,
  onSave,
  onClose,
}: GameSettingsModalProps) {
  const [name, setName] = useState(initialName);
  const [minBetText, setMinBetText] = useState(String(initialMinBet));
  const [maxBetText, setMaxBetText] = useState(String(initialMaxBet));
  const [rewardMode, setRewardMode] = useState<"single_row" | "full_board">(
    initialSettings.rewardMode === "full_board" ? "full_board" : "single_row"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const minBet = parseFloat(minBetText);
  const maxBet = parseFloat(maxBetText);
  const betRangeValid = isFinite(minBet) && minBet > 0 && isFinite(maxBet) && maxBet >= minBet;
  const isSlots = gameTypeId === "slots";

  async function handleSave() {
    if (!trimmed || !betRangeValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const settings = isSlots ? { ...initialSettings, rewardMode } : initialSettings;
      await onSave(trimmed, minBet, maxBet, settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save game");
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-2xl ${GLASS} ${CARD_GLOW} overflow-hidden`}>
      <div className="flex items-start justify-between p-5 border-b border-white/10">
        <p className="font-semibold text-base">{title}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <Label>Front image</Label>
          <div className="mt-1.5 rounded-xl border border-border overflow-hidden">
            {imageUrl && (
              <img src={imageUrl} alt="" className="h-32 w-full object-cover" />
            )}
            <button
              type="button"
              disabled
              className="w-full py-1.5 text-xs font-medium text-muted-foreground bg-black/20 cursor-not-allowed"
            >
              Change image — coming soon
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="game-settings-name">Name</Label>
          <Input
            id="game-settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Game name"
            className="mt-1.5"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="game-settings-min-bet">Min bet</Label>
            <Input
              id="game-settings-min-bet"
              type="number"
              min={0}
              step="any"
              value={minBetText}
              onChange={(e) => setMinBetText(e.target.value)}
              className="mt-1.5"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div>
            <Label htmlFor="game-settings-max-bet">Max bet</Label>
            <Input
              id="game-settings-max-bet"
              type="number"
              min={0}
              step="any"
              value={maxBetText}
              onChange={(e) => setMaxBetText(e.target.value)}
              className="mt-1.5"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          {!betRangeValid && (
            <p className="col-span-2 text-xs text-destructive">
              Min bet must be positive and max bet must be at least the min bet.
            </p>
          )}
        </div>

        {isSlots && (
          <div>
            <Label>Reward Mode</Label>
            <div className="mt-1.5 grid grid-cols-1 gap-2">
              {REWARD_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setRewardMode(mode.id)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                    rewardMode === mode.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  <p className="text-sm font-medium">{mode.label}</p>
                  <p className="text-xs text-muted-foreground">{mode.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !trimmed || !betRangeValid}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/GameSettingsModal.tsx
git commit -m "feat(slots): add Reward Mode picker to the game settings modal"
```

---

### Task 7: `Slots.tsx` — full-board rendering

**Files:**
- Modify: `src/components/games/Slots.tsx`

- [ ] **Step 1: Update imports and add the full-board client paytable + helpers**

Replace lines 1-46 (imports through the `roundMoney` helper) with:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { formatChips } from "../../lib/utils";
import { playWinChime } from "../../lib/sound";
import { useSlots } from "../../hooks/useSlots";
import type { SlotSymbolId, SlotReel, SlotWin, FullBoardSlotWin } from "../../types";

type RewardMode = "single_row" | "full_board";
type AnySlotWin = (SlotWin | FullBoardSlotWin) & { amount: number };

// Mirrors supabase/functions/slots/engine.ts's SYMBOLS — kept as a local,
// dependency-free copy (same pattern as Dice/Roulette) purely for rendering
// and the paytable display. The server never trusts anything from here; it
// recomputes the real outcome and payout itself.
interface ClientSymbol {
  id: SlotSymbolId;
  cls: string;
  label: string;
  pay: { 3: number; 4: number; 5: number };
}
const CLIENT_SYMBOLS: ClientSymbol[] = [
  { id: "dot", cls: "sl-sym-dot", label: "", pay: { 3: 1, 4: 3, 5: 33 } },
  { id: "square", cls: "sl-sym-square", label: "", pay: { 3: 1.5, 4: 4.5, 5: 48 } },
  { id: "diamond", cls: "sl-sym-diamond", label: "", pay: { 3: 2, 4: 6.5, 5: 70 } },
  { id: "star", cls: "sl-sym-star", label: "", pay: { 3: 2.5, 4: 11, 5: 115 } },
  { id: "seven", cls: "sl-sym-seven", label: "7", pay: { 3: 4.5, 4: 19, 5: 240 } },
];
const SYMBOL_BY_ID = Object.fromEntries(CLIENT_SYMBOLS.map((s) => [s.id, s])) as Record<SlotSymbolId, ClientSymbol>;

// Mirrors supabase/functions/slots/engine.ts's FULL_BOARD_SYMBOLS — pay at
// tier 0 (7-8 cells), tier 1 (9-10 cells), tier 2 (11-15 cells).
interface ClientFullBoardSymbol {
  id: SlotSymbolId;
  cls: string;
  label: string;
  pay: [number, number, number];
}
const CLIENT_FULL_BOARD_SYMBOLS: ClientFullBoardSymbol[] = [
  { id: "dot", cls: "sl-sym-dot", label: "", pay: [1.46, 7.31, 58.46] },
  { id: "square", cls: "sl-sym-square", label: "", pay: [2.19, 10.23, 80.38] },
  { id: "diamond", cls: "sl-sym-diamond", label: "", pay: [2.92, 14.61, 116.92] },
  { id: "star", cls: "sl-sym-star", label: "", pay: [4.38, 21.92, 189.99] },
  { id: "seven", cls: "sl-sym-seven", label: "7", pay: [7.31, 36.54, 379.98] },
];

// Maps a win's raw count to the existing 3/4/5 CSS win-tier hooks
// (sl-win-tier-3/4/5), so full-board reuses the same banner/shake styling
// as single-row without any new CSS.
function winTier(rewardMode: RewardMode, count: number): 3 | 4 | 5 {
  if (rewardMode === "full_board") {
    if (count >= 11) return 5;
    if (count >= 9) return 4;
    return 3;
  }
  return count >= 5 ? 5 : count === 4 ? 4 : 3;
}

function randomSymbolId(): SlotSymbolId {
  return CLIENT_SYMBOLS[Math.floor(Math.random() * CLIENT_SYMBOLS.length)].id;
}

// Reel-drop timing: each reel starts REEL_STAGGER_MS after the previous one
// and takes REEL_DROP_MS to land — must match the CSS animation-duration /
// animation-delay values in SlotsStyles below. The true outcome (and the
// balance credit for any payout) isn't revealed until this has fully played.
const REEL_STAGGER_MS = 140;
const REEL_DROP_MS = 950;
const REVEAL_MS = 4 * REEL_STAGGER_MS + REEL_DROP_MS + 140; // last reel's delay + duration + buffer

const PARTICLE_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
```

- [ ] **Step 2: Add the `rewardMode`/`gameId` props and update component state**

Replace (the `Props` interface through the `betValid` line):

```tsx
interface Props {
  casinoId: string;
  gameId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Slots({ casinoId, gameId, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { loading, error: spinError, spin: spinSlots } = useSlots(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reels, setReels] = useState<SlotReel[]>(() =>
    Array.from({ length: 5 }, () => ({ top: randomSymbolId(), mid: randomSymbolId(), bottom: randomSymbolId() }))
  );
  const [strips, setStrips] = useState<SlotSymbolId[][]>([]);
  const [win, setWin] = useState<(SlotWin & { amount: number }) | null>(null);
  const [winId, setWinId] = useState(0);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

with:

```tsx
interface Props {
  casinoId: string;
  gameId: string;
  rewardMode: RewardMode;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Slots({ casinoId, gameId, rewardMode, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { loading, error: spinError, spin: spinSlots } = useSlots(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reels, setReels] = useState<SlotReel[]>(() =>
    Array.from({ length: 5 }, () => ({ top: randomSymbolId(), mid: randomSymbolId(), bottom: randomSymbolId() }))
  );
  const [strips, setStrips] = useState<SlotSymbolId[][]>([]);
  const [win, setWin] = useState<AnySlotWin | null>(null);
  const [winId, setWinId] = useState(0);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 3: Set the win in `handleSpin`, and compute the win tier / lit-cell set**

Replace:

```tsx
        if (res.win) {
          setWinId((id) => id + 1);
          setWin({ ...res.win, amount: res.payout });
          playWinChime();
        }
        setSpinning(false);
      }, REVEAL_MS);
    } catch (err) {
      setLocalBalance((b) => b + stake); // roll back the optimistic deduction
      setFormError(err instanceof Error ? err.message : "Spin failed");
    }
  }

  const winMessage = win ? (win.count >= 5 ? "MEGA WIN" : win.count === 4 ? "BIG WIN" : "WIN") : "";
```

with:

```tsx
        if (res.win) {
          setWinId((id) => id + 1);
          setWin({ ...res.win, amount: res.payout } as AnySlotWin);
          playWinChime();
        }
        setSpinning(false);
      }, REVEAL_MS);
    } catch (err) {
      setLocalBalance((b) => b + stake); // roll back the optimistic deduction
      setFormError(err instanceof Error ? err.message : "Spin failed");
    }
  }

  const tier = win ? winTier(rewardMode, win.count) : null;
  const winMessage = tier === 5 ? "MEGA WIN" : tier === 4 ? "BIG WIN" : tier === 3 ? "WIN" : "";

  // Full-board wins light up cells on any row; build a lookup once per win
  // rather than re-scanning positions per cell.
  const fullBoardLit = useMemo(() => {
    if (!win || rewardMode !== "full_board") return null;
    return new Set((win as FullBoardSlotWin).positions.map((p) => `${p.reel}:${p.row}`));
  }, [win, rewardMode]);
```

- [ ] **Step 4: Update the reels grid to highlight the right cells per mode**

Replace:

```tsx
            <div className="sl-reels">
              {reels.map((reel, i) => {
                const isLit = Boolean(win && win.positions.includes(i));
                const strip = strips[i];
                return (
                  <div className="sl-reel" key={i}>
                    {spinning && strip ? (
                      <div className="sl-reel-strip sl-spin">
                        {strip.map((sym, k) => (
                          <div className="sl-cell" key={k}>
                            <span className={`sl-sym ${SYMBOL_BY_ID[sym].cls}`}>{SYMBOL_BY_ID[sym].label}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sl-reel-static">
                        <div className="sl-cell">
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.top].cls}`}>{SYMBOL_BY_ID[reel.top].label}</span>
                        </div>
                        <div className={`sl-cell sl-mid ${isLit ? "sl-lit" : ""}`}>
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.mid].cls}`}>{SYMBOL_BY_ID[reel.mid].label}</span>
                        </div>
                        <div className="sl-cell">
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.bottom].cls}`}>{SYMBOL_BY_ID[reel.bottom].label}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {win && (
              <div key={winId} className={`sl-win-tier-${win.count}`}>
```

with:

```tsx
            <div className="sl-reels">
              {reels.map((reel, i) => {
                const isLitTop = rewardMode === "full_board" && Boolean(fullBoardLit?.has(`${i}:top`));
                const isLitMid =
                  rewardMode === "full_board"
                    ? Boolean(fullBoardLit?.has(`${i}:mid`))
                    : Boolean(win && (win as SlotWin).positions.includes(i));
                const isLitBottom = rewardMode === "full_board" && Boolean(fullBoardLit?.has(`${i}:bottom`));
                const strip = strips[i];
                return (
                  <div className="sl-reel" key={i}>
                    {spinning && strip ? (
                      <div className="sl-reel-strip sl-spin">
                        {strip.map((sym, k) => (
                          <div className="sl-cell" key={k}>
                            <span className={`sl-sym ${SYMBOL_BY_ID[sym].cls}`}>{SYMBOL_BY_ID[sym].label}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sl-reel-static">
                        <div className={`sl-cell ${isLitTop ? "sl-lit" : ""}`}>
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.top].cls}`}>{SYMBOL_BY_ID[reel.top].label}</span>
                        </div>
                        <div className={`sl-cell sl-mid ${isLitMid ? "sl-lit" : ""}`}>
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.mid].cls}`}>{SYMBOL_BY_ID[reel.mid].label}</span>
                        </div>
                        <div className={`sl-cell ${isLitBottom ? "sl-lit" : ""}`}>
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.bottom].cls}`}>{SYMBOL_BY_ID[reel.bottom].label}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {win && (
              <div key={winId} className={`sl-win-tier-${tier}`}>
```

- [ ] **Step 5: Switch the paytable sidebar per mode**

Replace:

```tsx
          <div className="mt-2 space-y-1.5">
            <p className="text-xs text-muted-foreground">Paytable (3× · 4× · 5×)</p>
            {CLIENT_SYMBOLS.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-xs">
                <span className="sl-sym-mini">
                  <span className={`sl-sym ${s.cls}`}>{s.label}</span>
                </span>
                <span className="text-muted-foreground font-mono">
                  {s.pay[3]}x · {s.pay[4]}x · {s.pay[5]}x
                </span>
              </div>
            ))}
          </div>
```

with:

```tsx
          <div className="mt-2 space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {rewardMode === "full_board" ? "Paytable (7-8 · 9-10 · 11+)" : "Paytable (3× · 4× · 5×)"}
            </p>
            {rewardMode === "full_board"
              ? CLIENT_FULL_BOARD_SYMBOLS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="sl-sym-mini">
                      <span className={`sl-sym ${s.cls}`}>{s.label}</span>
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {s.pay[0]}x · {s.pay[1]}x · {s.pay[2]}x
                    </span>
                  </div>
                ))
              : CLIENT_SYMBOLS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="sl-sym-mini">
                      <span className={`sl-sym ${s.cls}`}>{s.label}</span>
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {s.pay[3]}x · {s.pay[4]}x · {s.pay[5]}x
                    </span>
                  </div>
                ))}
          </div>
```

- [ ] **Step 6: Generalize the lit-cell CSS to any row, not just mid**

In the `SlotsStyles` component, replace:

```css
      .sl-cell.sl-mid { position: relative; }
      .sl-cell.sl-mid.sl-lit { background: rgba(255, 224, 130, 0.14); box-shadow: inset 0 0 0 2px #ff5fd1; }
```

with:

```css
      .sl-cell.sl-mid { position: relative; }
      .sl-cell.sl-lit { background: rgba(255, 224, 130, 0.14); box-shadow: inset 0 0 0 2px #ff5fd1; }
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `src/components/games/Slots.tsx` (Task 8 will fix the now-missing `rewardMode` prop at the `<Slots>` call site).

- [ ] **Step 8: Commit**

```bash
git add src/components/games/Slots.tsx
git commit -m "feat(slots): render full-board paytable and cell highlighting"
```

---

### Task 8: `CasinoDashboard.tsx` — wire it together

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx`

- [ ] **Step 1: Import the new type**

Replace:

```tsx
import type { CasinoMemberWithProfile, GameType, CasinoGame, Casino } from "../types";
```

with:

```tsx
import type { CasinoMemberWithProfile, GameType, CasinoGame, Casino, SlotsInstanceSettings } from "../types";
```

- [ ] **Step 2: Thread `settings` through the `onCreate`/`onUpdate` handlers passed to `SettingsTab`**

Replace:

```tsx
              onCreate={async (typeId, customName, minBet, maxBet) => {
                const newGame = await createGame(currentCasino.id, typeId, customName, minBet, maxBet);
                setCasinoGames((prev) => [...prev, newGame]);
              }}
              onUpdate={async (id, customName, minBet, maxBet) => {
                const updated = await updateGame(id, customName, minBet, maxBet);
                setCasinoGames((prev) => prev.map((g) => (g.id === id ? updated : g)));
              }}
```

with:

```tsx
              onCreate={async (typeId, customName, minBet, maxBet, settings) => {
                const newGame = await createGame(currentCasino.id, typeId, customName, minBet, maxBet, settings);
                setCasinoGames((prev) => [...prev, newGame]);
              }}
              onUpdate={async (id, customName, minBet, maxBet, settings) => {
                const updated = await updateGame(id, customName, minBet, maxBet, settings);
                setCasinoGames((prev) => prev.map((g) => (g.id === id ? updated : g)));
              }}
```

- [ ] **Step 3: Pass `rewardMode` to `<Slots>`**

Replace:

```tsx
          {activeGame.game_type_id === "slots" && (
            <Slots
              casinoId={currentCasino.id}
              gameId={activeGame.id}
              balance={membership?.balance ?? 0}
              minBet={activeGame.min_bet}
              maxBet={activeGame.max_bet}
              onExit={() => setActiveGame(null)}
            />
          )}
```

with:

```tsx
          {activeGame.game_type_id === "slots" && (
            <Slots
              casinoId={currentCasino.id}
              gameId={activeGame.id}
              rewardMode={
                (activeGame.settings as SlotsInstanceSettings)?.rewardMode === "full_board"
                  ? "full_board"
                  : "single_row"
              }
              balance={membership?.balance ?? 0}
              minBet={activeGame.min_bet}
              maxBet={activeGame.max_bet}
              onExit={() => setActiveGame(null)}
            />
          )}
```

- [ ] **Step 4: Update `SettingsTab`'s prop types**

Replace:

```tsx
  onCreate: (typeId: string, customName: string, minBet: number, maxBet: number) => Promise<void>;
  onUpdate: (id: string, customName: string, minBet: number, maxBet: number) => Promise<void>;
```

with:

```tsx
  onCreate: (
    typeId: string,
    customName: string,
    minBet: number,
    maxBet: number,
    settings: Record<string, unknown>
  ) => Promise<void>;
  onUpdate: (
    id: string,
    customName: string,
    minBet: number,
    maxBet: number,
    settings: Record<string, unknown>
  ) => Promise<void>;
```

- [ ] **Step 5: Wire the new `GameSettingsModal` props at its call site**

Replace:

```tsx
          <GameSettingsModal
            title={gameModal.mode === "create" ? `Add ${gameModal.gameType.name}` : `Edit ${gameModal.game.custom_name}`}
            imageUrl={GAME_ART[gameModal.mode === "create" ? gameModal.gameType.id : gameModal.game.game_type_id]}
            initialName={gameModal.mode === "create" ? gameModal.gameType.name : gameModal.game.custom_name}
            initialMinBet={gameModal.mode === "create" ? gameModal.gameType.min_bet : gameModal.game.min_bet}
            initialMaxBet={gameModal.mode === "create" ? gameModal.gameType.max_bet : gameModal.game.max_bet}
            onSave={async (name, minBet, maxBet) => {
              if (gameModal.mode === "create") {
                await onCreate(gameModal.gameType.id, name, minBet, maxBet);
              } else {
                await onUpdate(gameModal.game.id, name, minBet, maxBet);
              }
              setGameModal(null);
            }}
            onClose={() => setGameModal(null)}
          />
```

with:

```tsx
          <GameSettingsModal
            title={gameModal.mode === "create" ? `Add ${gameModal.gameType.name}` : `Edit ${gameModal.game.custom_name}`}
            imageUrl={GAME_ART[gameModal.mode === "create" ? gameModal.gameType.id : gameModal.game.game_type_id]}
            gameTypeId={gameModal.mode === "create" ? gameModal.gameType.id : gameModal.game.game_type_id}
            initialName={gameModal.mode === "create" ? gameModal.gameType.name : gameModal.game.custom_name}
            initialMinBet={gameModal.mode === "create" ? gameModal.gameType.min_bet : gameModal.game.min_bet}
            initialMaxBet={gameModal.mode === "create" ? gameModal.gameType.max_bet : gameModal.game.max_bet}
            initialSettings={gameModal.mode === "create" ? {} : gameModal.game.settings}
            onSave={async (name, minBet, maxBet, settings) => {
              if (gameModal.mode === "create") {
                await onCreate(gameModal.gameType.id, name, minBet, maxBet, settings);
              } else {
                await onUpdate(gameModal.game.id, name, minBet, maxBet, settings);
              }
              setGameModal(null);
            }}
            onClose={() => setGameModal(null)}
          />
```

- [ ] **Step 6: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "feat(slots): wire reward mode setting through the dashboard"
```

---

### Task 9: Manual verification (Playwright)

Use the seeded test admin account from `CLAUDE.md` (`claudetest.cassie@gmail.com` / `ClaudeTest123!`).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)

- [ ] **Step 2: Run the full automated test suite once more**

Run: `npx vitest run`
Expected: PASS, no regressions in any engine test file.

- [ ] **Step 3: Verify the create flow**

Via Playwright/Chrome: log in, open a casino's Settings tab → Games, click "+ Add" on Slot Machine. Confirm the "Reward Mode" picker appears with "Single row reward" selected by default, select "Full board reward", save. Confirm the new instance appears in the list.

- [ ] **Step 4: Verify full-board play**

Open the new instance, spin repeatedly (raise the bet if needed to spin faster/more) until a win lands. Confirm:
- The paytable sidebar shows the 7-8/9-10/11+ tiers, not 3×/4×/5×.
- On a win, cells light up on whichever rows actually matched (not only the middle row).
- The WIN/BIG WIN/MEGA WIN banner and amount display correctly.
- Balance deducts the bet instantly on spin, and only reflects any payout once the reel-drop animation finishes (must not regress from current single-row behavior).

- [ ] **Step 5: Verify single-row still works unmodified**

Edit the instance back to "Single row reward" (or play an existing single-row instance), spin a few times, confirm identical behavior to before this change — 3/4/5-of-a-kind on the mid row only, paytable shows 3×/4×/5×.

- [ ] **Step 6: Verify persistence**

Refresh the page. Confirm the instance's Reward Mode (in the edit modal) still shows what was last saved — confirms the DB write, not just local state.

- [ ] **Step 7: Report results**

No commit for this task — it's verification only. If any step fails, stop and fix the relevant task before proceeding.
