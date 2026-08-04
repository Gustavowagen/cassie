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

  it("busts on an exact tie between the current multiplier and the crash point", () => {
    const t = 2; // arbitrary fixed elapsed seconds
    const crashPoint = multiplierAt(t);
    const round = makeRound(crashPoint);
    const now = started.getTime() + t * 1000;
    const next = resolveCashout(round, now);
    expect(next.outcome).toBe("busted");
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
