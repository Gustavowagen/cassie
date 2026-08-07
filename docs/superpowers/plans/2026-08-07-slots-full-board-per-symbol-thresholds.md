# Slots Full-Board Per-Symbol Win Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In full-board slots mode, give each symbol its own win threshold — rarer symbols need fewer matching cells, common symbols need more — while every symbol still wins independently of the others (no single "winner"), and each board size's overall hit frequency stays close to today's.

**Architecture:** `FULL_BOARD_TABLES` moves from one shared `minCount`/`tierIndex` per board size to a per-symbol `{ threshold, tierIndex, pay }` list. `evaluateFullBoardWin` drops the old "find the max count" logic and instead checks every symbol's count against its own threshold independently, collecting every symbol that qualifies into a generic `wins` array (each entry now carries its own `count`, since different symbols can qualify at different counts in the same spin). `payoutForFullBoard` sums each qualifying symbol's own-tier payout. Single-row payline mode is completely untouched. All new thresholds/tiers/pay tables and `baselineRtp` constants are pre-computed via exact binomial/multinomial enumeration (not simulation) — see the design doc.

**Tech Stack:** TypeScript, Deno edge function (Supabase), Vitest, React.

**Design doc:** `docs/superpowers/specs/2026-08-07-slots-full-board-per-symbol-thresholds-design.md`

---

## File Structure

- Modify `supabase/functions/slots/engine.ts` — `FullBoardPosition`/`FullBoardTieWin`/`FullBoardWin` types, new `FullBoardSymbolConfig`/`FullBoardConfig` types, per-symbol `FULL_BOARD_TABLES` data, rewritten `evaluateFullBoardWin`/`payoutForFullBoard`.
- Modify `supabase/functions/slots/engine.test.ts` — replace the `evaluateFullBoardWin`, `payoutForFullBoard`, and `full-board RTP` describe blocks. Single-row describe blocks are untouched.
- Modify `supabase/functions/slots/index.ts` — `describeSpin`'s full-board branch reads per-entry `count` instead of a shared top-level `count`.
- Modify `src/types/index.ts` — `FullBoardSlotWin` drops its shared `count`, each `wins` entry gains its own `count`.
- Modify `src/components/games/Slots.tsx` — `FULL_BOARD_PAYTABLES` becomes per-symbol, `winTier` takes the whole win object and reads each qualifying symbol's own tier, `buildSlotsInfo`'s full-board rules become per-symbol, paytable panel shows each symbol's own count-range label.

---

### Task 1: Engine — full-board types, per-symbol `FULL_BOARD_TABLES`, and `evaluateFullBoardWin`

**Files:**
- Modify: `supabase/functions/slots/engine.ts:228-345` (from the `// --- Full board reward mode` comment through the end of `evaluateFullBoardWin`)
- Test: `supabase/functions/slots/engine.test.ts:363-472` (the `evaluateFullBoardWin` describe block)

- [ ] **Step 1: Write the failing tests**

Replace the `evaluateFullBoardWin` describe block (lines 363-472) with:

```ts
describe("evaluateFullBoardWin", () => {
  it("returns null when no symbol reaches its own threshold (5x3)", () => {
    // dot=6 (below its threshold of 7), square=5 (below 7), diamond=2
    // (below 7), star=1 (below 6), seven=1 (below 5) — nobody qualifies.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot",
      "dot","square","square","square","square",
      "square","diamond","diamond","star","seven",
    ], "5x3");
    expect(evaluateFullBoardWin(reels, "5x3")).toBeNull();
  });

  it("a symbol wins alone at exactly its own threshold, with no other symbol also qualifying (5x3 dot at 7)", () => {
    // dot=7 (at its threshold), square=6 (below its threshold of 7),
    // diamond=2 (below its threshold of 7) — only dot qualifies.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot",
      "dot","dot","square","square","square",
      "square","square","square","diamond","diamond",
    ], "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot", count: 7 })]);
    expect(win?.wins[0].positions).toHaveLength(7);
  });

  it("two different symbols independently clear their own (different) thresholds in the same spin, and both are collected (5x3 dot=7, seven=5)", () => {
    // dot=7 (at its threshold of 7), seven=5 (at its threshold of 5),
    // square=3 (below its threshold of 7) fills the remaining cells.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot",
      "dot","dot","seven","seven","seven",
      "seven","seven","square","square","square",
    ], "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    expect(win?.wins.map((w) => w.symbol).sort()).toEqual(["dot", "seven"]);
    expect(win?.wins.find((w) => w.symbol === "dot")?.count).toBe(7);
    expect(win?.wins.find((w) => w.symbol === "seven")?.count).toBe(5);
  });

  it("collects any number of simultaneously qualifying symbols generically, not just one (3x6: diamond=7, star=6, seven=5 all independently win)", () => {
    // prettier-ignore
    const reels = fullBoardReels([
      "diamond","diamond","diamond","diamond","diamond","diamond",
      "diamond","star","star","star","star","star",
      "star","seven","seven","seven","seven","seven",
    ], "3x6");
    const win = evaluateFullBoardWin(reels, "3x6");
    expect(win?.wins.map((w) => w.symbol).sort()).toEqual(["diamond", "seven", "star"]);
    expect(win?.wins.find((w) => w.symbol === "diamond")?.count).toBe(7);
    expect(win?.wins.find((w) => w.symbol === "star")?.count).toBe(6);
    expect(win?.wins.find((w) => w.symbol === "seven")?.count).toBe(5);
  });

  it("positions use a numeric row index, not a top/mid/bottom label", () => {
    const reels = fullBoardReels(new Array(15).fill("dot"), "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    const rows = win!.wins[0].positions.map((p) => p.row).sort();
    expect(rows).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(win!.wins[0].count).toBe(15);
  });

  it("returns null below the 3x6 board's per-symbol thresholds", () => {
    // dot=8 (below its threshold of 9), square=6 (below 7), diamond=2
    // (below 7), star=1 (below 6), seven=1 (below 5).
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot","dot",
      "dot","dot","square","square","square","square",
      "square","square","diamond","diamond","star","seven",
    ], "3x6");
    expect(evaluateFullBoardWin(reels, "3x6")).toBeNull();
  });

  it("wins at the 3x6 board's dot threshold (9)", () => {
    // dot=9 (at its threshold), square=6 (below its threshold of 7),
    // diamond=3 (below its threshold of 7) fill the remaining 9 cells.
    // prettier-ignore
    const reels = fullBoardReels([
      "dot","dot","dot","dot","dot","dot",
      "dot","dot","dot","square","square","square",
      "square","square","square","diamond","diamond","diamond",
    ], "3x6");
    const win = evaluateFullBoardWin(reels, "3x6");
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot", count: 9 })]);
  });

  it("wins at the 4x6 board's dot threshold (11)", () => {
    // dot=11 (at its threshold), square=8 (below its threshold of 9),
    // diamond=5 (below its threshold of 9) fill the remaining 13 cells.
    const cells = [
      ...new Array(11).fill("dot"),
      ...new Array(8).fill("square"),
      ...new Array(5).fill("diamond"),
    ];
    const reels = fullBoardReels(cells, "4x6");
    const win = evaluateFullBoardWin(reels, "4x6");
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "dot", count: 11 })]);
  });

  it("the rarest symbol (seven) wins alone at its own threshold of 5, distinct from dot's threshold of 7 (5x3)", () => {
    // seven=5 (at its threshold), dot=6 (below its threshold of 7),
    // square=4 (below its threshold of 7) fill the remaining 10 cells.
    const cells = [...new Array(5).fill("seven"), ...new Array(6).fill("dot"), ...new Array(4).fill("square")];
    const reels = fullBoardReels(cells, "5x3");
    const win = evaluateFullBoardWin(reels, "5x3");
    expect(win?.wins).toEqual([expect.objectContaining({ symbol: "seven", count: 5 })]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/slots/engine.test.ts`

