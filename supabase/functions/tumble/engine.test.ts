import { describe, it, expect } from "vitest";
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

function queue(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

// Builds a board from 30 symbols in spinBoard's fill order (column by
// column, top to bottom).
function boardOf(cells: SymbolId[]): Board {
  expect(cells).toHaveLength(CELLS);
  const board: Board = [];
  for (let c = 0; c < COLS; c++) board.push(cells.slice(c * ROWS, c * ROWS + ROWS));
  return board;
}

function repeat(counts: Partial<Record<SymbolId, number>>): SymbolId[] {
  const out: SymbolId[] = [];
  for (const [id, n] of Object.entries(counts)) for (let i = 0; i < (n as number); i++) out.push(id as SymbolId);
  return out;
}

describe("board shape", () => {
  it("is a fixed 5x6 board", () => {
    expect(ROWS).toBe(5);
    expect(COLS).toBe(6);
    expect(CELLS).toBe(30);
  });

  it("spinBoard fills every cell, column by column", () => {
    const board = spinBoard(queue([0.1]));
    expect(board).toHaveLength(COLS);
    for (const col of board) expect(col).toHaveLength(ROWS);
  });
});

describe("symbol table", () => {
  it("weights (five symbols plus X) sum to exactly 1", () => {
    expect(SYMBOLS.reduce((s, x) => s + x.weight, 0) + X_WEIGHT).toBeCloseTo(1, 10);
  });

  it("X value distribution sums to exactly 1", () => {
    expect(X_VALUES.reduce((s, v) => s + v.weight, 0)).toBeCloseTo(1, 10);
  });

  it("every X value is within the advertised 2x-25x range", () => {
    for (const v of X_VALUES) {
      expect(v.value).toBeGreaterThanOrEqual(2);
      expect(v.value).toBeLessThanOrEqual(25);
    }
  });

  it("a rarer symbol needs strictly fewer cells and pays strictly more", () => {
    for (let i = 1; i < SYMBOLS.length; i++) {
      const prev = SYMBOLS[i - 1];
      const cur = SYMBOLS[i];
      expect(cur.weight).toBeLessThan(prev.weight);
      expect(cur.threshold).toBeLessThan(prev.threshold);
      for (let tier = 0; tier < 3; tier++) expect(cur.pay[tier]).toBeGreaterThan(prev.pay[tier]);
    }
  });

  it("every symbol's pay rises with its tier", () => {
    for (const s of SYMBOLS) {
      expect(s.pay[1]).toBeGreaterThan(s.pay[0]);
      expect(s.pay[2]).toBeGreaterThan(s.pay[1]);
    }
  });

  // The balance the whole design rests on: a rare symbol needs fewer cells,
  // but "a lot of a common symbol" must still be MORE likely than "a few of
  // a rare one". Exact binomial tail over the 30 opening cells.
  it("a rarer symbol still wins strictly less often than every commoner one", () => {
    const logC = (n: number, k: number) => {
      let s = 0;
      for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1);
      return s;
    };
    const tail = (t: number, p: number) => {
      let s = 0;
      for (let k = t; k <= CELLS; k++) s += Math.exp(logC(CELLS, k) + k * Math.log(p) + (CELLS - k) * Math.log(1 - p));
      return s;
    };
    const probs = SYMBOLS.map((s) => tail(s.threshold, s.weight));
    for (let i = 1; i < probs.length; i++) expect(probs[i]).toBeLessThan(probs[i - 1]);
    // Guards the headline property against a future re-tune quietly eroding
    // it: the commonest symbol must win far more often than the rarest.
    expect(probs[0]).toBeGreaterThan(probs[4] * 10);
  });
});

describe("house edge", () => {
  it("offers a fixed 1-5% menu with no 0% option", () => {
    expect(HOUSE_EDGE_OPTIONS).toEqual([0.01, 0.02, 0.03, 0.04, 0.05]);
    expect(MIN_HOUSE_EDGE).toBe(0.01);
    expect(MAX_HOUSE_EDGE).toBe(0.05);
    expect(HOUSE_EDGE_OPTIONS).toContain(DEFAULT_HOUSE_EDGE);
  });

  it("scales the pay table so the picked edge is the realized RTP", () => {
    for (const edge of HOUSE_EDGE_OPTIONS) {
      expect(edgeScale(edge) * BASELINE_RTP).toBeCloseTo(1 - edge, 12);
    }
  });

  it("a bigger edge pays strictly less", () => {
    for (let i = 1; i < HOUSE_EDGE_OPTIONS.length; i++) {
      expect(edgeScale(HOUSE_EDGE_OPTIONS[i])).toBeLessThan(edgeScale(HOUSE_EDGE_OPTIONS[i - 1]));
    }
  });
});

