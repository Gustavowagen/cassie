# Daily Spin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the lobby's inert "Daily spin" promo card into a real, server-authoritative prize wheel whose slices a casino owner defines under a new **Special Features** settings category.

**Architecture:** A Deno-free, Supabase-free `engine.ts` holds all config validation, weighted picking and expected-value maths; it is re-exported to the client so the owner's settings preview and the server run literally the same code. The edge function picks the prize and hands the amount to a `security definer` plpgsql function that credits the balance under a row lock and writes the ledger row atomically. Config lives in the existing `casinos.settings` jsonb; cooldown state is one new column on `casino_members`.

**Tech Stack:** Vite + React 18 + TypeScript, Supabase (Postgres + Deno edge functions), Tailwind, Zustand, vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-daily-spin-design.md`

## Global Constraints

- **Money is `numeric(16,4)`.** Every chip amount passes through `roundMoney(n) = Math.round((n + Number.EPSILON) * 10000) / 10000`. Never use `bigint` reasoning.
- **Prizes are chips or nothing, only.** A segment paying `0` is "Nothing" and is a valid, expected outcome. No buffs, no free-spin credits, no "spin again".
- **The default wheel ships `enabled: false`.** No existing casino may show the card until an owner opts in.
- **Segment count is 3–12.** Weight floor is **1, never 0** (a 0-weight slice is visible but unwinnable, which reads as a bug).
- **`resolveDailySpin` never throws.** Malformed jsonb must degrade to the default wheel, never take the lobby down.
- **Ledger rows use `game_type_id: null`** so a spin stays out of per-game stats (the stats RPCs filter `game_type_id IS NOT NULL`).
- **Reveal rule (from CLAUDE.md):** the server decides before the animation, but no result — including the balance — may be shown until the wheel's `transitionend` fires. A Nothing result gets **no banner, no modal, no loss text**; a prize gets a payout pop-in plus a particle burst.
- **Fill sizing (from CLAUDE.md):** the wheel diameter is a CSS `clamp(minPx, Nvw, maxPx)`, checked at ~375px and ~1920px.
- Run tests with `npm test` (vitest). Type-check with `npm run build`.
- **Branch:** this work lives on `daily-spin`, branched from `main`. A concurrent `chip-requests` branch already claims `supabase/migrations/051_chip_requests.sql`, which is why this feature's migration is **052**, not 051. Check for a higher number before applying, and renumber if that branch has landed more migrations in the meantime.

---

### Task 1: Engine — types, default wheel, and `resolveDailySpin`

**Files:**
- Create: `supabase/functions/daily-spin/engine.ts`
- Test: `supabase/functions/daily-spin/engine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DailySpinSegment`, `DailySpinSettings`, `DEFAULT_DAILY_SPIN`, `SEGMENT_PALETTE`, `MIN_SEGMENTS`, `MAX_SEGMENTS`, `roundMoney(n: number): number`, `resolveDailySpin(raw: unknown): DailySpinSettings`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/daily-spin/engine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  resolveDailySpin,
  DEFAULT_DAILY_SPIN,
  MIN_SEGMENTS,
  MAX_SEGMENTS,
} from "./engine";

describe("DEFAULT_DAILY_SPIN", () => {
  it("ships disabled so no existing casino changes", () => {
    expect(DEFAULT_DAILY_SPIN.enabled).toBe(false);
  });
  it("has 8 slices totalling 98 weight", () => {
    expect(DEFAULT_DAILY_SPIN.segments).toHaveLength(8);
    expect(DEFAULT_DAILY_SPIN.segments.reduce((s, x) => s + x.weight, 0)).toBe(98);
  });
  it("includes two Nothing slices", () => {
    expect(DEFAULT_DAILY_SPIN.segments.filter((s) => s.amount === 0)).toHaveLength(2);
  });
});

describe("resolveDailySpin", () => {
  it("falls back to the default wheel for undefined/null/garbage", () => {
    for (const raw of [undefined, null, 42, "nope", [], {}]) {
      expect(resolveDailySpin(raw).segments).toEqual(DEFAULT_DAILY_SPIN.segments);
    }
  });

  it("coerces a non-boolean enabled to false", () => {
    expect(resolveDailySpin({ enabled: "yes" }).enabled).toBe(false);
  });

  it("clamps cooldownHours into 1..168 and floors it to an integer", () => {
    expect(resolveDailySpin({ cooldownHours: 0 }).cooldownHours).toBe(1);
    expect(resolveDailySpin({ cooldownHours: 999 }).cooldownHours).toBe(168);
    expect(resolveDailySpin({ cooldownHours: 12.7 }).cooldownHours).toBe(12);
    expect(resolveDailySpin({ cooldownHours: "x" }).cooldownHours).toBe(24);
  });

  it("truncates title and subtitle to their limits", () => {
    const long = "x".repeat(200);
    expect(resolveDailySpin({ title: long }).title).toHaveLength(32);
    expect(resolveDailySpin({ subtitle: long }).subtitle).toHaveLength(60);
  });

  it("falls back to the default title when the title is blank", () => {
    expect(resolveDailySpin({ title: "   " }).title).toBe(DEFAULT_DAILY_SPIN.title);
  });

  it("falls back to the whole default wheel when fewer than MIN_SEGMENTS survive", () => {
    const two = [
      { id: "a", label: "A", amount: 10, weight: 1, color: "#ff0000" },
      { id: "b", label: "B", amount: 20, weight: 1, color: "#00ff00" },
    ];
    expect(resolveDailySpin({ segments: two }).segments).toEqual(DEFAULT_DAILY_SPIN.segments);
    expect(MIN_SEGMENTS).toBe(3);
  });

  it("truncates a too-long segment list to MAX_SEGMENTS", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      amount: 100,
      weight: 1,
      color: "#123456",
    }));
    expect(resolveDailySpin({ segments: many }).segments).toHaveLength(MAX_SEGMENTS);
    expect(MAX_SEGMENTS).toBe(12);
  });

  it("clamps weight to 1..1000, never 0", () => {
    const raw = {
      segments: [
        { id: "a", label: "A", amount: 0, weight: 0, color: "#ff0000" },
        { id: "b", label: "B", amount: 10, weight: 99999, color: "#00ff00" },
        { id: "c", label: "C", amount: 10, weight: "x", color: "#0000ff" },
      ],
    };
    expect(resolveDailySpin(raw).segments.map((s) => s.weight)).toEqual([1, 1000, 1]);
  });

  it("clamps amount to 0..10_000_000 and rounds to 4dp", () => {
    const raw = {
      segments: [
        { id: "a", label: "A", amount: -5, weight: 1, color: "#ff0000" },
        { id: "b", label: "B", amount: 99e9, weight: 1, color: "#00ff00" },
        { id: "c", label: "C", amount: 1.234567, weight: 1, color: "#0000ff" },
      ],
    };
    expect(resolveDailySpin(raw).segments.map((s) => s.amount)).toEqual([0, 10_000_000, 1.2346]);
  });

  it("derives a label from the amount when blank", () => {
    const raw = {
      segments: [
        { id: "a", label: "  ", amount: 0, weight: 1, color: "#ff0000" },
        { id: "b", label: "", amount: 500, weight: 1, color: "#00ff00" },
        { id: "c", label: "Keep me", amount: 5, weight: 1, color: "#0000ff" },
      ],
    };
    expect(resolveDailySpin(raw).segments.map((s) => s.label)).toEqual([
      "Nothing",
      "500 chips",
      "Keep me",
    ]);
  });

  it("replaces an invalid colour with the palette colour for that index", () => {
    const raw = {
      segments: [
        { id: "a", label: "A", amount: 1, weight: 1, color: "red" },
        { id: "b", label: "B", amount: 1, weight: 1, color: "#ABCDEF" },
        { id: "c", label: "C", amount: 1, weight: 1, color: 7 },
      ],
    };
    const out = resolveDailySpin(raw).segments;
    expect(out[1].color).toBe("#ABCDEF");
    expect(out[0].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(out[2].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("fills in a missing segment id from the index", () => {
    const raw = {
      segments: [
        { label: "A", amount: 1, weight: 1, color: "#ff0000" },
        { id: "", label: "B", amount: 1, weight: 1, color: "#00ff00" },
        { id: "keep", label: "C", amount: 1, weight: 1, color: "#0000ff" },
      ],
    };
    const out = resolveDailySpin(raw).segments;
    expect(out[0].id).toBeTruthy();
    expect(out[1].id).toBeTruthy();
    expect(out[2].id).toBe("keep");
  });

  it("never throws, whatever it is handed", () => {
    const nasty = { enabled: true, segments: [null, undefined, 5, { amount: NaN }] };
    expect(() => resolveDailySpin(nasty)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- daily-spin`
