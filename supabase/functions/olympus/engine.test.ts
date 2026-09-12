import { describe, it, expect } from "vitest";
import {
  COLS,
  ROWS,
  CELLS,
  MIN_MATCH,
  SYMBOLS,
  SYMBOL_WEIGHTS,
  PAYTABLE,
  ORB_WEIGHT,
  ORB_VALUES,
  ORB_VALUE_WEIGHTS,
  FREE_SPINS_ORB_WEIGHT,
  FREE_SPINS_COUNT,
  BASELINE_RTP,
  FREE_SPINS_BASELINE_EV,
  FREE_SPINS_FAIR_MULTIPLIER,
  FREE_SPINS_MULTIPLIER,
  HOUSE_EDGE_OPTIONS,
  DEFAULT_HOUSE_EDGE,
  MIN_HOUSE_EDGE,
  MAX_HOUSE_EDGE,
  edgeScale,
  freeSpinsCostMultiplier,
  freeSpinsCost,
  roundMoney,
  payFor,
  payoutFor,
  makeRng,
  isOrb,
  cellDistribution,
  drawCell,
  findWins,
  collapse,
  orbsOn,
  freshBoard,
  playRound,
  playFreeSpins,
  resolveHouseEdge,
  freeSpinsEnabled,
  type OlyBoard,
  type OlyCell,
  type OlySymbolId,
} from "./engine.ts";

// Builds a board from a compact [col][row] literal, so a test can state the
// exact arrangement it cares about instead of fishing one out of an rng.
function boardOf(cols: OlyCell[][]): OlyBoard {
  return cols.map((col) => [...col]);
}

/**
 * A board of `count` `symbol` cells. The remaining cells cycle through the
 * other seven symbols rather than repeating one — spread that thinly none of
 * them can reach MIN_MATCH itself (30 cells over 7 fillers is at most 5 each),
 * so a test asserting "only `symbol` won" is testing what it says it is.
 */
function boardWith(symbol: OlySymbolId, count: number): OlyBoard {
  const fillers = SYMBOLS.filter((id) => id !== symbol);
  const flat: OlyCell[] = Array.from({ length: CELLS }, (_, i) =>
    i < count ? symbol : fillers[(i - count) % fillers.length]
  );
  return Array.from({ length: COLS }, (_, c) => flat.slice(c * ROWS, c * ROWS + ROWS));
}

describe("shape", () => {
  it("is a 6x5 board of 30 cells", () => {
    expect(COLS).toBe(6);
    expect(ROWS).toBe(5);
    expect(CELLS).toBe(30);
  });

  it("lists a paytable row for every symbol, richest first", () => {
    expect(SYMBOLS).toHaveLength(8);
    for (const id of SYMBOLS) expect(PAYTABLE[id]).toHaveLength(3);
    // Richest-first ordering is what findWins relies on to return wins in a
    // stable order, so it is a contract, not a formatting preference.
    const topPays = SYMBOLS.map((id) => PAYTABLE[id][0]);
    expect([...topPays].sort((a, b) => b - a)).toEqual(topPays);
  });

  it("only deals orb values that have painted badge art", () => {
    // public/olympus/multipliers holds one .webp per value; a value with no
    // badge would render as a blank cell.
    expect(ORB_VALUES).toEqual([2, 5, 25, 50]);
  });
});

describe("payFor", () => {
  it("pays nothing below MIN_MATCH", () => {
    for (const id of SYMBOLS) {
      for (let n = 0; n < MIN_MATCH; n++) expect(payFor(id, n)).toBe(0);
    }
  });

  it("steps through the three tiers at 8-9, 10-11 and 12+", () => {
    const [low, mid, high] = PAYTABLE.ruby;
    expect(payFor("ruby", 8)).toBe(low);
    expect(payFor("ruby", 9)).toBe(low);
    expect(payFor("ruby", 10)).toBe(mid);
    expect(payFor("ruby", 11)).toBe(mid);
    expect(payFor("ruby", 12)).toBe(high);
    expect(payFor("ruby", CELLS)).toBe(high);
  });
});

