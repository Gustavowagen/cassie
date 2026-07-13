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
