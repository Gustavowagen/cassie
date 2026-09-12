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