describe("findWins", () => {
  it("finds a symbol that reaches MIN_MATCH and not one that falls short", () => {
    expect(findWins(boardWith("ruby", MIN_MATCH)).map((w) => w.symbol)).toContain("ruby");
    expect(findWins(boardWith("ruby", MIN_MATCH - 1)).map((w) => w.symbol)).not.toContain("ruby");
  });

  it("never counts an orb toward a match", () => {
    // Eight rubies, but one cell is an orb sitting where a ninth would be.
    const board = boardWith("ruby", MIN_MATCH);
    board[COLS - 1][ROWS - 1] = { kind: "orb", value: 25 };
    const wins = findWins(board);
    expect(wins.find((w) => w.symbol === "ruby")?.count).toBe(MIN_MATCH);
    // …and the orb is no symbol of its own.
    expect(wins.map((w) => w.symbol)).not.toContain("orb" as OlySymbolId);
  });

  it("never counts a hole toward a match", () => {
    // Nine rubies with one of them punched out still clears the threshold at
    // eight — the hole simply isn't a ruby any more.
    const board = boardWith("ruby", MIN_MATCH + 1);
    board[0][0] = null;
    expect(() => findWins(board)).not.toThrow();
    expect(findWins(board).find((w) => w.symbol === "ruby")?.count).toBe(MIN_MATCH);
  });

  it("pays more than one symbol on the same board", () => {
    // 8 rubies + 8 emeralds, and the remaining 14 cells split between two
    // fillers so neither of THEM reaches MIN_MATCH — every symbol is judged
    // against the threshold independently, so a 14-cell filler would quietly
    // become a third winner and the assertion would be testing nothing.
    const flat: OlyCell[] = [
      ...Array<OlyCell>(8).fill("ruby"),
      ...Array<OlyCell>(8).fill("emerald"),
      ...Array<OlyCell>(7).fill("bolt"),
      ...Array<OlyCell>(7).fill("coin"),
    ];
    const board = Array.from({ length: COLS }, (_, c) => flat.slice(c * ROWS, c * ROWS + ROWS));
    expect(findWins(board).map((w) => w.symbol).sort()).toEqual(["emerald", "ruby"]);
  });

  it("pays a symbol scattered across the board, not only one in a cluster", () => {
    // There are no paylines and no adjacency rule: eight rubies dotted one
    // per column-ish pay exactly as eight stacked in a corner would.
    const board = boardWith("ruby", 0);
    const spots: [number, number][] = [
      [0, 0], [1, 4], [2, 2], [3, 0], [4, 3], [5, 1], [0, 4], [3, 3],
    ];
    for (const [col, row] of spots) board[col][row] = "ruby";
    const win = findWins(board).find((w) => w.symbol === "ruby");
    expect(win?.count).toBe(MIN_MATCH);
  });

  it("scales pays by the house edge and leaves counts alone", () => {
    const raw = findWins(boardWith("ruby", 10))[0];
    const scaled = findWins(boardWith("ruby", 10), 0.03)[0];
    expect(scaled.count).toBe(raw.count);
    expect(scaled.pay).toBeCloseTo(raw.pay * edgeScale(0.03), 12);
  });
});

describe("collapse", () => {
  it("drops survivors to the bottom of their own column and puts holes on top", () => {
    const board = boardOf([
      ["ruby", null, "bolt", null, "coin"],
      ["ruby", "ruby", "ruby", "ruby", "ruby"],
      [null, null, null, null, null],
      ["coin", "coin", "coin", "coin", "coin"],
      ["bolt", null, null, null, null],
      [null, null, null, null, "bolt"],
    ]);
    const out = collapse(board);
    expect(out[0]).toEqual([null, null, "ruby", "bolt", "coin"]);
    expect(out[1]).toEqual(["ruby", "ruby", "ruby", "ruby", "ruby"]);
    expect(out[2]).toEqual([null, null, null, null, null]);
    expect(out[4]).toEqual([null, null, null, null, "bolt"]);
    // A column never leaks a cell into its neighbour.
    expect(out.every((col) => col.length === ROWS)).toBe(true);
  });

  it("never moves a symbol between columns", () => {
    const rng = makeRng(1234);
    const dist = cellDistribution(ORB_WEIGHT);
    for (let i = 0; i < 200; i++) {
      const board = freshBoard(rng, dist);
      // Punch random holes, then check each column's survivors kept both
      // their column and their relative order.
      const holed = board.map((col) => col.map((c) => (rng() < 0.4 ? null : c)));
      const out = collapse(holed);
      for (let c = 0; c < COLS; c++) {
        const before = holed[c].filter((cell) => cell !== null);
        const after = out[c].filter((cell) => cell !== null);
        expect(after).toEqual(before);
      }
    }
  });
});