Expected: FAIL — the old `FullBoardTieWin` type has no per-entry `count` field and `evaluateFullBoardWin` still implements the old shared-`minCount`/max-count-wins logic, so these assertions don't compile or don't match. (TypeScript errors here are expected and fine — they go away once Step 3 lands.)

- [ ] **Step 3: Replace the full-board types, `FULL_BOARD_TABLES` data, and `evaluateFullBoardWin`**

Replace `supabase/functions/slots/engine.ts` lines 228-345 with:

```ts
// --- Full board reward mode -------------------------------------------
//
// "Full board" scores every visible cell instead of just the middle-row
// payline. Unlike single-row mode (one shared threshold, one winner),
// every symbol has its own threshold and is evaluated independently: a
// symbol wins whenever its own cell count reaches its own threshold,
// regardless of what any other symbol's count is. More than one symbol
// can independently qualify in the same spin — when that happens, every
// qualifying symbol pays, at its own tier; there is no single "winner" and
// no tie-break rule needed, since qualification isn't relative to any
// other symbol's count.
//
// Thresholds and pay tables below are from exact binomial/multinomial
// enumeration (not simulation) — see
// docs/superpowers/specs/2026-08-07-slots-full-board-per-symbol-thresholds-design.md
// for the full derivation (thresholds chosen so each symbol requires no
// more matches than the next-more-common symbol, while each symbol's own
// win probability is strictly less than every more-common symbol's).
export interface FullBoardPosition {
  reel: number;
  row: number; // 0-based row index
}

// `wins` holds every symbol that independently reached its own threshold
// this spin — normally length 0-1, occasionally more when multiple
// symbols each clear their own (different) threshold at once. Each entry
// carries its own `count`, since different symbols can win at different
// counts in the same spin — there is no single board-wide count anymore.
export interface FullBoardTieWin {
  symbol: SymbolId;
  count: number;
  positions: FullBoardPosition[];
}

export interface FullBoardWin {
  wins: FullBoardTieWin[];
}

interface FullBoardSymbolConfig {
  id: SymbolId;
  threshold: number;
  tierIndex: (count: number) => number;
  pay: number[]; // indexed by 0-based tier
}

interface FullBoardConfig {
  symbols: FullBoardSymbolConfig[];
  baselineRtp: number;
}

// Full-board mode is only ever evaluated on 5x3/3x6/4x6 (3x3 and 3x4 never
// reach full_board per ALLOWED_REWARD_MODES), so this is a Partial keyed
// by BoardSize, with no entry for the sizes that don't support the mode —
// both callers below guard against a missing config rather than trusting
// a TS cast.
export const FULL_BOARD_TABLES: Partial<Record<BoardSize, FullBoardConfig>> = {
  "5x3": {
    baselineRtp: 0.953370178231,
    symbols: [
      { id: "dot", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [0.5, 1.5, 4.5] },
      { id: "square", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [2.5, 8, 28] },
      { id: "diamond", threshold: 7, tierIndex: (c) => (c >= 9 ? 2 : c === 8 ? 1 : 0), pay: [6, 17.5, 61.5] },
      { id: "star", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [22, 66.5, 233.5] },
      { id: "seven", threshold: 5, tierIndex: (c) => (c >= 7 ? 2 : c === 6 ? 1 : 0), pay: [27.5, 82.5, 288] },
    ],
  },
  "3x6": {
    baselineRtp: 0.990009227769,
    symbols: [
      { id: "dot", threshold: 9, tierIndex: (c) => (c >= 12 ? 2 : c === 11 ? 1 : 0), pay: [1, 2.5, 9] },
      { id: "square", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [1, 2.5, 9] },
      { id: "diamond", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [3, 8.5, 30] },
      { id: "star", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [7, 21.5, 74.5] },
      { id: "seven", threshold: 5, tierIndex: (c) => (c >= 7 ? 2 : c === 6 ? 1 : 0), pay: [10.5, 31.5, 110.5] },
    ],
  },
  "4x6": {
    baselineRtp: 0.924315378511,
    symbols: [
      { id: "dot", threshold: 11, tierIndex: (c) => (c >= 15 ? 2 : c >= 13 ? 1 : 0), pay: [0.5, 2, 6.5] },
      { id: "square", threshold: 9, tierIndex: (c) => (c >= 13 ? 2 : c >= 11 ? 1 : 0), pay: [1, 3, 11] },
      { id: "diamond", threshold: 9, tierIndex: (c) => (c >= 12 ? 2 : c === 11 ? 1 : 0), pay: [3.5, 11, 39] },
      { id: "star", threshold: 7, tierIndex: (c) => (c >= 9 ? 2 : c === 8 ? 1 : 0), pay: [5, 14.5, 50.5] },
      { id: "seven", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [11, 33, 116.5] },
    ],
  },
};

// Counts every cell (not just the payline) per symbol, then checks each
// symbol independently against its own threshold — no "max count" concept
// anymore. Every symbol whose count reaches its own threshold is collected
// into `wins`, generically (no hardcoded cap on how many can qualify at
// once).
export function evaluateFullBoardWin(reels: Reel[], boardSize: BoardSize): FullBoardWin | null {
  const config = FULL_BOARD_TABLES[boardSize];
  if (!config) return null;
  const cellsBySymbol = new Map<SymbolId, FullBoardPosition[]>();
  reels.forEach((reel, reelIndex) => {
    reel.forEach((symbol, row) => {
      const positions = cellsBySymbol.get(symbol) ?? [];
      positions.push({ reel: reelIndex, row });
      cellsBySymbol.set(symbol, positions);
    });
  });

  const wins: FullBoardTieWin[] = [];
  for (const s of config.symbols) {
    const positions = cellsBySymbol.get(s.id) ?? [];
    if (positions.length >= s.threshold) {
      wins.push({ symbol: s.id, count: positions.length, positions });
    }
  }
  return wins.length > 0 ? { wins } : null;
}
```