describe("tierIndex", () => {
  it("maps count to [threshold, +1, +2 or more]", () => {
    expect(tierIndex(9, 9)).toBe(0);
    expect(tierIndex(10, 9)).toBe(1);
    expect(tierIndex(11, 9)).toBe(2);
    expect(tierIndex(30, 9)).toBe(2);
  });
});

describe("evaluateBoard", () => {
  it("pays nothing when no symbol reaches its own threshold", () => {
    const board = boardOf(repeat({ dot: 6, square: 6, diamond: 6, star: 6, seven: 6 }));
    expect(evaluateBoard(board)).toEqual([]);
  });

  it("pays a symbol that reaches its own threshold", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    const wins = evaluateBoard(board);
    expect(wins).toHaveLength(1);
    expect(wins[0].symbol).toBe("dot");
    expect(wins[0].count).toBe(15);
    expect(wins[0].tier).toBe(0);
    expect(wins[0].positions).toHaveLength(15);
  });

  // Each symbol is judged against its own threshold independently, so a
  // board can pay several symbols at once with no tie-break.
  it("pays every symbol that independently qualifies", () => {
    const board = boardOf(repeat({ dot: 15, seven: 8, square: 7 }));
    const wins = evaluateBoard(board);
    expect(wins.map((w) => w.symbol).sort()).toEqual(["dot", "seven"]);
    const total = wins.reduce((s, w) => s + w.pay, 0);
    expect(total).toBeCloseTo(0.25 + 6, 10);
  });

  it("reports every cell of a winning symbol as a position", () => {
    const board = boardOf(repeat({ star: 9, dot: 14, square: 7 }));
    const win = evaluateBoard(board).find((w) => w.symbol === "star")!;
    expect(win.positions).toHaveLength(9);
    for (const p of win.positions) expect(board[p.col][p.row]).toBe("star");
  });

  it("scales pays by the house edge when one is given", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    const raw = evaluateBoard(board)[0].pay;
    const scaled = evaluateBoard(board, 0.05)[0].pay;
    expect(scaled).toBeCloseTo(raw * edgeScale(0.05), 12);
  });
});

describe("tumble", () => {
  it("pops every winning cell, drops survivors, and rains in from the top", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    const wins = evaluateBoard(board);
    // Fresh draws are all sevens, so refilled cells are unmistakable.
    const next = tumble(board, wins, queue([0.95]));

    expect(next).toHaveLength(COLS);
    for (const col of next) expect(col).toHaveLength(ROWS);
    expect(countSymbols(next).dot).toBe(0);
    expect(countSymbols(next).seven).toBe(15);
    // Survivors keep their relative order and settle at the bottom.
    for (const col of next) {
      const firstSurvivor = col.findIndex((s) => s !== "seven");
      if (firstSurvivor === -1) continue;
      for (let r = firstSurvivor; r < ROWS; r++) expect(col[r]).not.toBe("seven");
    }
  });

  it("leaves non-winning symbols untouched", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    const next = tumble(board, evaluateBoard(board), queue([0.95]));
    const counts = countSymbols(next);
    expect(counts.square).toBe(11);
    expect(counts.diamond).toBe(4);
  });

  it("always returns a full board, X cells included", () => {
    const board = boardOf(repeat({ dot: 15, seven: 8, square: 7 }));
    const next = tumble(board, evaluateBoard(board), Math.random);
    const counts = countSymbols(next);
    const xCells = next.flat().filter((cell) => typeof cell !== "string").length;
    expect(Object.values(counts).reduce((a, b) => a + b, 0) + xCells).toBe(CELLS);
  });
});