Expected: FAIL — `Failed to resolve import "./engine"`.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/daily-spin/engine.ts`:

```ts
// The Daily Spin engine.
//
// Deliberately free of Deno and Supabase imports so the same module can be
// consumed from the client — see src/lib/dailySpin.ts, which re-exports it.
// That is what stops the owner's settings preview from promising odds the
// server will not actually roll. Mirrors supabase/functions/olympus/engine.ts.
//
// NOTHING here is authoritative on its own: a real claim is resolved by
// supabase/functions/daily-spin/index.ts, which calls into this module.

export interface DailySpinSegment {
  /** Stable key across reorder/edit. Not meaningful to the server. */
  id: string;
  label: string;
  /** Chips awarded. 0 means Nothing — a first-class outcome, not an error. */
  amount: number;
  /** Relative odds within this wheel. Not a percentage. */
  weight: number;
  /** "#rrggbb" slice fill. */
  color: string;
}

export interface DailySpinSettings {
  enabled: boolean;
  title: string;
  subtitle: string;
  cooldownHours: number;
  segments: DailySpinSegment[];
}

export const MIN_SEGMENTS = 3;
export const MAX_SEGMENTS = 12;

const MAX_TITLE = 32;
const MAX_SUBTITLE = 60;
const MAX_LABEL = 24;
const MAX_AMOUNT = 10_000_000;
const MAX_WEIGHT = 1000;
const MIN_COOLDOWN_HOURS = 1;
const MAX_COOLDOWN_HOURS = 168;

const DEFAULT_TITLE = "Daily spin";
const DEFAULT_SUBTITLE = "Spin the wheel for free chips";
const DEFAULT_COOLDOWN_HOURS = 24;

/** Fallback slice colours, indexed by position. */
export const SEGMENT_PALETTE = [
  "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#14b8a6", "#a855f7",
  "#f97316", "#06b6d4", "#84cc16", "#e11d48",
];

/** Money is numeric(16,4) everywhere in this codebase. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * The wheel a casino gets when its owner has never configured one.
 *
 * Tuned to be a nudge, not an income: ~420 chips per spin against a 10,000
 * default starting balance (~4%/day), with roughly a third of spins landing
 * on Nothing. The two Nothing slices sit on opposite arcs so a near-miss on
 * the Jackpot is visually adjacent to a blank.
 *
 * `enabled` is false: the owner opts in.
 */