This deletes the old `payoutForFullBoard` function too (it was originally right after `evaluateFullBoardWin`, in the lines being replaced) — Task 2 adds its replacement back. Until Task 2 lands, `engine.ts` won't compile (payoutForFullBoard is referenced by `index.ts` and the test file) — that's expected; don't run the full test suite until Task 2 is also done.

- [ ] **Step 4: Run the `evaluateFullBoardWin` tests to verify they pass**

Run: `npx vitest run supabase/functions/slots/engine.test.ts -t evaluateFullBoardWin`

Expected: PASS (the `payoutForFullBoard` and `full-board RTP` describe blocks will still fail/not compile at this point — that's fine, they're fixed in Tasks 2-3; this `-t` filter runs only the block just rewritten).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/slots/engine.ts supabase/functions/slots/engine.test.ts
git commit -m "slots: give each full-board symbol its own independent win threshold

Rarer symbols now need fewer matching cells to win than common symbols,
while every symbol still wins independently (no single max-count winner).
payoutForFullBoard is updated in the next commit."
```

---

### Task 2: Engine — `payoutForFullBoard`

**Files:**
- Modify: `supabase/functions/slots/engine.ts` (add back the function removed in Task 1, right after `evaluateFullBoardWin`)
- Test: `supabase/functions/slots/engine.test.ts:474-527` (the `payoutForFullBoard` describe block)

- [ ] **Step 1: Write the failing tests**

Replace the `payoutForFullBoard` describe block (now around lines 474-527, immediately after the block rewritten in Task 1) with:

```ts
describe("payoutForFullBoard", () => {
  it("returns 0 for no win", () => {
    expect(payoutForFullBoard(null, 10, "5x3")).toBe(0);
  });

  it("pays the 5x3 dot table across its 3 tiers (7-8 / 9 / 10-15)", () => {
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 7, positions: [] }] }, 10, "5x3")).toBe(5);
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 8, positions: [] }] }, 10, "5x3")).toBe(5);
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 9, positions: [] }] }, 10, "5x3")).toBe(15);
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 15, positions: [] }] }, 10, "5x3")).toBe(45);
  });

  it("sums two different symbols' own-tier payouts when both independently qualify in the same spin", () => {
    const win = {
      wins: [
        { symbol: "dot" as const, count: 7, positions: [] }, // tier 0 = 0.5x
        { symbol: "seven" as const, count: 5, positions: [] }, // tier 0 = 27.5x
      ],
    };
    expect(payoutForFullBoard(win, 10, "5x3")).toBe(280);
  });

  it("pays the 3x6 dot table across its 3 tiers (9-10 / 11 / 12-18)", () => {
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 9, positions: [] }] }, 10, "3x6")).toBe(10);
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 11, positions: [] }] }, 10, "3x6")).toBe(25);
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 18, positions: [] }] }, 10, "3x6")).toBe(90);
  });

  it("pays the 4x6 dot table across its 3 tiers (11-12 / 13-14 / 15-24)", () => {
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 11, positions: [] }] }, 10, "4x6")).toBe(5);
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 13, positions: [] }] }, 10, "4x6")).toBe(20);
    expect(payoutForFullBoard({ wins: [{ symbol: "dot", count: 24, positions: [] }] }, 10, "4x6")).toBe(65);
  });

  it("scales the raw payout by (1 - houseEdge) / that board size's BASELINE_RTP when houseEdge is given", () => {
    const win = { wins: [{ symbol: "seven" as const, count: 7, positions: [] }] };
    const raw = payoutForFullBoard(win, 100, "5x3");
    const scaled = payoutForFullBoard(win, 100, "5x3", DEFAULT_HOUSE_EDGE);
    expect(scaled).toBe(
      roundMoney(raw * ((1 - DEFAULT_HOUSE_EDGE) / FULL_BOARD_TABLES["5x3"]!.baselineRtp))
    );
  });

  it("a lower house edge pays more, a higher house edge pays less, than the unscaled default", () => {
    const win = { wins: [{ symbol: "seven" as const, count: 7, positions: [] }] };
    const raw = payoutForFullBoard(win, 100, "5x3");
    expect(payoutForFullBoard(win, 100, "5x3", MIN_HOUSE_EDGE)).toBeGreaterThan(raw);
    expect(payoutForFullBoard(win, 100, "5x3", MAX_HOUSE_EDGE)).toBeLessThan(raw);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run supabase/functions/slots/engine.test.ts -t payoutForFullBoard`

Expected: FAIL — `payoutForFullBoard` doesn't exist yet in `engine.ts` (removed as part of Task 1's replaced block), so this doesn't compile.

- [ ] **Step 3: Add `payoutForFullBoard`**

Add this function to `supabase/functions/slots/engine.ts`, directly after `evaluateFullBoardWin` (which Task 1 just added):

```ts

// Every qualifying symbol pays its own-tier rate — a dot win and a
// separately-qualifying seven win both pay in full and sum together, since
// each symbol's win is independent of every other symbol's count.
export function payoutForFullBoard(
  win: FullBoardWin | null,
  bet: number,
  boardSize: BoardSize,
  houseEdge?: number
): number {
  if (!win) return 0;
  const config = FULL_BOARD_TABLES[boardSize];
  if (!config) return 0;
  const scale = houseEdge === undefined ? 1 : edgeScale(config.baselineRtp, houseEdge);
  const total = win.wins.reduce((sum, w) => {
    const symbol = config.symbols.find((s) => s.id === w.symbol)!;
    const tier = symbol.tierIndex(w.count);
    return sum + symbol.pay[tier];
  }, 0);
  return roundMoney(bet * total * scale);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/slots/engine.test.ts -t payoutForFullBoard`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/slots/engine.ts supabase/functions/slots/engine.test.ts
git commit -m "slots: sum every qualifying symbol's own-tier payout in payoutForFullBoard"
```

---

### Task 3: Engine test — full-board RTP validation and design invariants

**Files:**
- Test: `supabase/functions/slots/engine.test.ts:529-640` (the `full-board RTP` describe block)

This task doesn't touch `engine.ts` — it independently re-derives each table's RTP and hit frequency by exact enumeration (the same method used to design the tables in the first place) and checks the two hard invariants from the design doc directly. If any assertion here fails, the bug is a transcription error in `engine.ts`'s `FULL_BOARD_TABLES` from Tasks 1-2 (fix `engine.ts` to match the design doc, not this test).

- [ ] **Step 1: Replace the `full-board RTP` describe block**

Replace lines 529-640 with:

```ts
describe("full-board RTP", () => {
  // Exact multinomial-composition enumeration over SYMBOL_WEIGHTS, generic
  // over total cell count — recomputed independently of
  // evaluateFullBoardWin/payoutForFullBoard. Every symbol is checked
  // against its own threshold independently (no "max count" concept),
  // mirroring the pay-every-qualifier rule, and every qualifying symbol's
  // own-tier pay is summed (matches linearity of expectation, since each
  // symbol's marginal count distribution is exactly binomial regardless of
  // the others).
  function factorial(n: number): number {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function theoreticalFullBoardRtp(boardSize: "5x3" | "3x6" | "4x6") {
    const config = FULL_BOARD_TABLES[boardSize]!;
    const n = BOARD_DIMENSIONS[boardSize].rows * BOARD_DIMENSIONS[boardSize].cols;
    let rtp = 0;
    let hitFrequency = 0;

    function enumerate(idx: number, remaining: number, counts: number[]) {
      if (idx === SYMBOL_WEIGHTS.length - 1) {
        counts[idx] = remaining;
        let coef = factorial(n);
        let pw = 1;
        for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
          coef /= factorial(counts[i]);
          pw *= SYMBOL_WEIGHTS[i].weight ** counts[i];
        }
        const p = coef * pw;

        let spinPay = 0;
        let anyWin = false;
        config.symbols.forEach((s, i) => {
          if (counts[i] >= s.threshold) {
            anyWin = true;
            spinPay += s.pay[s.tierIndex(counts[i])];
          }
        });
        rtp += p * spinPay;
        if (anyWin) hitFrequency += p;
        return;
      }
      for (let c = 0; c <= remaining; c++) {
        counts[idx] = c;
        enumerate(idx + 1, remaining - c, counts);
      }
    }
    enumerate(0, n, new Array(SYMBOL_WEIGHTS.length).fill(0));
    return { rtp, hitFrequency };
  }

  it("matches each board size's pinned baselineRtp", () => {
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const { rtp } = theoreticalFullBoardRtp(boardSize);
      expect(rtp).toBeCloseTo(FULL_BOARD_TABLES[boardSize]!.baselineRtp, 6);
    }
  });

  it("a chosen house edge scales payoutForFullBoard's raw payout by (1 - houseEdge) / baselineRtp, for every full-board size", () => {
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const n = BOARD_DIMENSIONS[boardSize].rows * BOARD_DIMENSIONS[boardSize].cols;
      const win = { wins: [{ symbol: "seven" as const, count: n, positions: [] }] };
      const raw = payoutForFullBoard(win, 100, boardSize);
      for (const houseEdge of [MIN_HOUSE_EDGE, 0.02, DEFAULT_HOUSE_EDGE, MAX_HOUSE_EDGE]) {
        const scaled = payoutForFullBoard(win, 100, boardSize, houseEdge);
        expect(scaled).toBe(roundMoney(raw * ((1 - houseEdge) / FULL_BOARD_TABLES[boardSize]!.baselineRtp)));
      }
    }
  });

  it("hit frequencies land where exact enumeration puts them (documented in the design doc)", () => {
    const expected: Record<"5x3" | "3x6" | "4x6", [number, number]> = {
      "5x3": [0.3, 0.36],
      "3x6": [0.32, 0.38],
      "4x6": [0.33, 0.4],
    };
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const { hitFrequency } = theoreticalFullBoardRtp(boardSize);
      const [lo, hi] = expected[boardSize];
      expect(hitFrequency).toBeGreaterThan(lo);
      expect(hitFrequency).toBeLessThan(hi);
    }
  });

  function binomialTail(n: number, p: number, k: number): number {
    if (k <= 0) return 1;
    function logChoose(nn: number, kk: number): number {
      let r = 0;
      for (let i = 0; i < kk; i++) r += Math.log(nn - i) - Math.log(i + 1);
      return r;
    }
    let total = 0;
    for (let i = k; i <= n; i++) {
      total += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
    }
    return total;
  }

  it("thresholds never increase for a rarer symbol, and each symbol's exact win probability is strictly less than the next-more-common symbol's", () => {
    // This is the core design invariant from the design doc: common
    // symbols require at least as many matches as rarer symbols, yet
    // still win strictly more often.
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const config = FULL_BOARD_TABLES[boardSize]!;
      const n = BOARD_DIMENSIONS[boardSize].rows * BOARD_DIMENSIONS[boardSize].cols;
      let prevThreshold = Infinity;
      let prevWinProb = 1;
      for (const symbolConfig of config.symbols) {
        expect(symbolConfig.threshold).toBeLessThanOrEqual(prevThreshold);
        const weight = SYMBOL_WEIGHTS.find((s) => s.id === symbolConfig.id)!.weight;
        const winProb = binomialTail(n, weight, symbolConfig.threshold);
        expect(winProb).toBeLessThan(prevWinProb);
        prevThreshold = symbolConfig.threshold;
        prevWinProb = winProb;
      }
    }
  });

  it("within every board size's table, rarer symbols pay at least as much at every tier", () => {
    for (const boardSize of Object.keys(FULL_BOARD_TABLES) as ("5x3" | "3x6" | "4x6")[]) {
      const symbols = FULL_BOARD_TABLES[boardSize]!.symbols;
      for (let i = 1; i < symbols.length; i++) {
        for (let tier = 0; tier < symbols[i].pay.length; tier++) {
          expect(symbols[i].pay[tier]).toBeGreaterThanOrEqual(symbols[i - 1].pay[tier]);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the full engine test suite**

Run: `npx vitest run supabase/functions/slots/engine.test.ts`

Expected: PASS — every test in the file, including all the untouched single-row describe blocks. If `full-board RTP`'s "matches each board size's pinned baselineRtp" or the threshold/probability-ordering test fails, re-check the `FULL_BOARD_TABLES` values entered in Task 1 against the design doc's tables — do not adjust this test's expectations to match a wrong `engine.ts` value.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/slots/engine.test.ts
git commit -m "slots: validate full-board RTP and the per-symbol threshold/probability ordering invariant by exact enumeration"
```

---

### Task 4: Edge function — `describeSpin`'s full-board branch

**Files:**
- Modify: `supabase/functions/slots/index.ts:86-97`

- [ ] **Step 1: Update `DescribableWin` and `describeSpin`**

Replace lines 86-97:

```ts
type DescribableWin = { symbol: string; count: number } | { wins: { symbol: string; count: number }[] };

function describeSpin(rewardMode: RewardMode, win: DescribableWin | null): string {
  if (!win) return "Slots: no win";
  if (rewardMode === "full_board") {
    const { wins } = win as { wins: { symbol: string; count: number }[] };
    const parts = wins.map((w) => `${w.count}x ${w.symbol}`).join("+");
    return `Slots: ${parts} (full board)`;
  }
  const { symbol, count } = win as { symbol: string; count: number };
  return `Slots: ${count}x ${symbol} (row)`;
}
```

This is the only change `index.ts` needs — `evaluateFullBoardWin`/`payoutForFullBoard`'s call sites (further down in the file) pass through `win` and `payout` unchanged regardless of the internal shape change.

- [ ] **Step 2: Sanity-check by hand (no dedicated tsconfig for this Deno function)**

Re-read the full diff of `supabase/functions/slots/index.ts` to confirm nothing else in the file destructures `win.count` for the full-board branch or otherwise assumes the old shared-`count` shape. The transactions-table `description` column produced by this function (e.g. `"Slots: 7x dot+5x seven (full board)"`) is verified visually in Task 6's Playwright pass, by checking a casino's transaction history after a full-board win.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/slots/index.ts
git commit -m "slots: describe multi-symbol full-board wins with each symbol's own count"
```

---

### Task 5: Frontend types — `FullBoardSlotWin`

**Files:**
- Modify: `src/types/index.ts:160-168`

- [ ] **Step 1: Replace `FullBoardSlotWin`**

Replace lines 160-168:

```ts
// Full-board mode win: count spans every row, so positions need a row
// index alongside the reel index — kept as a separate type from SlotWin
// rather than unifying, so single-row's shape stays untouched. Every
// symbol has its own threshold and wins independently (see
// supabase/functions/slots/engine.ts), so `wins` holds every symbol that
// independently qualified this spin — normally length 0-1, occasionally
// more when multiple different symbols each clear their own threshold at
// once. Each entry carries its own `count`, since different symbols can
// qualify at different counts in the same spin.
export interface FullBoardSlotWin {
  wins: { symbol: SlotSymbolId; count: number; positions: { reel: number; row: number }[] }[];
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`

Expected: FAILS, listing every place in `src/components/games/Slots.tsx` that still assumes `FullBoardSlotWin` has a top-level `count` (this is expected — Task 6 fixes it). Confirm the errors are all inside `Slots.tsx` and nowhere else.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "slots: move FullBoardSlotWin's count onto each individual win entry"
```

---

### Task 6: Frontend — `Slots.tsx` per-symbol full-board paytable, `winTier`, and info panel

**Files:**
- Modify: `src/components/games/Slots.tsx:103-202` (from the comment above `FULL_BOARD_PAYTABLES` through the end of `buildSlotsInfo`)
- Modify: `src/components/games/Slots.tsx:368` (the `winTier` call site)

- [ ] **Step 1: Replace `FULL_BOARD_PAYTABLES`, `winTier`, and `buildSlotsInfo`**

Replace lines 103-202 with:

```ts
interface FullBoardSymbolPaytable {
  id: SlotSymbolId;
  threshold: number;
  tierIndex: (count: number) => number;
  pay: number[];
  // Precomputed count-range text per tier (e.g. "7-8 · 9 · 10+") — kept as
  // a plain string here rather than derived from tierIndex at render time,
  // since deriving exact range boundaries back out of a tierIndex function
  // is more error-prone than stating them once alongside the thresholds
  // they were designed from (see the design doc's per-symbol tables).
  rangeLabel: string;
}

interface FullBoardClientPaytable {
  baselineRtp: number;
  symbols: FullBoardSymbolPaytable[];
}

// Mirrors supabase/functions/slots/engine.ts's FULL_BOARD_TABLES. Every
// symbol has its own threshold/tiers now (not one shared minCount) — see
// docs/superpowers/specs/2026-08-07-slots-full-board-per-symbol-thresholds-design.md.
const FULL_BOARD_PAYTABLES: Record<"5x3" | "3x6" | "4x6", FullBoardClientPaytable> = {
  "5x3": {
    baselineRtp: 0.953370178231,
    symbols: [
      { id: "dot", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [0.5, 1.5, 4.5], rangeLabel: "7-8 · 9 · 10+" },
      { id: "square", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [2.5, 8, 28], rangeLabel: "7-8 · 9 · 10+" },
      { id: "diamond", threshold: 7, tierIndex: (c) => (c >= 9 ? 2 : c === 8 ? 1 : 0), pay: [6, 17.5, 61.5], rangeLabel: "7 · 8 · 9+" },
      { id: "star", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [22, 66.5, 233.5], rangeLabel: "6 · 7 · 8+" },
      { id: "seven", threshold: 5, tierIndex: (c) => (c >= 7 ? 2 : c === 6 ? 1 : 0), pay: [27.5, 82.5, 288], rangeLabel: "5 · 6 · 7+" },
    ],
  },
  "3x6": {
    baselineRtp: 0.990009227769,
    symbols: [
      { id: "dot", threshold: 9, tierIndex: (c) => (c >= 12 ? 2 : c === 11 ? 1 : 0), pay: [1, 2.5, 9], rangeLabel: "9-10 · 11 · 12+" },
      { id: "square", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [1, 2.5, 9], rangeLabel: "7-8 · 9 · 10+" },
      { id: "diamond", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [3, 8.5, 30], rangeLabel: "7-8 · 9 · 10+" },
      { id: "star", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [7, 21.5, 74.5], rangeLabel: "6 · 7 · 8+" },
      { id: "seven", threshold: 5, tierIndex: (c) => (c >= 7 ? 2 : c === 6 ? 1 : 0), pay: [10.5, 31.5, 110.5], rangeLabel: "5 · 6 · 7+" },
    ],
  },
  "4x6": {
    baselineRtp: 0.924315378511,
    symbols: [
      { id: "dot", threshold: 11, tierIndex: (c) => (c >= 15 ? 2 : c >= 13 ? 1 : 0), pay: [0.5, 2, 6.5], rangeLabel: "11-12 · 13-14 · 15+" },
      { id: "square", threshold: 9, tierIndex: (c) => (c >= 13 ? 2 : c >= 11 ? 1 : 0), pay: [1, 3, 11], rangeLabel: "9-10 · 11-12 · 13+" },
      { id: "diamond", threshold: 9, tierIndex: (c) => (c >= 12 ? 2 : c === 11 ? 1 : 0), pay: [3.5, 11, 39], rangeLabel: "9-10 · 11 · 12+" },
      { id: "star", threshold: 7, tierIndex: (c) => (c >= 9 ? 2 : c === 8 ? 1 : 0), pay: [5, 14.5, 50.5], rangeLabel: "7 · 8 · 9+" },
      { id: "seven", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [11, 33, 116.5], rangeLabel: "6 · 7 · 8+" },
    ],
  },
};

function edgeScale(baselineRtp: number, houseEdge: number): number {
  return (1 - houseEdge) / baselineRtp;
}
function displayX(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

// Maps a win's raw count to the shared 3/4/5 CSS win-tier hooks
// (sl-win-tier-3/4/5). 2-tier boards (3x3, 3x4) skip the middle "BIG WIN"
// tier — their tier 0 maps to WIN (3), tier 1 straight to MEGA WIN (5).
// Full-board mode has no single shared tierIndex anymore — every
// qualifying symbol in `win.wins` is checked against its own symbol's
// tierIndex, and the banner shows whichever tier is highest across all of
// them (the payout amount itself is the sum of every qualifier's own-tier
// payout, computed server-side in payoutForFullBoard — this function only
// decides the banner's visual tier). Only ever called with a
// (boardSize, rewardMode) pair the server actually allows
// (ALLOWED_REWARD_MODES), so the lookups below should always find a table
// — FULL_BOARD_PAYTABLES simply has no 3x3/3x4 entry because full_board is
// never reachable on those sizes. Falling back to the 5x3 table (valid for
// both reward modes) rather than asserting non-null means a future
// prop-shape violation (e.g. a stale rewardMode mid re-render) degrades to
// a wrong-but-harmless tier instead of an uncaught render-time crash —
// this codebase has no error boundary, so that would white-screen the
// whole app, not just this modal. The fallback never affects the
// correct-path result.
function winTier(boardSize: SlotBoardSize, rewardMode: RewardMode, win: AnySlotWin): 3 | 4 | 5 {
  if (rewardMode === "full_board") {
    const table = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] ?? FULL_BOARD_PAYTABLES["5x3"];
    const { wins } = win as FullBoardSlotWin;
    let maxTier = 0;
    for (const w of wins) {
      const symbolConfig = table.symbols.find((s) => s.id === w.symbol);
      if (!symbolConfig) continue;
      const t = symbolConfig.tierIndex(w.count);
      if (t > maxTier) maxTier = t;
    }
    return maxTier >= 2 ? 5 : maxTier === 1 ? 4 : 3;
  }
  const table = SINGLE_ROW_PAYTABLES[boardSize] ?? SINGLE_ROW_PAYTABLES["5x3"]!;
  const tier = table.tierIndex((win as SlotWin).count);
  if (table.tierCount === 2) return tier >= 1 ? 5 : 3;
  return tier >= 2 ? 5 : tier === 1 ? 4 : 3;
}

const SYMBOL_DISPLAY_NAMES: Record<SlotSymbolId, string> = {
  dot: "Dot",
  square: "Square",
  diamond: "Diamond",
  star: "Star",
  seven: "Seven",
};

// Builds the info panel's title/description/rules from this instance's
// actual boardSize/rewardMode, reusing the same threshold/tierIndex data
// the paytable and winTier already read — no separate, hand-copied set of
// numbers to drift out of sync (see gameInfo.ts's generic "slots" fallback,
// which this replaces for the always-known-instance case).
function buildSlotsInfo(boardSize: SlotBoardSize, rewardMode: RewardMode): GameInfoEntry {
  const { rows, cols } = BOARD_DIMENSIONS[boardSize];
  if (rewardMode === "full_board") {
    const table = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] ?? FULL_BOARD_PAYTABLES["5x3"];
    return {
      title: "Slots",
      description: `A ${cols}-reel, ${rows}-row slot machine. Wins are counted across the whole board — rarer symbols need fewer matching cells to win than common ones, though common symbols still win more often overall.`,
      rules: table.symbols.map(
        (s) => `${SYMBOL_DISPLAY_NAMES[s.id]}: ${s.threshold}+ matching cells anywhere wins, with higher counts paying more.`
      ),
    };
  }
  const table = SINGLE_ROW_PAYTABLES[boardSize] ?? SINGLE_ROW_PAYTABLES["5x3"]!;
  return {
    title: "Slots",
    description: `A ${cols}-reel, ${rows}-row slot machine. Wins are counted on the middle row only.`,
    rules: [`${table.minCount}+ matching symbols anywhere on the middle row wins, with higher counts paying more.`],
  };
}
```

- [ ] **Step 2: Fix `activeFullBoardTable`'s stale type cast**

`FULL_BOARD_PAYTABLES` entries used to have the exact same shape as the
single-row `ClientPaytable` interface (both had `baselineRtp`, `tierIndex`,
`label`, `minCount`, `symbols: {id, pay}[]`), so `activeFullBoardTable` was
cast `as ClientPaytable | undefined`. That's no longer true — it must be
cast to the new `FullBoardClientPaytable` shape instead, or this won't
compile (or worse, will compile with the wrong type and silently allow
reading fields like `.label`/`.minCount` that no longer exist on it).

Find (around line 347):

```ts
  const activeFullBoardTable = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] as
    | ClientPaytable
    | undefined;
```

Replace with:

```ts
  const activeFullBoardTable = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] as
    | FullBoardClientPaytable
    | undefined;
```

- [ ] **Step 3: Update the `winTier` call site**

Find (around line 368):

```ts
  const tier = win ? winTier(boardSize, rewardMode, win.count) : null;
```

Replace with:

```ts
  const tier = win ? winTier(boardSize, rewardMode, win) : null;
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -b --noEmit`

Expected: still reports errors around the paytable-panel JSX (further down in `Slots.tsx`), since it still reads `activeFullBoardTable?.label` and `scaledFullBoardPay` in a way that assumes the old flat `{id, pay}` shape's `label` field, which no longer exists on `FullBoardClientPaytable`. That's fixed in Task 7. Confirm no *other* files (besides `Slots.tsx`) show errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/games/Slots.tsx
git commit -m "slots: per-symbol full-board paytable data, winTier, and info-panel rules"
```

---

### Task 7: Frontend — `Slots.tsx` paytable panel rendering

**Files:**
- Modify: `src/components/games/Slots.tsx:452-477` (the paytable header + row-rendering block)

- [ ] **Step 1: Replace the paytable header and rows**

Find the block starting at `<div className="mt-2 space-y-1.5">` (around line 451) through its closing `</div>` (around line 477):

```tsx
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {rewardMode === "full_board" ? activeFullBoardTable?.label : activeSingleRowTable?.label}
              </p>
              <button
                type="button"
                onClick={() => setShowPaytable((v) => !v)}
                aria-label={showPaytable ? "Hide paytable" : "Show paytable"}
                aria-pressed={showPaytable}
                className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPaytable ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {showPaytable &&
              (rewardMode === "full_board" ? scaledFullBoardPay : scaledSingleRowPay).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="sl-sym-mini">
                    <SlotSymbol design={activeDesign} id={s.id} />
                  </span>
                  <span className="text-muted-foreground font-mono">
                    {s.pay.map((x) => `${displayX(x)}x`).join(" · ")}
                  </span>
                </div>
              ))}
          </div>
```

Replace with:

```tsx
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {rewardMode === "full_board" ? "Paytable" : activeSingleRowTable?.label}
              </p>
              <button
                type="button"
                onClick={() => setShowPaytable((v) => !v)}
                aria-label={showPaytable ? "Hide paytable" : "Show paytable"}
                aria-pressed={showPaytable}
                className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPaytable ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {showPaytable &&
              rewardMode === "full_board" &&
              scaledFullBoardPay.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="sl-sym-mini">
                    <SlotSymbol design={activeDesign} id={s.id} />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-muted-foreground/70 font-mono text-[10px]">{s.rangeLabel}</span>
                    <span className="text-muted-foreground font-mono">
                      {s.pay.map((x) => `${displayX(x)}x`).join(" · ")}
                    </span>
                  </span>
                </div>
              ))}
            {showPaytable &&
              rewardMode !== "full_board" &&
              scaledSingleRowPay.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="sl-sym-mini">
                    <SlotSymbol design={activeDesign} id={s.id} />
                  </span>
                  <span className="text-muted-foreground font-mono">
                    {s.pay.map((x) => `${displayX(x)}x`).join(" · ")}
                  </span>
                </div>
              ))}
          </div>