describe("the cell draw", () => {
  it("gives the orb exactly its configured share", () => {
    const rng = makeRng(7);
    const dist = cellDistribution(ORB_WEIGHT);
    let orbs = 0;
    const n = 400_000;
    for (let i = 0; i < n; i++) if (isOrb(drawCell(rng, dist))) orbs++;
    // ~1% of 400k draws; 4 sigma is about 0.0006.
    expect(orbs / n).toBeGreaterThan(ORB_WEIGHT - 0.001);
    expect(orbs / n).toBeLessThan(ORB_WEIGHT + 0.001);
  });

  it("draws orbs three times as often during free spins", () => {
    expect(FREE_SPINS_ORB_WEIGHT).toBeCloseTo(ORB_WEIGHT * 3, 12);
  });

  it("only ever draws a value that has badge art", () => {
    const rng = makeRng(11);
    const dist = cellDistribution(0.5); // orb-heavy, so this covers the table fast
    for (let i = 0; i < 20_000; i++) {
      const cell = drawCell(rng, dist);
      if (isOrb(cell)) expect(ORB_VALUES).toContain(cell.value);
    }
  });

  it("normalises the symbol weights to the non-orb share", () => {
    const dist = cellDistribution(ORB_WEIGHT);
    // The cumulative table must end at exactly 1, or the tail symbol silently
    // absorbs the remainder.
    expect(dist[dist.length - 1][1]).toBe(1);
    expect(dist[dist.length - 1][0]).toBe("orb");
    // The last symbol's cumulative edge is where the orb slice begins.
    expect(dist[dist.length - 2][1]).toBeCloseTo(1 - ORB_WEIGHT, 12);
  });
});

describe("a symbol's rarity and how often it wins", () => {
  // The design rests on a strict ordering: a symbol that pays more is rarer,
  // and therefore wins less often. Weights alone don't guarantee that once
  // MIN_MATCH is a binomial tail, so it's asserted directly.
  it("orders win frequency the same way it orders the paytable", () => {
    const rng = makeRng(20260912);
    const dist = cellDistribution(ORB_WEIGHT);
    const hits: Record<string, number> = Object.fromEntries(SYMBOLS.map((id) => [id, 0]));
    for (let i = 0; i < 400_000; i++) {
      for (const w of findWins(freshBoard(rng, dist))) hits[w.symbol]++;
    }
    // SYMBOLS is richest-first, so hit counts must be strictly increasing
    // along it: the richest symbol is the rarest winner.
    for (let i = 1; i < SYMBOLS.length; i++) {
      expect(hits[SYMBOLS[i]]).toBeGreaterThan(hits[SYMBOLS[i - 1]]);
    }
  });

  it("weights every symbol below the one commoner than it", () => {
    for (let i = 1; i < SYMBOLS.length; i++) {
      expect(SYMBOL_WEIGHTS[SYMBOLS[i]]).toBeGreaterThan(SYMBOL_WEIGHTS[SYMBOLS[i - 1]]);
    }
  });
});