export const DEFAULT_DAILY_SPIN: DailySpinSettings = {
  enabled: false,
  title: DEFAULT_TITLE,
  subtitle: DEFAULT_SUBTITLE,
  cooldownHours: DEFAULT_COOLDOWN_HOURS,
  segments: [
    { id: "nothing-1", label: "Nothing",       amount: 0,      weight: 18, color: "#475569" },
    { id: "pocket",    label: "Pocket change", amount: 100,    weight: 22, color: "#3b82f6" },
    { id: "small",     label: "Small stack",   amount: 250,    weight: 18, color: "#10b981" },
    { id: "nothing-2", label: "Nothing",       amount: 0,      weight: 14, color: "#64748b" },
    { id: "lucky",     label: "Lucky handful", amount: 500,    weight: 13, color: "#8b5cf6" },
    { id: "big",       label: "Big stack",     amount: 1000,   weight: 8,  color: "#ec4899" },
    { id: "high",      label: "High roller",   amount: 2500,   weight: 4,  color: "#f59e0b" },
    { id: "jackpot",   label: "Jackpot",       amount: 10000,  weight: 1,  color: "#facc15" },
  ],
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function text(raw: unknown, max: number, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function resolveSegment(raw: unknown, index: number): DailySpinSegment | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const amountRaw = typeof rec.amount === "number" && isFinite(rec.amount) ? rec.amount : 0;
  const amount = roundMoney(Math.min(MAX_AMOUNT, Math.max(0, amountRaw)));

  // Weight floors at 1, never 0: a zero-weight slice is visible on the wheel
  // and can never be won, which reads to a player as a bug.
  const weight = clampInt(rec.weight, 1, MAX_WEIGHT, 1);

  const fallbackLabel = amount === 0 ? "Nothing" : `${amount} chips`;
  const label = text(rec.label, MAX_LABEL, fallbackLabel);

  const color =
    typeof rec.color === "string" && /^#[0-9a-f]{6}$/i.test(rec.color.trim())
      ? rec.color.trim()
      : SEGMENT_PALETTE[index % SEGMENT_PALETTE.length];

  const id = text(rec.id, 64, `seg-${index}`);

  return { id, label, amount, weight, color };
}

/**
 * Sanitizes anything at all into a valid config. Never throws — a malformed
 * `casinos.settings` jsonb must degrade to the default wheel rather than take
 * the lobby down. This is the authoritative gate: even if the settings UI were
 * bypassed, an out-of-range value is coerced rather than trusted.
 */
export function resolveDailySpin(raw: unknown): DailySpinSettings {
  const rec = asRecord(raw);
  if (!rec) return DEFAULT_DAILY_SPIN;

  const rawSegments = Array.isArray(rec.segments) ? rec.segments : [];
  const segments = rawSegments
    .slice(0, MAX_SEGMENTS)
    .map(resolveSegment)
    .filter((s): s is DailySpinSegment => s !== null);

  return {
    enabled: rec.enabled === true,
    title: text(rec.title, MAX_TITLE, DEFAULT_TITLE),
    subtitle: text(rec.subtitle, MAX_SUBTITLE, DEFAULT_SUBTITLE),
    cooldownHours: clampInt(
      rec.cooldownHours,
      MIN_COOLDOWN_HOURS,
      MAX_COOLDOWN_HOURS,
      DEFAULT_COOLDOWN_HOURS
    ),
    // Too few usable slices is not a wheel. Fall back wholesale rather than
    // padding, so the owner sees an obviously-default wheel and not a hybrid.
    segments: segments.length >= MIN_SEGMENTS ? segments : DEFAULT_DAILY_SPIN.segments,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- daily-spin`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/daily-spin/engine.ts supabase/functions/daily-spin/engine.test.ts
git commit -m "feat(daily-spin): add engine config types, default wheel and resolver"
```

---

### Task 2: Engine — `pickSegment`, `expectedValue`, `nothingChance`, `nextSpinAt`

**Files:**
- Modify: `supabase/functions/daily-spin/engine.ts` (append)
- Test: `supabase/functions/daily-spin/engine.test.ts` (append)

**Interfaces:**
- Consumes: `DailySpinSettings`, `DEFAULT_DAILY_SPIN`, `resolveDailySpin` from Task 1.
- Produces: `pickSegment(config: DailySpinSettings, rng: () => number): number`, `expectedValue(config: DailySpinSettings): number`, `nothingChance(config: DailySpinSettings): number`, `nextSpinAt(lastSpinAt: string | null, cooldownHours: number): Date | null`.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/daily-spin/engine.test.ts` (and extend the import at the top of the file to include `pickSegment`, `expectedValue`, `nothingChance`, `nextSpinAt`):

```ts
describe("pickSegment", () => {
  const wheel = resolveDailySpin({
    segments: [
      { id: "a", label: "A", amount: 0, weight: 1, color: "#111111" },
      { id: "b", label: "B", amount: 10, weight: 2, color: "#222222" },
      { id: "c", label: "C", amount: 20, weight: 7, color: "#333333" },
    ],
  });

  it("returns index 0 when rng is 0", () => {
    expect(pickSegment(wheel, () => 0)).toBe(0);
  });

  it("returns the last index when rng is just under 1", () => {
    expect(pickSegment(wheel, () => 0.9999999)).toBe(2);
  });

  it("clamps to the last index if rng ever returns exactly 1", () => {
    expect(pickSegment(wheel, () => 1)).toBe(2);
  });

  it("respects cumulative weight boundaries", () => {
    // total weight 10 -> [0,1) = A, [1,3) = B, [3,10) = C
    expect(pickSegment(wheel, () => 0.05)).toBe(0);
    expect(pickSegment(wheel, () => 0.15)).toBe(1);
    expect(pickSegment(wheel, () => 0.29)).toBe(1);
    expect(pickSegment(wheel, () => 0.31)).toBe(2);
  });

  it("produces a distribution matching the configured weights", () => {
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const counts = [0, 0, 0];
    const draws = 100_000;
    for (let i = 0; i < draws; i++) counts[pickSegment(wheel, rng)]++;
    expect(counts[0] / draws).toBeCloseTo(0.1, 2);
    expect(counts[1] / draws).toBeCloseTo(0.2, 2);
    expect(counts[2] / draws).toBeCloseTo(0.7, 2);
  });
});

describe("expectedValue / nothingChance", () => {
  it("matches the documented default wheel figures", () => {
    expect(expectedValue(DEFAULT_DAILY_SPIN)).toBeCloseTo(41200 / 98, 6);
    expect(nothingChance(DEFAULT_DAILY_SPIN)).toBeCloseTo(32 / 98, 6);
  });

  it("an all-zero wheel is 0 EV and 100% nothing", () => {
    const blank = resolveDailySpin({
      segments: [
        { id: "a", label: "A", amount: 0, weight: 1, color: "#111111" },
        { id: "b", label: "B", amount: 0, weight: 5, color: "#222222" },
        { id: "c", label: "C", amount: 0, weight: 2, color: "#333333" },
      ],
    });
    expect(expectedValue(blank)).toBe(0);
    expect(nothingChance(blank)).toBe(1);
  });

  it("weights the average, not a plain mean", () => {
    const wheel = resolveDailySpin({
      segments: [
        { id: "a", label: "A", amount: 0, weight: 9, color: "#111111" },
        { id: "b", label: "B", amount: 100, weight: 1, color: "#222222" },
        { id: "c", label: "C", amount: 0, weight: 10, color: "#333333" },
      ],
    });
    expect(expectedValue(wheel)).toBeCloseTo(5, 6);
    expect(nothingChance(wheel)).toBeCloseTo(0.95, 6);
  });
});

describe("nextSpinAt", () => {
  it("returns null when the member has never spun", () => {
    expect(nextSpinAt(null, 24)).toBeNull();
  });

  it("returns null once the cooldown has fully elapsed", () => {
    const long = new Date(Date.now() - 48 * 3600_000).toISOString();
    expect(nextSpinAt(long, 24)).toBeNull();
  });

  it("returns the unlock time while still cooling down", () => {
    const anHourAgo = new Date(Date.now() - 3600_000);
    const at = nextSpinAt(anHourAgo.toISOString(), 24);
    expect(at).not.toBeNull();
    expect(at!.getTime()).toBeCloseTo(anHourAgo.getTime() + 24 * 3600_000, -3);
  });

  it("treats an unparseable timestamp as never spun", () => {
    expect(nextSpinAt("not a date", 24)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- daily-spin`
Expected: FAIL — `pickSegment is not a function` (and the same for the other three).

- [ ] **Step 3: Write minimal implementation**

Append to `supabase/functions/daily-spin/engine.ts`:

```ts
/**
 * Weighted pick. Walks the cumulative weights and returns the first index
 * whose running total passes `rng() * totalWeight`, clamping to the last
 * index so an `rng()` of exactly 1 cannot fall off the end.
 */
export function pickSegment(config: DailySpinSettings, rng: () => number): number {
  const total = config.segments.reduce((sum, s) => sum + s.weight, 0);
  const roll = rng() * total;
  let running = 0;
  for (let i = 0; i < config.segments.length; i++) {
    running += config.segments[i].weight;
    if (roll < running) return i;
  }
  return config.segments.length - 1;
}

/**
 * Mean chips per spin. This is the settings editor's OP-check, which is why
 * it lives here rather than in the edge function alone — the owner's preview
 * and the server's wheel have to be computed from the same numbers.
 */
export function expectedValue(config: DailySpinSettings): number {
  const total = config.segments.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) return 0;
  const weighted = config.segments.reduce((sum, s) => sum + s.amount * s.weight, 0);
  return weighted / total;
}

/** Odds of landing a 0-chip slice, 0–1. */
export function nothingChance(config: DailySpinSettings): number {
  const total = config.segments.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) return 1;
  const blank = config.segments.reduce((sum, s) => sum + (s.amount === 0 ? s.weight : 0), 0);
  return blank / total;
}

/**
 * When the next spin unlocks, or null if one is available right now.
 * An absent or unparseable timestamp means "never spun" — available.
 */
export function nextSpinAt(lastSpinAt: string | null, cooldownHours: number): Date | null {
  if (!lastSpinAt) return null;
  const last = new Date(lastSpinAt).getTime();
  if (!isFinite(last)) return null;
  const unlock = last + cooldownHours * 3600_000;
  return unlock > Date.now() ? new Date(unlock) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- daily-spin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/daily-spin/engine.ts supabase/functions/daily-spin/engine.test.ts
git commit -m "feat(daily-spin): add weighted pick, expected value and cooldown maths"
```

---

### Task 3: Migration — cooldown column and `claim_daily_spin` RPC

**Files:**
- Create: `supabase/migrations/052_daily_spin.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `casino_members.last_daily_spin_at timestamptz`; `public.claim_daily_spin(p_casino_id uuid, p_user_id uuid, p_amount numeric, p_cooldown_hours int, p_description text) returns numeric` — returns the new balance, or `null` when the cooldown has not elapsed. Callable **only** by `service_role`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/052_daily_spin.sql`:

```sql
-- Daily Spin. Config lives in casinos.settings->'specialFeatures'->'dailySpin'
-- (jsonb, no schema change needed). The only state a cooldown needs is the
-- last claim time; per-claim history is already the transactions row.

alter table public.casino_members
  add column if not exists last_daily_spin_at timestamptz;

-- Credits an already-chosen daily spin prize.
--
-- The prize itself is picked in TypeScript (supabase/functions/daily-spin),
-- so this function knows nothing about wheels or odds -- it only moves money,
-- atomically, behind the cooldown guard.
--
-- `balance = balance + p_amount` rather than a value computed by the caller:
-- every game function in this codebase reads a balance and writes back a
-- number derived from it, which is safe there because a player has one round
-- in flight at a time. A daily spin can land while a game round is resolving,
-- so the increment is done here, against the current row, under its lock.
create or replace function public.claim_daily_spin(
  p_casino_id uuid,
  p_user_id uuid,
  p_amount numeric(16,4),
  p_cooldown_hours int,
  p_description text
)
returns numeric(16,4)
language plpgsql security definer
set search_path = public
as $$
declare
  v_balance numeric(16,4);
begin
  update public.casino_members
     set balance = balance + p_amount,
         last_daily_spin_at = now()
   where casino_id = p_casino_id
     and user_id = p_user_id
     and (last_daily_spin_at is null
          or last_daily_spin_at <= now() - make_interval(hours => p_cooldown_hours))
  returning balance into v_balance;

  -- No row matched: either still cooling down, or not a member. The caller
  -- cannot tell these apart from a null, and does not need to -- it has
  -- already proven membership before getting here, so a null means the
  -- cooldown guard rejected the claim.
  if not found then
    return null;
  end if;

  -- game_type_id is null on purpose: the stats RPCs all filter
  -- `game_type_id is not null`, so a spin stays out of per-game profit/loss.
  -- It is a chip grant, like give_chips, not a wager.
  insert into public.transactions
    (casino_id, user_id, amount, balance_after, game_type_id, description)
  values
    (p_casino_id, p_user_id, p_amount, v_balance, null, p_description);

  return v_balance;
end;
$$;

-- Only the edge function (service-role key) may call this. Without the
-- revoke, any client holding the anon key could award itself any amount.
revoke execute on function public.claim_daily_spin(uuid, uuid, numeric, int, text)
  from public, anon, authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (per CLAUDE.md), name `052_daily_spin`, with the SQL above.

- [ ] **Step 3: Verify the migration landed**

Run this via the Supabase MCP `execute_sql` tool:

```sql
select
  (select count(*) from information_schema.columns
    where table_name = 'casino_members' and column_name = 'last_daily_spin_at') as has_column,
  (select count(*) from pg_proc where proname = 'claim_daily_spin') as has_function,
  has_function_privilege('authenticated', 'public.claim_daily_spin(uuid,uuid,numeric,int,text)', 'execute') as authenticated_can_call;
```

Expected: `has_column = 1`, `has_function = 1`, `authenticated_can_call = false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/052_daily_spin.sql
git commit -m "feat(daily-spin): add cooldown column and claim_daily_spin RPC"
```

---

### Task 4: Edge function

**Files:**
- Create: `supabase/functions/daily-spin/index.ts`

**Interfaces:**
- Consumes: `resolveDailySpin`, `pickSegment`, `nextSpinAt` from `./engine.ts` (Tasks 1–2); `public.claim_daily_spin` from Task 3.
- Produces: `POST /daily-spin { casino_id }` → `{ segmentIndex: number, label: string, amount: number, balance: number, nextSpinAt: string }`.

- [ ] **Step 1: Write the implementation**

Create `supabase/functions/daily-spin/index.ts`. The CORS block, `json()` helper, crypto `rng` and the user-client-for-reads / admin-client-for-writes split are all copied verbatim from `supabase/functions/dice/index.ts`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveDailySpin, pickSegment, nextSpinAt } from "./engine.ts";

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

    const { casino_id } = (await req.json()) as { casino_id: string };
    if (!casino_id) return json({ error: "Missing casino_id" }, 400);

    // Membership (via the user's own client, so RLS proves it) and the
    // casino's settings. Neither depends on the other, so they go together.
    const [{ data: member }, { data: casino }] = await Promise.all([
      userClient
        .from("casino_members")
        .select("last_daily_spin_at")
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .single(),
      admin.from("casinos").select("settings").eq("id", casino_id).single(),
    ]);
    if (!member) return json({ error: "You are not a member of this casino" }, 403);
    if (!casino) return json({ error: "Casino not found" }, 400);

    const settings = casino.settings as Record<string, unknown> | null;
    const specialFeatures = settings?.specialFeatures as Record<string, unknown> | undefined;
    const config = resolveDailySpin(specialFeatures?.dailySpin);
    if (!config.enabled) {
      return json({ error: "Daily spin is not available in this casino" }, 400);
    }

    // Fast-path reject so an obviously-early claim never touches the write
    // path. claim_daily_spin re-checks authoritatively.
    const pending = nextSpinAt(member.last_daily_spin_at as string | null, config.cooldownHours);
    if (pending) {
      return json(
        { error: "Your next spin isn't ready yet", nextSpinAt: pending.toISOString() },
        429
      );
    }

    const segmentIndex = pickSegment(config, rng);
    const segment = config.segments[segmentIndex];

    const { data: balance, error } = await admin.rpc("claim_daily_spin", {
      p_casino_id: casino_id,
      p_user_id: user.id,
      p_amount: segment.amount,
      p_cooldown_hours: config.cooldownHours,
      p_description: `Daily spin: ${segment.label}`,
    });
    if (error) return json({ error: error.message }, 500);
    // The fast path raced against a concurrent claim and lost. Nothing was
    // credited and nothing was written.
    if (balance === null) {
      return json({ error: "Your next spin isn't ready yet" }, 429);
    }

    return json({
      segmentIndex,
      label: segment.label,
      amount: segment.amount,
      balance: Number(balance),
      nextSpinAt: new Date(Date.now() + config.cooldownHours * 3600_000).toISOString(),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 2: Deploy the function**

Deploy via the Supabase MCP `deploy_edge_function` tool, name `daily-spin`, with both `index.ts` and `engine.ts` as entrypoint files.

- [ ] **Step 3: Verify it rejects a disabled casino**

The feature is off everywhere at this point, so a call must be refused. Sign in as the test account (`claudetest.cassie@gmail.com` / `ClaudeTest123!`) in the running dev server and run in the browser console:

```js
const { data, error } = await window.supabase.functions.invoke("daily-spin", {
  body: { casino_id: "<a casino id the test account is a member of>" },
});
console.log(data, error);
```

Expected: a 400 whose body is `{ error: "Daily spin is not available in this casino" }`.

If `window.supabase` is not exposed, instead temporarily add `(window as any).supabase = supabase;` to the bottom of `src/lib/supabase.ts`, verify, then remove it before committing.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/daily-spin/index.ts
git commit -m "feat(daily-spin): add claim edge function"
```

---

### Task 5: Client types and engine re-export

**Files:**
- Create: `src/lib/dailySpin.ts`
- Modify: `src/types/index.ts:6-10` (the `CasinoSettings` interface)

**Interfaces:**
- Consumes: everything exported by `supabase/functions/daily-spin/engine.ts` (Tasks 1–2).
- Produces: `src/lib/dailySpin.ts` re-exporting the whole engine; `SpecialFeaturesSettings`; `CasinoSettings.specialFeatures?: SpecialFeaturesSettings`; `DailySpinResult`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/dailySpin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_DAILY_SPIN, resolveDailySpin, expectedValue } from "./dailySpin";

describe("dailySpin re-export", () => {
  it("exposes the edge function's engine to the client unchanged", () => {
    expect(DEFAULT_DAILY_SPIN.segments).toHaveLength(8);
    expect(resolveDailySpin(undefined).segments).toEqual(DEFAULT_DAILY_SPIN.segments);
    expect(expectedValue(DEFAULT_DAILY_SPIN)).toBeCloseTo(41200 / 98, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dailySpin`
Expected: FAIL — `Failed to resolve import "./dailySpin"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dailySpin.ts`:

```ts
// The client's view of the Daily Spin engine.
//
// A re-export, not a copy — same treatment as src/lib/olympusEngine.ts, and
// for the same reason: the owner's settings preview shows an average payout
// and a chance-of-nothing figure, and those numbers are worthless if they are
// computed by different code than the server rolls with.
//
// The engine module is deliberately free of Deno and Supabase imports so it
// can be consumed from both sides; see its header.
//
// NOTHING here is authoritative. Every real claim is resolved by
// supabase/functions/daily-spin/index.ts.

export * from "../../supabase/functions/daily-spin/engine.ts";
```

Then in `src/types/index.ts`, replace the `CasinoSettings` interface at lines 6-10 with:

```ts
import type { DailySpinSettings } from "../lib/dailySpin";

/**
 * Owner-configurable features that are not games. A namespace, not a one-off:
 * the next non-game feature an owner can tune goes in here too.
 */
export interface SpecialFeaturesSettings {
  dailySpin?: DailySpinSettings;
}

export interface CasinoSettings {
  startingBalance: number;
  allowPublicJoin: boolean;
  maxMembers: number;
  // Absent on every casino created before Daily Spin shipped. A missing key
  // resolves (via resolveDailySpin) to the default wheel with enabled:false,
  // so nothing appears in an existing lobby until an owner opts in.
  specialFeatures?: SpecialFeaturesSettings;
}

/** Mirror of the daily-spin edge function's success response. */
export interface DailySpinResult {
  /** Which slice the wheel must stop on — chosen by the server, not derived. */
  segmentIndex: number;
  label: string;
  amount: number;
  /** Authoritative balance after the credit. */
  balance: number;
  nextSpinAt: string;
}
```

Note: `src/types/index.ts` already has an `import type` at line 361 for the Olympus engine, so a top-of-file import here matches existing practice. Move the new import to sit with the other imports if the file's lint prefers it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dailySpin` then `npm run build`
Expected: test PASS, build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dailySpin.ts src/lib/dailySpin.test.ts src/types/index.ts
git commit -m "feat(daily-spin): re-export engine to client and add settings types"
```

---

### Task 6: `useDailySpin` hook

**Files:**
- Create: `src/hooks/useDailySpin.ts`

**Interfaces:**
- Consumes: `resolveDailySpin`, `nextSpinAt`, `DailySpinSettings` from `src/lib/dailySpin`; `DailySpinResult` from `src/types`; `supabase` from `src/lib/supabase`.
- Produces: `useDailySpin(casino: Casino | null, lastSpinAt: string | null | undefined)` → `{ config: DailySpinSettings, available: boolean, readyIn: string | null, spinning: boolean, error: string | null, spin: () => Promise<DailySpinResult> }`.

- [ ] **Step 1: Write the implementation**

Create `src/hooks/useDailySpin.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { resolveDailySpin, nextSpinAt, type DailySpinSettings } from "../lib/dailySpin";
import type { Casino, DailySpinResult } from "../types";

/** "7h 12m" / "12m 04s" / "48s" — the promo card's countdown label. */
export function formatReadyIn(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/**
 * Client state for one casino's daily spin: the resolved config, whether a
 * spin is available, and a live countdown when it isn't.
 *
 * `lastSpinAt` comes from the membership row. The server is authoritative on
 * the cooldown — a 429 carries its own `nextSpinAt`, which we adopt, so a
 * client with a skewed clock still converges on the truth.
 */
export function useDailySpin(casino: Casino | null, lastSpinAt: string | null | undefined) {
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server-supplied override, set from a claim response or a 429. Takes
  // precedence over the membership row, which may be a render behind.
  const [serverNextAt, setServerNextAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const config = useMemo(
    () => resolveDailySpin(casino?.settings?.specialFeatures?.dailySpin),
    [casino?.settings]
  );

  const effectiveLast = serverNextAt ? null : lastSpinAt ?? null;
  const unlockAt = useMemo(() => {
    if (serverNextAt) {
      const t = new Date(serverNextAt).getTime();
      return isFinite(t) && t > now ? new Date(t) : null;
    }
    return nextSpinAt(effectiveLast, config.cooldownHours);
  }, [serverNextAt, effectiveLast, config.cooldownHours, now]);

  // Only tick while a cooldown is actually pending — an idle lobby does no work.
  useEffect(() => {
    if (!unlockAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [unlockAt]);

  const available = config.enabled && !unlockAt;
  const readyIn = unlockAt ? formatReadyIn(unlockAt.getTime() - now) : null;

  const spin = useCallback(async (): Promise<DailySpinResult> => {
    if (!casino) throw new Error("No casino");
    setSpinning(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke("daily-spin", {
      body: { casino_id: casino.id },
    });
    setSpinning(false);

    if (fnError) {
      // supabase-js returns non-2xx as FunctionsHttpError; the JSON { error }
      // body lives on error.context (a Response), not on `data`. Mirrors the
      // handling in src/hooks/useDice.ts.
      let message = "Couldn't spin, please try again";
      const ctx = (fnError as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const parsed = await ctx.json();
          if (parsed?.error) message = parsed.error as string;
          // Adopt the server's cooldown so a skewed client clock self-corrects.
          if (parsed?.nextSpinAt) setServerNextAt(parsed.nextSpinAt as string);
        } catch {
          /* keep the fallback message */
        }
      }
      setError(message);
      throw new Error(message);
    }

    const result = data as DailySpinResult;
    setServerNextAt(result.nextSpinAt);
    return result;
  }, [casino]);

  return { config, available, readyIn, spinning, error, spin };
}
```

- [ ] **Step 2: Write the failing test**

Create `src/hooks/useDailySpin.test.ts` — the countdown formatter is the only pure part worth testing directly:

```ts
import { describe, it, expect } from "vitest";
import { formatReadyIn } from "./useDailySpin";

describe("formatReadyIn", () => {
  it("shows hours and padded minutes past an hour", () => {
    expect(formatReadyIn((7 * 3600 + 12 * 60) * 1000)).toBe("7h 12m");
    expect(formatReadyIn((3 * 3600 + 5 * 60) * 1000)).toBe("3h 05m");
  });
  it("shows minutes and padded seconds under an hour", () => {
    expect(formatReadyIn((12 * 60 + 4) * 1000)).toBe("12m 04s");
  });
  it("shows bare seconds under a minute", () => {
    expect(formatReadyIn(48_000)).toBe("48s");
  });
  it("never goes negative", () => {
    expect(formatReadyIn(-5000)).toBe("0s");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- useDailySpin` then `npm run build`
Expected: PASS, build clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useDailySpin.ts src/hooks/useDailySpin.test.ts
git commit -m "feat(daily-spin): add useDailySpin hook with live cooldown countdown"
```

---

### Task 7: `DailySpinWheel` component

**Files:**
- Create: `src/components/DailySpinWheel.tsx`

**Interfaces:**
- Consumes: `DailySpinSettings`, `DailySpinSegment` from `src/lib/dailySpin`; `DailySpinResult` from `src/types`; `formatChips`, `cn` from `src/lib/utils`; `Button` from `src/components/ui/button`.
- Produces: `<DailySpinWheel config spinning readyIn onSpin onClose preview? />` where `onSpin?: () => Promise<DailySpinResult>` and `preview?: boolean`.

- [ ] **Step 1: Write the implementation**

Create `src/components/DailySpinWheel.tsx`:

```tsx
import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { DailySpinSettings, DailySpinSegment } from "../lib/dailySpin";
import type { DailySpinResult } from "../types";
import { cn, formatChips } from "../lib/utils";
import { Button } from "./ui/button";

// Precomputed burst for the win animation (deterministic so every win looks
// intentional rather than random-jittery) — mirrors Mines' GEM_PARTICLES.
const WIN_PARTICLES = Array.from({ length: 12 }, (_, i) => ({
  angle: (i - 5.5) * 15,
  dist: 80 + (i % 3) * 40,
  delay: (i % 4) * 45,
  spin: i % 2 === 0 ? 220 : -220,
}));

const SPIN_MS = 4000;
const MIN_TURNS = 5;

/** SVG arc path for one slice of a circle of radius `r` centred at (50,50). */
function slicePath(startDeg: number, endDeg: number, r = 48): string {
  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const x1 = 50 + r * Math.cos(rad(startDeg));
  const y1 = 50 + r * Math.sin(rad(startDeg));
  const x2 = 50 + r * Math.cos(rad(endDeg));
  const y2 = 50 + r * Math.sin(rad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M 50 50 L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/**
 * Cumulative slice geometry. Every slice is the SAME angular width regardless
 * of weight: the wheel shows what the prizes ARE, not how likely they are.
 * Making rare slices thin would double-count the odds, since the server has
 * already applied the weights when it picked the winner.
 */
function sliceAngles(count: number): { start: number; end: number; mid: number }[] {
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => ({
    start: i * step,
    end: (i + 1) * step,
    mid: i * step + step / 2,
  }));
}

export function DailySpinWheel({
  config,
  spinning,
  readyIn,
  onSpin,
  onClose,
  preview = false,
}: {
  config: DailySpinSettings;
  spinning?: boolean;
  /** Non-null while cooling down; drives the disabled button's label. */
  readyIn?: string | null;
  onSpin?: () => Promise<DailySpinResult>;
  onClose?: () => void;
  /** Static, non-interactive render for the settings preview. */
  preview?: boolean;
}) {
  const [rotation, setRotation] = useState(0);
  const [landed, setLanded] = useState<DailySpinResult | null>(null);
  const [animating, setAnimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);

  const segments = config.segments;
  const angles = sliceAngles(segments.length);

  async function handleSpin() {
    if (!onSpin || animating) return;
    setError(null);
    setLanded(null);
    let result: DailySpinResult;
    try {
      result = await onSpin();
    } catch (e) {
      // Request failed: the wheel never moved, so there is nothing to roll
      // back. Nothing was bet, so no balance was optimistically touched.
      setError(e instanceof Error ? e.message : "Couldn't spin");
      return;
    }

    const slice = 360 / segments.length;
    // Land the winning slice under the pointer at the top, with a little
    // jitter inside the slice so it never stops dead-centre twice running.
    const jitter = (Math.random() - 0.5) * slice * 0.6;
    const target = 360 - (angles[result.segmentIndex].mid + jitter);
    const next = rotation + MIN_TURNS * 360 + ((target - (rotation % 360)) + 360) % 360;

    setAnimating(true);
    setRotation(next);

    // The result — including the balance — is held back until the wheel
    // physically stops. Showing it sooner spoils the landing, which is the
    // whole point of the animation (see CLAUDE.md's reveal rule).
    window.setTimeout(() => {
      setAnimating(false);
      setLanded(result);
    }, SPIN_MS);
  }

  const won = landed !== null && landed.amount > 0;

  return (
    <div className="flex flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">{config.title}</h2>
          <p className="truncate text-xs text-muted-foreground">{config.subtitle}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col items-center gap-4 p-5">
        <div
          className="relative"
          // Grows continuously with the viewport instead of sitting small in a
          // large modal; floors at a usable size on a ~375px phone.
          style={{ width: "clamp(260px, 58vw, 520px)", height: "clamp(260px, 58vw, 520px)" }}
        >
          {/* Pointer, fixed at the top. */}
          <div className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[18px] border-x-transparent border-t-amber-300 drop-shadow" />

          <div
            ref={wheelRef}
            className="h-full w-full"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: animating ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)` : "none",
            }}
          >
            <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-xl">
              {segments.map((seg: DailySpinSegment, i) => (
                <path key={seg.id} d={slicePath(angles[i].start, angles[i].end)} fill={seg.color} />
              ))}
              {segments.map((seg, i) => (
                <text
                  key={`${seg.id}-label`}
                  x="50"
                  y="10"
                  textAnchor="middle"
                  fill="white"
                  fontSize="4.2"
                  fontWeight="700"
                  transform={`rotate(${angles[i].mid} 50 50)`}
                  style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.35)", strokeWidth: 0.9 }}
                >
                  {seg.label}
                </text>
              ))}
              <circle cx="50" cy="50" r="6" fill="#0f172a" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
            </svg>
          </div>

          {/* Win burst + payout pop-in. Nothing renders for a 0-chip landing:
              per CLAUDE.md, a loss shows no banner and no loss text — the
              labelled slice under the pointer is the entire feedback. */}
          {won && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {WIN_PARTICLES.map((p, i) => (
                <span
                  key={i}
                  className="absolute h-2 w-2 rounded-full bg-amber-300"
                  style={{
                    animation: `daily-spin-particle 900ms ${p.delay}ms ease-out forwards`,
                    ["--dsp-angle" as string]: `${p.angle}deg`,
                    ["--dsp-dist" as string]: `${p.dist}px`,
                    ["--dsp-spin" as string]: `${p.spin}deg`,
                  }}
                />
              ))}
              <div className="animate-in zoom-in rounded-xl bg-black/70 px-4 py-2 text-xl font-extrabold text-amber-300 shadow-lg">
                +{formatChips(landed!.amount)}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!preview && (
          <Button
            className="w-full max-w-xs"
            disabled={!!readyIn || animating || spinning || landed !== null}
            onClick={handleSpin}
          >
            {animating || spinning
              ? "Spinning…"
              : landed
              ? "Come back tomorrow"
              : readyIn
              ? `Ready in ${readyIn}`
              : "Spin now"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the particle keyframes**

Append to `src/index.css`:

```css
@keyframes daily-spin-particle {
  from {
    opacity: 1;
    transform: rotate(var(--dsp-angle)) translateY(0) rotate(0deg);
  }
  to {
    opacity: 0;
    transform: rotate(var(--dsp-angle)) translateY(calc(var(--dsp-dist) * -1)) rotate(var(--dsp-spin));
  }
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DailySpinWheel.tsx src/index.css
git commit -m "feat(daily-spin): add prize wheel component with held-back reveal"
```

---

### Task 8: Wire the promo card to the live feature

**Files:**
- Modify: `src/components/lobby/PromoCards.tsx:10-41`
- Modify: `src/components/lobby/GamesLobby.tsx:95` (pass `casino` and `lastSpinAt` to `PromoCards`)
- Modify: `src/pages/CasinoDashboard.tsx` (pass `membership.last_daily_spin_at` into `GamesLobby`)
- Modify: `src/types/index.ts` (`CasinoMember` and `CasinoMemberWithProfile` gain `last_daily_spin_at`)

**Interfaces:**
- Consumes: `useDailySpin` (Task 6), `DailySpinWheel` (Task 7), `Modal` from `src/components/ui/modal`.
- Produces: a live Daily spin card; nothing downstream depends on it.

- [ ] **Step 1: Add the column to the member types**

In `src/types/index.ts`, add to **both** `CasinoMember` and `CasinoMemberWithProfile`:

```ts
  /** Null until the member's first daily spin. Drives the cooldown. */
  last_daily_spin_at: string | null;
```

- [ ] **Step 2: Rewrite the Daily spin card**

In `src/components/lobby/PromoCards.tsx`, replace the component signature and the Daily spin card. The header comment at line 10 is now wrong — Daily spin exists. Replace it:

```tsx
import { useState } from "react";
import type { ReactNode } from "react";
import { Clock, Crown, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { GiftArt, TrophyArt, WheelArt } from "./LobbyArt";
import { ACCENT_CTA, EMERALD_CTA, GLASS, SWIPE_ROW } from "./styles";
import { useDailySpin } from "../../hooks/useDailySpin";
import { DailySpinWheel } from "../DailySpinWheel";
import { Modal } from "../ui/modal";
import type { Casino } from "../../types";

const BUTTON = "mt-auto flex h-[30px] items-center rounded-lg px-3.5 text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50 xl:h-[34px] xl:rounded-[9px] xl:px-4 xl:text-[13px]";

// Daily spin is live and owner-configured (Settings -> Special Features); it
// hides itself entirely when the owner has it switched off. Daily bonus and
// Leaderboard do not exist yet, so their buttons are still inert.
export function PromoCards({
  casino,
  lastSpinAt,
}: {
  casino: Casino;
  lastSpinAt: string | null | undefined;
}) {
  const { config, available, readyIn, spinning, spin } = useDailySpin(casino, lastSpinAt);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={cn(SWIPE_ROW, "gap-2.5 md:mx-0 md:px-0 xl:grid xl:gap-4 xl:overflow-visible", config.enabled ? "xl:grid-cols-3" : "xl:grid-cols-2")}>
        {config.enabled && (
          <PromoCard
            title={config.title}
            subtitle={config.subtitle}
            icon={Sparkles}
            glow="rgba(236,72,153,0.32)"
            action={
              <button
                type="button"
                disabled={!available}
                onClick={() => setOpen(true)}
                className={cn(ACCENT_CTA, BUTTON)}
              >
                {available ? "Spin now" : `Ready in ${readyIn}`}
              </button>
            }
            art={<WheelArt className="-bottom-6 -right-3 h-[112px] w-[112px] -rotate-[14deg] xl:-bottom-[30px] xl:-right-3.5 xl:h-[150px] xl:w-[150px]" />}
          />
        )}
        <PromoCard
          title="Daily bonus"
          subtitle="Free chips every day"
          icon={Clock}
          glow="rgba(16,185,129,0.30)"
          action={<button type="button" className={cn(EMERALD_CTA, BUTTON)}>Claim</button>}
          art={<GiftArt className="-bottom-2.5 -right-0.5 h-[104px] w-[104px] xl:-bottom-3.5 xl:h-[140px] xl:w-[140px]" />}
        />
        <PromoCard
          title="Leaderboard"
          subtitle="See who's on top this week"
          icon={Crown}
          glow="rgba(245,158,11,0.28)"
          action={<button type="button" className={cn(GLASS, BUTTON, "text-slate-200 hover:bg-white/10")}>View ranks</button>}
          art={<TrophyArt className="-bottom-2 right-0 h-[100px] w-[100px] xl:-bottom-2.5 xl:h-[136px] xl:w-[136px]" />}
        />
      </div>

      {open && (
        <Modal onClose={() => setOpen(false)} size="md">
          <DailySpinWheel
            config={config}
            spinning={spinning}
            readyIn={readyIn}
            onClose={() => setOpen(false)}
            onSpin={spin}
          />
        </Modal>
      )}
    </>
  );
}
```

Leave the `PromoCard` sub-component (lines 43-74) exactly as it is.

- [ ] **Step 3: Pass the props down**

In `src/components/lobby/GamesLobby.tsx`, add to the `Props` interface:

```ts
  lastSpinAt: string | null | undefined;
```

Destructure it in the component signature, and change line 95 to:

```tsx
                <PromoCards casino={casino} lastSpinAt={lastSpinAt} />
```

In `src/pages/CasinoDashboard.tsx`, find the `<GamesLobby ... />` render inside the `activeTab === "games"` branch (around line 334) and add:

```tsx
              lastSpinAt={membership?.last_daily_spin_at}
```

No balance callback is needed: `useBalance` (`src/hooks/useBalance.ts`) already subscribes to `casino_members` UPDATE events, so both the header balance and `last_daily_spin_at` refresh on their own after a claim. The wheel shows its own payout pop-in on landing, so nothing depends on the header updating at a particular instant.

- [ ] **Step 4: Verify in the running app**

Run `npm run dev`. Sign in via Playwright as `claudetest.cassie@gmail.com` / `ClaudeTest123!`, open a casino's Games tab.

Expected: **no Daily spin card at all** (the feature is off everywhere until Task 9 lets an owner enable it), and the remaining two promo cards lay out in two columns at `xl` without a gap where the third used to be.

- [ ] **Step 5: Commit**

```bash
git add src/components/lobby/PromoCards.tsx src/components/lobby/GamesLobby.tsx src/pages/CasinoDashboard.tsx src/types/index.ts
git commit -m "feat(daily-spin): wire the lobby promo card to the live feature"
```

---

### Task 9: Special Features settings panel

**Files:**
- Create: `src/components/settings/SpecialFeaturesPanel.tsx`
- Modify: `src/pages/CasinoDashboard.tsx:643` (the `view` union), `:697-733` (the settings menu), `:735-746` (the view branches)

**Interfaces:**
- Consumes: `resolveDailySpin`, `expectedValue`, `nothingChance`, `SEGMENT_PALETTE`, `MIN_SEGMENTS`, `MAX_SEGMENTS`, `DEFAULT_DAILY_SPIN` from `src/lib/dailySpin`; `DailySpinWheel` (Task 7) in `preview` mode; `Casino`, `SpecialFeaturesSettings` from `src/types`.
- Produces: `<SpecialFeaturesPanel casino onSaved />` where `onSaved: (settings: CasinoSettings) => void`.

- [ ] **Step 1: Write the panel**

Create `src/components/settings/SpecialFeaturesPanel.tsx`. A **new file rather than another section of `CasinoDashboard.tsx`**, which is already 1,747 lines with `SettingsTab` as its largest member:

```tsx
import { useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  DEFAULT_DAILY_SPIN,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  SEGMENT_PALETTE,
  expectedValue,
  nothingChance,
  resolveDailySpin,
  type DailySpinSegment,
  type DailySpinSettings,
} from "../../lib/dailySpin";
import type { Casino, CasinoSettings } from "../../types";
import { cn, formatChips } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { DailySpinWheel } from "../DailySpinWheel";

export function SpecialFeaturesPanel({
  casino,
  onSaved,
}: {
  casino: Casino;
  onSaved: (settings: CasinoSettings) => void;
}) {
  const [draft, setDraft] = useState<DailySpinSettings>(() =>
    resolveDailySpin(casino.settings?.specialFeatures?.dailySpin)
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The preview runs the draft through the same resolver the server uses, so
  // what the owner sees is what a player will actually get.
  const resolved = useMemo(() => resolveDailySpin(draft), [draft]);
  const totalWeight = draft.segments.reduce((s, x) => s + x.weight, 0) || 1;
  const ev = expectedValue(resolved);
  const blank = nothingChance(resolved);

  function patch(p: Partial<DailySpinSettings>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function patchSegment(index: number, p: Partial<DailySpinSegment>) {
    setDraft((d) => ({
      ...d,
      segments: d.segments.map((s, i) => (i === index ? { ...s, ...p } : s)),
    }));
  }

  function addSegment() {
    setDraft((d) => {
      if (d.segments.length >= MAX_SEGMENTS) return d;
      const i = d.segments.length;
      return {
        ...d,
        segments: [
          ...d.segments,
          {
            id: `seg-${Date.now()}-${i}`,
            label: "New prize",
            amount: 100,
            weight: 10,
            color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
          },
        ],
      };
    });
  }

  function removeSegment(index: number) {
    setDraft((d) =>
      d.segments.length <= MIN_SEGMENTS
        ? d
        : { ...d, segments: d.segments.filter((_, i) => i !== index) }
    );
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      // Store the resolved config, not the raw draft — an owner's partially
      // typed value never reaches the database.
      const settings: CasinoSettings = {
        ...casino.settings,
        specialFeatures: { ...casino.settings?.specialFeatures, dailySpin: resolved },
      };
      const { error } = await supabase.from("casinos").update({ settings }).eq("id", casino.id);
      if (error) throw error;
      onSaved(settings);
      setMessage("Saved!");
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Daily Spin</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A free wheel spin, once per cooldown. You decide every prize — including the blanks.
        </p>
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="h-4 w-4 accent-primary"
        />
        <span className="flex-1">
          <span className="block text-sm font-semibold">Enable Daily Spin</span>
          <span className="block text-xs text-muted-foreground">
            When off, the card is hidden from the lobby entirely.
          </span>
        </span>
      </label>

      <div className={cn("space-y-5", !draft.enabled && "opacity-60")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ds-title">Card title</Label>
            <Input
              id="ds-title"
              maxLength={32}
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-subtitle">Card subtitle</Label>
            <Input
              id="ds-subtitle"
              maxLength={60}
              value={draft.subtitle}
              onChange={(e) => patch({ subtitle: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-cooldown">Cooldown (hours)</Label>
            <Input
              id="ds-cooldown"
              type="number"
              min={1}
              max={168}
              value={draft.cooldownHours}
              onChange={(e) => patch({ cooldownHours: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">Prizes</h4>
              <p className="text-xs text-muted-foreground">
                {draft.segments.length}/{MAX_SEGMENTS} slices. Set a prize to 0 chips to make it a
                blank.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              disabled={draft.segments.length >= MAX_SEGMENTS}
              onClick={addSegment}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          <div className="space-y-2">
            {draft.segments.map((seg, i) => (
              <div
                key={seg.id}
                className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2.5"
              >
                <input
                  type="color"
                  aria-label={`Colour for ${seg.label}`}
                  value={seg.color}
                  onChange={(e) => patchSegment(i, { color: e.target.value })}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                />
                <div className="min-w-[7rem] flex-1 space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Label
                  </Label>
                  <Input
                    maxLength={24}
                    value={seg.label}
                    onChange={(e) => patchSegment(i, { label: e.target.value })}
                    className="h-9"
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Chips
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={seg.amount}
                    onChange={(e) => patchSegment(i, { amount: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
                <div className="w-20 space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Weight
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={seg.weight}
                    onChange={(e) => patchSegment(i, { weight: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
                <span className="w-14 pb-2 text-right text-xs tabular-nums text-muted-foreground">
                  {((seg.weight / totalWeight) * 100).toFixed(1)}%
                </span>
                <button
                  type="button"
                  onClick={() => removeSegment(i)}
                  disabled={draft.segments.length <= MIN_SEGMENTS}
                  aria-label={`Remove ${seg.label}`}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid items-center gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-[auto,1fr]">
          <div className="mx-auto w-[min(260px,60vw)]">
            <DailySpinWheel config={resolved} preview />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              Average {formatChips(Math.round(ev))} chips per spin
            </p>
            <p className="text-sm text-muted-foreground">
              {(blank * 100).toFixed(0)}% of spins land on nothing
            </p>
            <p className="pt-1 text-xs text-muted-foreground">
              For scale, new members start with{" "}
              {formatChips(casino.settings.startingBalance)} chips.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setDraft({ ...DEFAULT_DAILY_SPIN, enabled: draft.enabled })}
        >
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Reset to default wheel
        </Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the settings menu card**

In `src/pages/CasinoDashboard.tsx`:

Import at the top — add `Sparkles` to the existing `lucide-react` import, and add:

```tsx
import { SpecialFeaturesPanel } from "../components/settings/SpecialFeaturesPanel";
```

Change the `view` union at line 643:

```tsx
  const [view, setView] = useState<"menu" | "games" | "appearance" | "special">("menu");
```

Add a third card to the menu grid (after the Club Appearance button, before the closing `</div>` at line 731):

```tsx
        <button
          type="button"
          onClick={() => setView("special")}
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Special Features</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Daily spin wheel — prizes, odds and cooldown.
            </p>
          </div>
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
```

Add the view branch alongside the existing `{view === "games" && ...}` block:

```tsx
      {view === "special" && (
        <SpecialFeaturesPanel
          casino={casino}
          onSaved={(settings) => {
            // Keep the in-memory casino in step with what was just written, so
            // switching straight to the Games tab shows the new card state.
            useCasinoStore.setState((s) =>
              s.currentCasino ? { currentCasino: { ...s.currentCasino, settings } } : s
            );
          }}
        />
      )}
```

If `useCasinoStore` is not already imported in this file, import it from `../stores/casinoStore`. If the store exposes a dedicated setter (e.g. `setCurrentCasino`), prefer that over `setState`.

- [ ] **Step 3: Verify the whole feature end to end**

Run `npm run dev`, sign in via Playwright as `claudetest.cassie@gmail.com` / `ClaudeTest123!`.

1. Casino → **Settings → Special Features**. Confirm the panel renders with the 8 default slices and reads roughly **"Average 420 chips per spin · 33% of spins land on nothing"**.
2. Change a prize's chips to `999999` and confirm the average figure jumps immediately — this is the OP-check working.
3. Undo with **Reset to default wheel**, tick **Enable Daily Spin**, **Save**.
4. Go to the **Games** tab. The Daily spin card is now present and reads **Spin now**.
5. Click it, spin. Confirm: the wheel turns for ~4s, the balance in the header does **not** change until it stops, and a prize landing shows the payout pop-in while a Nothing landing shows **no banner at all**.
6. Close and reopen. The card now reads **Ready in 23h 59m**.
7. Check the Trades/ledger view for a `Daily spin: <label>` row.
8. Resize to ~375px and ~1920px; confirm the wheel scales at both ends and the page never scrolls horizontally.

- [ ] **Step 4: Reset the test account's cooldown if you need to spin again**

Via the Supabase MCP `execute_sql` tool:

```sql
update public.casino_members
   set last_daily_spin_at = null
 where user_id = (select id from auth.users where email = 'claudetest.cassie@gmail.com');
```

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SpecialFeaturesPanel.tsx src/pages/CasinoDashboard.tsx
git commit -m "feat(daily-spin): add Special Features settings category with live wheel preview"
```

---

### Task 10: Documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Document the feature**

Add a section to `CLAUDE.md` after **Game Surfaces**:

```markdown
## Special Features

Owner-configurable things that are not games live in `casinos.settings.specialFeatures`
(jsonb), edited under **Settings → Special Features**
(`src/components/settings/SpecialFeaturesPanel.tsx`).

- **Daily spin** — a free prize wheel behind a cooldown. Slices are entirely
  owner-defined (label, chip amount, weight, colour); a slice paying 0 chips is
  a "Nothing" and is an expected outcome, not an error.
- The wheel's validation, weighted pick and expected-value maths all live in
  `supabase/functions/daily-spin/engine.ts`, which is Deno-free and re-exported
  by `src/lib/dailySpin.ts`. The settings preview and the server therefore run
  the same code — never add a second copy of the odds maths on the client.
- `resolveDailySpin` is the authoritative gate and never throws: a malformed
  config degrades to the default wheel rather than breaking the lobby.
- The prize is picked in TypeScript but credited by `claim_daily_spin`
  (migration 052), which increments the balance under a row lock and writes the
  ledger row atomically. That RPC is revoked from `anon`/`authenticated` — only
  the edge function's service key may call it. Ledger rows use
  `game_type_id: null` so a spin stays out of per-game stats.
- Cooldown state is `casino_members.last_daily_spin_at`; there is no claims table.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(daily-spin): document the Special Features settings category"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §1 Config shape + validation table | 1 (engine), 5 (client types) |
| §2 Default wheel | 1 |
| §3 Data model — column, `claim_daily_spin`, revoke | 3 |
| §4 Engine API + edge function + tests | 1, 2, 4 |
| §5 `useDailySpin` | 6 |
| §5 `PromoCards` | 8 |
| §5 `DailySpinWheel` + reveal rule + fill sizing | 7 |
| §5 `SpecialFeaturesPanel` | 9 |
| §6 Error handling table | 4 (server statuses), 6 (client message parsing + 429 adoption), 7 (failed-request path) |
| §7 Out of scope | Nothing implemented — Daily bonus and Leaderboard left inert in Task 8 |

**Type consistency** — `DailySpinSettings`, `DailySpinSegment`, `DailySpinResult`, `resolveDailySpin`, `pickSegment`, `expectedValue`, `nothingChance`, `nextSpinAt`, `formatReadyIn`, `claim_daily_spin` all carry the same names and signatures from the task that defines them through every task that consumes them.

**Known follow-up, deliberately not in scope:** `DailySpinWheel`'s `preview` mode renders the same component the modal uses, so the settings preview inherits the modal's header. If that reads badly in the panel, hiding the header under `preview` is a one-line change — not worth a task up front.
