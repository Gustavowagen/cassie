import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatChips(amount: number): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Parse a #rrggbb or #rgb hex string into HSL components.
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) {
    // Fallback to the app's primary purple if input is malformed.
    return { h: 263, s: 70, l: 50 };
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      case b: hue = (r - g) / d + 4; break;
    }
    hue *= 60;
  }
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Returns a CSS linear-gradient value going from the input color (top)
// to a darker variant (bottom). Use as: style={{ background: gradientFromColor(hex) }}
export function gradientFromColor(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  const topL = Math.min(l, 55);
  const botL = Math.max(topL - 30, 8);
  return `linear-gradient(180deg, hsl(${h} ${s}% ${topL}%), hsl(${h} ${s}% ${botL}%))`;
}

export interface AvatarPreset {
  key: string;
  emoji: string;
  gradient: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: "dice", emoji: "🎲", gradient: "linear-gradient(135deg, hsl(263 70% 55%), hsl(303 70% 40%))" },
  { key: "spade", emoji: "♠️", gradient: "linear-gradient(135deg, hsl(220 70% 50%), hsl(260 70% 35%))" },
  { key: "diamond", emoji: "♦️", gradient: "linear-gradient(135deg, hsl(0 70% 55%), hsl(340 70% 40%))" },
  { key: "club", emoji: "♣️", gradient: "linear-gradient(135deg, hsl(150 65% 42%), hsl(190 65% 32%))" },
  { key: "heart", emoji: "♥️", gradient: "linear-gradient(135deg, hsl(340 75% 55%), hsl(0 75% 45%))" },
  { key: "slots", emoji: "🎰", gradient: "linear-gradient(135deg, hsl(40 80% 55%), hsl(15 80% 45%))" },
  { key: "joker", emoji: "🃏", gradient: "linear-gradient(135deg, hsl(280 65% 55%), hsl(320 65% 40%))" },
  { key: "roulette", emoji: "🎡", gradient: "linear-gradient(135deg, hsl(190 70% 50%), hsl(230 70% 40%))" },
  { key: "chip", emoji: "🪙", gradient: "linear-gradient(135deg, hsl(45 85% 55%), hsl(30 85% 40%))" },
];

const AVATAR_PRESET_PREFIX = "preset:";

export function avatarPresetUrl(key: string): string {
  return `${AVATAR_PRESET_PREFIX}${key}`;
}

export function avatarPresetKeyFromUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl || !avatarUrl.startsWith(AVATAR_PRESET_PREFIX)) return null;
  return avatarUrl.slice(AVATAR_PRESET_PREFIX.length);
}

export function findAvatarPreset(key: string): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((p) => p.key === key);
}