describe("playRound", () => {
  it("records no steps and pays nothing on a losing spin", () => {
    // 6 of each symbol: nothing reaches its threshold.
    const cells = [0.1, 0.5, 0.7, 0.85, 0.95];
    const draws: number[] = [];
    for (let i = 0; i < 6; i++) draws.push(...cells);
    const round = playRound(queue(draws));
    expect(round.steps).toEqual([]);
    expect(round.basePay).toBe(0);
    expect(round.multiplier).toBe(1);
    expect(round.totalMultiplier).toBe(0);
    expect(payoutFor(round, 100)).toBe(0);
    expect(countSymbols(round.finalBoard)).toEqual({ dot: 6, square: 6, diamond: 6, star: 6, seven: 6 });
  });

  it("multiplier is 1 when no X lands, so X never pays on its own", () => {
    const cells = [0.1, 0.5, 0.7, 0.85, 0.95];
    const draws: number[] = [];
    for (let i = 0; i < 6; i++) draws.push(...cells);
    const round = playRound(queue(draws));
    expect(round.multiplier).toBe(1);
    expect(round.totalMultiplier).toBe(0);
  });

  it("chains tumbles and sums every step's pay", () => {
    // 0.01 draws dot everywhere, so the opening board is 30 dots and each
    // refill is dots again — the chain only ends at MAX_TUMBLES, which is
    // enough to prove pays accumulate across steps.
    const round = playRound(queue([0.01]));
    expect(round.steps.length).toBeGreaterThan(1);
    const summed = round.steps.reduce((s, step) => s + step.pay, 0);
    expect(round.basePay).toBeCloseTo(summed, 8);
    expect(round.totalMultiplier).toBeCloseTo(round.basePay * round.multiplier, 8);
  });

  it("each step's board is the previous step's board after tumbling", () => {
    const round = playRound(Math.random);
    for (let i = 1; i < round.steps.length; i++) {
      const prev = round.steps[i - 1];
      const expected = tumble(prev.board, prev.wins, () => 0.5);
      // The refilled cells are random, but the survivors must line up.
      const popped = new Set(prev.wins.map((w) => w.symbol));
      for (let c = 0; c < COLS; c++) {
        // X cells never survive a tumble — they've already had their value
        // collected into this step's xValue, same as a popped winning symbol.
        const survivors = prev.board[c].filter((cell) => typeof cell === "string" && !popped.has(cell));
        const actual = round.steps[i].board[c].slice(ROWS - survivors.length);
        expect(actual).toEqual(survivors);
        expect(expected[c]).toHaveLength(ROWS);
      }
    }
  });

  it("the final board never qualifies for a win", () => {
    for (let i = 0; i < 200; i++) {
      const round = playRound(Math.random);
      expect(evaluateBoard(round.finalBoard)).toEqual([]);
    }
  });

  it("payout is bet * basePay * multiplier", () => {
    const round = playRound(queue([0.01]));
    expect(payoutFor(round, 20)).toBeCloseTo(20 * round.basePay * round.multiplier, 6);
  });

  // A winning tumble's refill can drop a fresh X that the cascade then never
  // gets a further win to sweep up. Built by hand: the opening board wins
  // exactly 15 dots (nothing else near its threshold), whose refill lands one
  // X (value 2) plus 13 harmless non-winning symbols, so the round stops
  // right there with that X still sitting on finalBoard.
  it("sweeps an X dropped by the winning tumble's own refill into the multiplier, even with no further win", () => {
    const initial = [
      0.0, 0.0, 0.0, 0.0, 0.0, // col0: dot x5
      0.0, 0.0, 0.0, 0.0, 0.0, // col1: dot x5
      0.0, 0.0, 0.0, 0.0, 0.0, // col2: dot x5
      0.4, 0.4, 0.4, 0.6, 0.6, // col3: square x3, diamond x2
      0.6, 0.8, 0.8, 0.8, 0.9, // col4: diamond, star x3, seven
      0.9, 0.9, 0.9, 0.9, 0.9, // col5: seven x5
    ];
    const refill = [
      0.99, 0.0, // col0 row0: X, value tier -> 2
      0.4, 0.4, 0.4, 0.4, // col0 rows1-4: square x4
      0.4, // col1 row0: square
      0.6, 0.6, 0.6, 0.6, // col1 rows1-4: diamond x4
      0.6, // col2 row0: diamond
      0.8, 0.8, 0.8, 0.8, // col2 rows1-4: star x4
    ];
    const round = playRound(queue([...initial, ...refill]));

    expect(round.steps).toHaveLength(1);
    expect(round.steps[0].xValue).toBe(0); // no X on the opening board
    expect(evaluateBoard(round.finalBoard)).toEqual([]); // the cascade really did stop here
    expect(xValueOnBoard(round.finalBoard)).toBe(2); // the X the refill dropped
    expect(round.multiplier).toBe(2); // counted anyway
    expect(round.totalMultiplier).toBeCloseTo(round.basePay * 2, 10);
  });
});

