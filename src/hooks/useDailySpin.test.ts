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
