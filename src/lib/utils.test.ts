import { describe, it, expect } from "vitest";
import { AVATAR_PRESETS, avatarPresetKeyFromUrl, avatarPresetUrl, findAvatarPreset } from "./utils";

describe("avatar presets", () => {
  it("has nine unique preset keys", () => {
    const keys = AVATAR_PRESETS.map((p) => p.key);
    expect(keys).toHaveLength(9);
    expect(new Set(keys).size).toBe(9);
  });

  it("round-trips a preset key through avatarPresetUrl and avatarPresetKeyFromUrl", () => {
    const url = avatarPresetUrl("dice");
    expect(url).toBe("preset:dice");
    expect(avatarPresetKeyFromUrl(url)).toBe("dice");
  });

  it("returns null for a non-preset avatar_url", () => {
    expect(avatarPresetKeyFromUrl(null)).toBeNull();
    expect(avatarPresetKeyFromUrl(undefined)).toBeNull();
    expect(avatarPresetKeyFromUrl("https://example.com/photo.png")).toBeNull();
  });

  it("finds a preset by key", () => {
    expect(findAvatarPreset("dice")?.emoji).toBe("🎲");
    expect(findAvatarPreset("nonexistent")).toBeUndefined();
  });
});