```

`scaledFullBoardPay` (defined earlier in the component as `activeFullBoardTable.symbols.map((s) => ({ ...s, pay: s.pay.map((x) => x * scale) }))`) already carries `rangeLabel` through the spread — no change needed to that `useMemo`.

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`

Expected: PASS, no errors anywhere.

- [ ] **Step 3: Full project build**

Run: `npm run build`

Expected: builds successfully (this also re-type-checks via `tsc -b` per the `build` script).

- [ ] **Step 4: Commit**

```bash
git add src/components/games/Slots.tsx
git commit -m "slots: show each full-board symbol's own count-range in the paytable panel"
```

---

### Task 8: Deploy the edge function

**Files:** none (deployment step)

- [ ] **Step 1: Deploy the `slots` edge function**

The `supabase/functions/slots/` changes from Tasks 1-4 are local until deployed — use the `mcp__claude_ai_Supabase__deploy_edge_function` tool for the `slots` function against the `online-cassie` project (`tvivhadsgtvfvxwpahef`), passing the current contents of `supabase/functions/slots/engine.ts` and `supabase/functions/slots/index.ts`.

- [ ] **Step 2: Confirm deployment**

Use `mcp__claude_ai_Supabase__get_edge_function` (or `list_edge_functions`) to confirm the `slots` function's `updated_at` reflects the new deployment.

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npx vitest run`

Expected: PASS, all suites (including every file besides `supabase/functions/slots/engine.test.ts`).

- [ ] **Step 2: Full project type-check**

Run: `npx tsc -b --noEmit`

Expected: PASS.

- [ ] **Step 3: Manual Playwright verification**

Sign in with the seeded test admin account (`claudetest.cassie@gmail.com` / `ClaudeTest123!`, per `CLAUDE.md`). For each full-board-eligible board size (5x3, 3x6, 4x6):

- Open a slots instance set to that board size with `full_board` reward mode, and open the paytable panel — confirm every symbol row shows its own count-range label (e.g. dot "7-8 · 9 · 10+" on 5x3) rather than one shared header, and that the range labels match this plan's tables.
- Open the game-info panel (`GameInfoButton`) and confirm the rules list shows one bullet per symbol with that symbol's own threshold, not one shared "N+ matching cells" line.
- Spin until a win lands; confirm the WIN/BIG WIN/MEGA WIN banner text and lit cells look correct for whichever symbol(s) won.
- Confirm balance still deducts the instant a bet is placed (before the reel-drop animation resolves), unaffected by this change.
- At 375px and 1920px viewport widths, confirm the paytable panel's two-line rows (range label + pay multipliers) don't overflow or clip, per `CLAUDE.md`'s fill-sizing rules.

Note: triggering two *different* symbols winning in the same spin (the core new mechanic) is low-probability by design and impractical to force via the UI — that behavior is already covered authoritatively by Task 1's unit tests (`evaluateFullBoardWin`) and Task 2's (`payoutForFullBoard`). The Playwright pass here is for visual/UX correctness of the ordinary single-symbol-win and no-win paths, not for re-verifying the multi-win math.

- [ ] **Step 4: Report**

Summarize pass/fail for each check above. If everything passes, the feature is complete — no further commit needed for this task (verification only).
