import { describe, it, expect } from "vitest";
import { DEFAULT_DAILY_SPIN, resolveDailySpin, expectedValue } from "./dailySpin";

describe("dailySpin re-export", () => {
  it("exposes the edge function's engine to the client unchanged", () => {
    expect(DEFAULT_DAILY_SPIN.segments).toHaveLength(8);
    expect(resolveDailySpin(undefined).segments).toEqual(DEFAULT_DAILY_SPIN.segments);
    expect(expectedValue(DEFAULT_DAILY_SPIN)).toBeCloseTo(41200 / 98, 6);
  });
});