describe("pickSymbol", () => {
  // Weights are the five symbols scaled by (1 - X_WEIGHT), so their
  // cumulative ranges end at 0.3395 / 0.582 / 0.776 / 0.8924 / 0.97 rather
  // than 1 — pickSymbol has no "x" branch, so anything at or past 0.97 (where
  // pickCellId would roll X) falls through to the pickWeighted fallback,
  // which is the last entry, "seven".
  it("maps the weighted cumulative ranges to the right symbol", () => {
    expect(pickSymbol(queue([0.0]))).toBe("dot");
    expect(pickSymbol(queue([0.33]))).toBe("dot");
    expect(pickSymbol(queue([0.35]))).toBe("square");
    expect(pickSymbol(queue([0.6]))).toBe("diamond");
    expect(pickSymbol(queue([0.8]))).toBe("star");
    expect(pickSymbol(queue([0.9]))).toBe("seven");
    expect(pickSymbol(queue([0.98]))).toBe("seven");
    expect(pickSymbol(queue([1.0]))).toBe("seven");
  });
});

describe("pickCell / xValueOnBoard", () => {
  it("rolls a plain symbol id below the X_WEIGHT threshold", () => {
    expect(pickCell(queue([0.5]))).toBe("square");
  });

  it("rolls a tagged X cell, with a second draw for its value, above the threshold", () => {
    // 0.98 sits inside X's cumulative slice (the five symbols end at ~0.97),
    // so the first draw lands on "x"; 0.0 on the second draw picks the
    // lowest X_VALUES tier.
    const cell = pickCell(queue([0.98, 0.0]));
    expect(cell).toEqual({ id: "x", value: 2 });
  });

  it("sums every X cell's value and ignores plain symbols", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    board[0][0] = { id: "x", value: 10 };
    board[0][1] = { id: "x", value: 2 };
    expect(xValueOnBoard(board)).toBe(12);
  });

  it("is 0 on a board with no X cells", () => {
    const board = boardOf(repeat({ dot: 15, square: 11, diamond: 4 }));
    expect(xValueOnBoard(board)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BASELINE_RTP calibration. Unlike the old orb feature (an independent extra
// draw), X occupies real board cells and is coupled to the cascade, which
// breaks the exact 324,632-state Markov-chain solve the design doc describes
// for the pre-X game — extending it to a 6th live category blows the state
// space up ~6x and is no longer cheap enough to run as a test. So
// BASELINE_RTP is calibrated empirically (see its comment in engine.ts for
// the calibration run) and this test re-checks that calibration on a smaller
// in-test sample with a wide statistical tolerance, rather than asserting
// exact equality — a real, deliberate drop in rigor from the pre-X proof.
// ---------------------------------------------------------------------------
describe("BASELINE_RTP", () => {
  it("is within a wide tolerance of a fresh large-sample simulation", { timeout: 60_000 }, () => {
    const N = 1_000_000;
    let sum = 0;
    let hits = 0;
    let tumbleSum = 0;
    for (let i = 0; i < N; i++) {
      const round = playRound(Math.random);
      sum += round.totalMultiplier;
      if (round.steps.length > 0) {
        hits++;
        tumbleSum += round.steps.length;
      }
    }
    const mean = sum / N;
    // The calibration run's 95% CI was BASELINE_RTP +/- ~0.5%; this in-test
    // sample is 20x smaller, so the tolerance is widened well past that to
    // stay non-flaky while still catching a real regression (e.g. a
    // threshold, pay, or X weight/value edit that was never recalibrated).
    expect(mean).toBeGreaterThan(BASELINE_RTP * 0.9);
    expect(mean).toBeLessThan(BASELINE_RTP * 1.1);

    // Sanity on the shape the design targets, so a re-tune that wrecks the
    // feel fails here too rather than silently shipping.
    const hitRate = hits / N;
    expect(hitRate).toBeGreaterThan(0.09);
    expect(hitRate).toBeLessThan(0.16);
    expect(tumbleSum / hits).toBeGreaterThan(1.2); // tumbles per winning round
  });
});

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