describe("playRound", () => {
  it("is reproducible from a seed", () => {
    const a = playRound(makeRng(42), 0.03);
    const b = playRound(makeRng(42), 0.03);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("always ends on a board that has settled", () => {
    const rng = makeRng(99);
    for (let i = 0; i < 3000; i++) {
      const round = playRound(rng, 0.03);
      const last = round.steps[round.steps.length - 1];
      expect(last.wins).toHaveLength(0);
      expect(findWins(last.board)).toHaveLength(0);
    }
  });

  it("hands out no board with a hole in it", () => {
    const rng = makeRng(5);
    for (let i = 0; i < 800; i++) {
      for (const step of playRound(rng, 0.03).steps) {
        for (const col of step.board) for (const cell of col) expect(cell).not.toBeNull();
      }
    }
  });

  it("only ever deals an orb into a cell that falls in from above", () => {
    // An orb may only arrive in a hole. Dealt onto a settled board instead it
    // would overwrite a cell that stayed put, and the player would watch it
    // pop into existence in place with nothing to fall.
    const rng = makeRng(8123);
    let cascades = 0;
    for (let i = 0; i < 6000 && cascades < 200; i++) {
      const round = playRound(rng, 0.03);
      for (let s = 1; s < round.steps.length; s++) {
        const prev = round.steps[s - 1];
        const cleared = new Set(
          prev.wins.flatMap((w) => w.positions).map((p) => `${p.col}:${p.row}`)
        );
        // Where each column's survivors end up: the bottom N cells of it.
        for (const orb of round.steps[s].orbs) {
          const wasThere = prev.orbs.some((o) => o.col === orb.col && o.row === orb.row);
          if (wasThere) continue; // rode in from the previous board
          // A new orb's column must have cleared at least one cell this step,
          // or there was no hole for it to drop into.
          const clearedInColumn = [...cleared].filter((k) =>
            k.startsWith(`${orb.col}:`)
          ).length;
          expect(clearedInColumn).toBeGreaterThan(0);
        }
        cascades++;
      }
    }
    expect(cascades).toBeGreaterThan(0);
  });

  it("cannot cascade forever", () => {
    // The MAX_STEPS guard exists so a bug can never hang the edge function.
    // Nothing should come anywhere near it in ordinary play.
    const rng = makeRng(606060);
    let longest = 0;
    for (let i = 0; i < 50_000; i++) {
      longest = Math.max(longest, playRound(rng, 0.03).steps.length);
    }
    expect(longest).toBeLessThan(200);
  });

  it("keeps every orb standing until the round ends", () => {
    const rng = makeRng(31337);
    let checked = 0;
    for (let i = 0; i < 4000 && checked < 40; i++) {
      const round = playRound(rng, 0.03);
      if (round.steps.length < 3) continue; // want a round that actually cascaded
      const settled = round.steps[round.steps.length - 1];
      // Every orb seen on any step is still on the settled board, at the same
      // value — orbs ride the cascade rather than popping with the winners.
      for (const step of round.steps) {
        for (const orb of step.orbs) {
          expect(settled.orbs.some((o) => o.value === orb.value)).toBe(true);
        }
        // An orb count can only ever grow as the cascade refills.
        expect(settled.orbs.length).toBeGreaterThanOrEqual(step.orbs.length);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("reports the multiplier as the sum of the orbs left standing", () => {
    const rng = makeRng(777);
    let checked = 0;
    for (let i = 0; i < 20_000 && checked < 50; i++) {
      const round = playRound(rng, 0.03);
      if (round.multiplier === 0) continue;
      const settled = round.steps[round.steps.length - 1];
      expect(round.multiplier).toBe(settled.orbs.reduce((s, o) => s + o.value, 0));
      // Exact, not approximate: playRound rounds baseWin before multiplying
      // precisely so this identity holds for anyone reading it off the screen.
      expect(round.totalWin).toBe(roundMoney(round.baseWin * round.multiplier));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("leaves orbs uncollected on a round that paid nothing", () => {
    const rng = makeRng(2024);
    let checked = 0;
    for (let i = 0; i < 20_000 && checked < 50; i++) {
      const round = playRound(rng, 0.03);
      if (round.baseWin > 0) continue;
      const settled = round.steps[round.steps.length - 1];
      if (settled.orbs.length === 0) continue;
      // Orbs are on the board, but there is nothing for them to multiply, so
      // the round reports no multiplier rather than an "x5" over zero.
      expect(round.multiplier).toBe(0);
      expect(round.totalWin).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("changes what a win pays with the edge, but never what the board does", () => {
    // Same seed at two different edges: identical boards, proportional pays.
    const cheap = playRound(makeRng(8080), MIN_HOUSE_EDGE);
    const dear = playRound(makeRng(8080), MAX_HOUSE_EDGE);
    expect(cheap.steps.map((s) => s.board)).toEqual(dear.steps.map((s) => s.board));
    expect(cheap.multiplier).toBe(dear.multiplier);
    if (cheap.baseWin > 0) {
      const ratio = edgeScale(MAX_HOUSE_EDGE) / edgeScale(MIN_HOUSE_EDGE);
      // Taken on the raw step pays, which carry no rounding: this is the
      // actual invariant, and it holds to the last bit. Doing it on baseWin
      // instead measures how much of a chip the 4dp rounding moved, which
      // varies with how big the win happened to be and says nothing about
      // the scaling.
      const rawPay = (r: typeof cheap) => r.steps.reduce((sum, s) => sum + s.stepWin, 0);
      expect(rawPay(dear) / rawPay(cheap)).toBeCloseTo(ratio, 10);
      // And the rounded figure the player is shown still tracks it, to within
      // the rounding itself.
      expect(dear.baseWin).toBeCloseTo(cheap.baseWin * ratio, 3);
    }
  });

  it("pays a stake proportionally", () => {
    const round = playRound(makeRng(606), 0.03);
    expect(payoutFor(round, 10)).toBeCloseTo(roundMoney(round.totalWin * 10), 4);
    expect(payoutFor(round, 0)).toBe(0);
  });
});

describe("playFreeSpins", () => {
  it("plays the configured number of spins", () => {
    expect(playFreeSpins(makeRng(1), 0.03).spins).toHaveLength(FREE_SPINS_COUNT);
    expect(playFreeSpins(makeRng(1), 0.03, 4).spins).toHaveLength(4);
  });

  it("carries one multiplier across the whole batch", () => {
    const batch = playFreeSpins(makeRng(4242), 0.03);
    let expected = 0;
    for (const spin of batch.spins) {
      expect(spin.multiplierBefore).toBe(expected);
      expected += spin.round.multiplier;
      expect(spin.multiplierAfter).toBe(expected);
      // It can only ever grow — nothing in a batch resets it.
      expect(spin.multiplierAfter).toBeGreaterThanOrEqual(spin.multiplierBefore);
    }
  });

  it("pays each spin at the running total, not at its own orbs alone", () => {
    const batch = playFreeSpins(makeRng(31415), 0.03);
    for (const spin of batch.spins) {
      expect(spin.spinWin).toBeCloseTo(
        roundMoney(spin.round.baseWin * (spin.multiplierAfter || 1)),
        4
      );
    }
    expect(batch.totalWin).toBeCloseTo(
      roundMoney(batch.spins.reduce((s, x) => s + x.spinWin, 0)),
      4
    );
  });

  it("is worth more than the same spins played independently", () => {
    // The whole point of the persistent multiplier: a batch beats the sum of
    // its rounds taken alone. Averaged, because a single batch can go either
    // way when nothing is ever collected.
    const rng = makeRng(20260913);
    let batched = 0;
    let standalone = 0;
    for (let i = 0; i < 4000; i++) {
      const batch = playFreeSpins(rng, 0.03);
      batched += batch.totalWin;
      standalone += batch.spins.reduce((s, x) => s + x.round.totalWin, 0);
    }
    expect(batched).toBeGreaterThan(standalone);
  });

  it("banks nothing from a spin that paid nothing", () => {
    const batch = playFreeSpins(makeRng(555), 0.03, 60);
    for (const spin of batch.spins) {
      if (spin.round.baseWin === 0) {
        expect(spin.multiplierAfter).toBe(spin.multiplierBefore);
        expect(spin.spinWin).toBe(0);
      }
    }
  });
});

describe("the house edge", () => {
  it("offers 1%-5% and defaults to 3%", () => {
    expect(HOUSE_EDGE_OPTIONS).toEqual([0.01, 0.02, 0.03, 0.04, 0.05]);
    expect(DEFAULT_HOUSE_EDGE).toBe(0.03);
    // No 0% option: Olympus always keeps an edge.
    expect(MIN_HOUSE_EDGE).toBeGreaterThan(0);
  });

  it("scales the table down harder as the edge grows", () => {
    for (let i = 1; i < HOUSE_EDGE_OPTIONS.length; i++) {
      expect(edgeScale(HOUSE_EDGE_OPTIONS[i])).toBeLessThan(edgeScale(HOUSE_EDGE_OPTIONS[i - 1]));
    }
  });

  it("coerces anything off the menu to the default", () => {
    expect(resolveHouseEdge({ houseEdge: 0.02 })).toBe(0.02);
    // The menu is the gate, not the admin UI: an edge nobody could pick in
    // the dropdown is not honoured just because it arrived in the row.
    expect(resolveHouseEdge({ houseEdge: 0 })).toBe(DEFAULT_HOUSE_EDGE);
    expect(resolveHouseEdge({ houseEdge: 0.5 })).toBe(DEFAULT_HOUSE_EDGE);
    expect(resolveHouseEdge({ houseEdge: -1 })).toBe(DEFAULT_HOUSE_EDGE);
    expect(resolveHouseEdge({ houseEdge: "0.02" })).toBe(DEFAULT_HOUSE_EDGE);
    expect(resolveHouseEdge({})).toBe(DEFAULT_HOUSE_EDGE);
    expect(resolveHouseEdge(null)).toBe(DEFAULT_HOUSE_EDGE);
    expect(resolveHouseEdge(undefined)).toBe(DEFAULT_HOUSE_EDGE);
  });

  it("survives the float round-trip a jsonb column puts it through", () => {
    for (const edge of HOUSE_EDGE_OPTIONS) {
      expect(resolveHouseEdge(JSON.parse(JSON.stringify({ houseEdge: edge })))).toBe(edge);
    }
  });
});

describe("the free-spins switch", () => {
  it("is on for a row nobody has configured", () => {
    // A freshly enabled casino_games row is settings = '{}', and it should
    // play the whole game rather than a cut-down one.
    expect(freeSpinsEnabled({})).toBe(true);
    expect(freeSpinsEnabled(null)).toBe(true);
    expect(freeSpinsEnabled({ freeSpins: {} })).toBe(true);
    expect(freeSpinsEnabled({ freeSpins: { enabled: true } })).toBe(true);
  });

  it("is off only when an admin actually turned it off", () => {
    expect(freeSpinsEnabled({ freeSpins: { enabled: false } })).toBe(false);
  });
});

describe("what a batch costs", () => {
  it("is the same multiple of the stake at every edge", () => {
    // The (1 - edge) in the scaled pays cancels the (1 - edge) the price has
    // to return, so the price does not move with the edge — only what the
    // spins pay does. See freeSpinsCostMultiplier's comment.
    expect(freeSpinsCostMultiplier()).toBe(FREE_SPINS_MULTIPLIER);
    expect(freeSpinsCost(10)).toBeCloseTo(roundMoney(10 * FREE_SPINS_MULTIPLIER), 4);
  });

  it("charges a whole multiple of the stake", () => {
    // Rounded off the calibrated figure on purpose, so a whole stake always
    // buys at a whole price. See freeSpinsCostMultiplier's comment.
    expect(Number.isInteger(freeSpinsCostMultiplier())).toBe(true);
  });

  it("stays within a percent of the mathematically fair price", () => {
    // The rounding above is only allowed to move the price by a rounding
    // error's worth. Anything larger is a calibration bug, not a tidy number.
    const drift = Math.abs(freeSpinsCostMultiplier() / FREE_SPINS_FAIR_MULTIPLIER - 1);
    expect(drift).toBeLessThan(0.01);
  });

  it("never prices a batch above the fair price", () => {
    // Whichever way the rounding lands, it must not land in the house's
    // favour: a bought batch may return slightly more than (1 - edge) of its
    // price, never less.
    expect(freeSpinsCostMultiplier()).toBeLessThanOrEqual(FREE_SPINS_FAIR_MULTIPLIER);
  });

  it("prices every whole-chip stake on the ladder at a whole number of chips", () => {
    // Olympus's STAKE_LADDER is a 1 / 2 / 5 progression per decade, so these
    // are the stops a player actually walks past 0.1 chips.
    const stakes = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 10_000, 1_000_000];
    for (const stake of stakes) {
      expect(Number.isInteger(freeSpinsCost(stake))).toBe(true);
    }
  });

  it("prices a batch well above its per-spin stake", () => {
    // Sanity rail on the calibration: fifteen spins whose multiplier persists
    // are worth many times one spin, but not a thousand times.
    expect(freeSpinsCostMultiplier()).toBeGreaterThan(15);
    expect(freeSpinsCostMultiplier()).toBeLessThan(500);
    expect(freeSpinsCost(10)).toBeCloseTo(roundMoney(10 * freeSpinsCostMultiplier()), 4);
  });
});

// These are the tests that actually hold the 3% promise. They're the slowest
// in the file by a distance, and they are deliberately kept: a mistake in the
// edge scaling — or a change to the weights without re-running
// scripts/calibrate-olympus.mjs — shows up here and nowhere else.
//
// Tolerance is wide (±8% relative) because the payout distribution is heavily
// right-tailed: a handful of huge multiplied cascades dominate the mean, so a
// sample this size still wanders a couple of percent either way. It is still
// far tighter than any plausible bug — forgetting to scale at all would land
// ~3% high in an absolute sense but a wrong BASELINE would be off by tens of
// percent.
describe("realized RTP", () => {
  const TOLERANCE = 0.08;

  it("returns (1 - edge) of the bet in the base game", { timeout: 60_000 }, () => {
    const rng = makeRng(864231);
    const edge = DEFAULT_HOUSE_EDGE;
    const rounds = 500_000;
    let paid = 0;
    for (let i = 0; i < rounds; i++) paid += playRound(rng, edge).totalWin;
    const rtp = paid / rounds;
    expect(rtp).toBeGreaterThan((1 - edge) * (1 - TOLERANCE));
    expect(rtp).toBeLessThan((1 - edge) * (1 + TOLERANCE));
  });

  it("returns (1 - edge) of the price on a bought batch", { timeout: 60_000 }, () => {
    const rng = makeRng(135791);
    const edge = DEFAULT_HOUSE_EDGE;
    const batches = 50_000;
    const stake = 1;
    const cost = freeSpinsCost(stake);
    let paid = 0;
    for (let i = 0; i < batches; i++) paid += playFreeSpins(rng, edge).totalWin * stake;
    const rtp = paid / (batches * cost);
    expect(rtp).toBeGreaterThan((1 - edge) * (1 - TOLERANCE));
    expect(rtp).toBeLessThan((1 - edge) * (1 + TOLERANCE));
  });

  it("pays out about a quarter of base spins", () => {
    // Not an RTP claim — a feel claim. A cascade slot that pays on 60% of
    // spins (as the showcase's demo weights did) or on 5% is a different game
    // from this one, and either would slip past the RTP tests above.
    const rng = makeRng(246800);
    const rounds = 200_000;
    let hits = 0;
    for (let i = 0; i < rounds; i++) if (playRound(rng, DEFAULT_HOUSE_EDGE).totalWin > 0) hits++;
    const hitRate = hits / rounds;
    expect(hitRate).toBeGreaterThan(0.2);
    expect(hitRate).toBeLessThan(0.35);
  });
});

describe("roundMoney", () => {
  it("keeps four decimals, the chip precision the balance column stores", () => {
    expect(roundMoney(1.00005)).toBe(1.0001);
    expect(roundMoney(0.123456)).toBe(0.1235);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe("orb value weights", () => {
  it("sums to one so the table carries no silent remainder", () => {
    expect(ORB_VALUE_WEIGHTS.reduce((s, o) => s + o.weight, 0)).toBeCloseTo(1, 12);
  });

  it("makes the big badges the rare ones", () => {
    const weights = ORB_VALUE_WEIGHTS.map((o) => o.weight);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeLessThan(weights[i - 1]);
  });
});

describe("orbsOn", () => {
  it("reports every orb with its position and value", () => {
    const board = boardWith("ruby", 0);
    board[2][3] = { kind: "orb", value: 25 };
    board[5][0] = { kind: "orb", value: 2 };
    expect(orbsOn(board)).toEqual([
      { col: 2, row: 3, value: 25 },
      { col: 5, row: 0, value: 2 },
    ]);
  });

  it("finds nothing on a board of plain symbols", () => {
    expect(orbsOn(boardWith("ruby", CELLS))).toEqual([]);
  });
});
