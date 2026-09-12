import type { CSSProperties } from "react";

// Games-tab lobby helpers: category grouping, search filtering, and the
// casino-colour accent the lobby paints its highlights with.

export type LobbyCategoryId = "slots" | "instant";
export type LobbyFilter = "all" | LobbyCategoryId;

export const LOBBY_CATEGORIES: { id: LobbyCategoryId; label: string; shortLabel: string }[] = [
  { id: "slots", label: "Slots", shortLabel: "Slots" },
  { id: "instant", label: "Instant", shortLabel: "Instant" },
];

// game_type_id → lobby category. A type missing here only shows under "all".
// "instant" holds the quick, one-screen games; "slots" holds the big reel
// games with their own art and feature rounds (Gates of Olympus onward).
export const GAME_CATEGORY: Record<string, LobbyCategoryId> = {
  olympus: "slots",
  slots: "instant",
  tumble: "instant",
  blackjack: "instant",
  roulette: "instant",
  dice: "instant",
  mines: "instant",
  plinko: "instant",
  crash: "instant",
};

/**
 * Whether a game type is a "big game" — one with its own art, scene and
 * feature rounds, which opens on a fullscreen route of its own rather than in
 * the dashboard's modal the way the quick games do.
 *
 * Derived from the category map above rather than kept as a second list, so
 * filing a future game under "slots" routes it fullscreen without anyone
 * having to remember there was a second place to say so.
 */
export function isBigGame(gameTypeId: string): boolean {
  return GAME_CATEGORY[gameTypeId] === "slots";
}

export function categoryLabel(gameTypeId: string): string | null {
  const id = GAME_CATEGORY[gameTypeId];
  return LOBBY_CATEGORIES.find((c) => c.id === id)?.label ?? null;
}

export function filterLobbyGames<T extends { game_type_id: string; custom_name: string }>(
  games: T[],
  filter: LobbyFilter,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return games.filter(
    (g) =>
      (filter === "all" || GAME_CATEGORY[g.game_type_id] === filter) &&
      (!q || g.custom_name.toLowerCase().includes(q)),
  );
}

export function countByCategory(games: { game_type_id: string }[]): Record<LobbyFilter, number> {
  const counts: Record<LobbyFilter, number> = { all: games.length, slots: 0, instant: 0 };
  for (const g of games) {
    const category = GAME_CATEGORY[g.game_type_id];
    if (category) counts[category] += 1;
  }
  return counts;
}

type RGB = [number, number, number];

// The dark theme's --primary (#6d28d9) — used when a casino colour won't parse.
const DEFAULT_ACCENT: RGB = [109, 40, 217];

// CSS vars for the lobby accent, as space-separated RGB so Tailwind classes
// can apply alpha (`rgb(var(--lobby-accent)/0.18)`). Lightness is clamped so a
// near-white or near-black casino colour still reads as an accent behind
// white text on the dark lobby.
export function lobbyAccentVars(hex: string | null | undefined): CSSProperties {
  const [r, g, b] = clampLightness(parseHex(hex) ?? DEFAULT_ACCENT, 0.38, 0.6);
  const lift = (c: number) => Math.round(c + (255 - c) * 0.62);
  return {
    "--lobby-accent": `${r} ${g} ${b}`,
    "--lobby-accent-light": `${lift(r)} ${lift(g)} ${lift(b)}`,
  } as CSSProperties;
}

function parseHex(hex: string | null | undefined): RGB | null {
  let h = (hex ?? "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function clampLightness([r, g, b]: RGB, min: number, max: number): RGB {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const hi = Math.max(rn, gn, bn);
  const lo = Math.min(rn, gn, bn);
  const l = (hi + lo) / 2;
  if (l >= min && l <= max) return [r, g, b];

  const d = hi - lo;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (hi === rn) h = ((gn - bn) / d) % 6;
    else if (hi === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const nl = Math.min(Math.max(l, min), max);
  const c = (1 - Math.abs(2 * nl - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = nl - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

// ---- Sample content ------------------------------------------------------
// The recent-wins feed and the online-now list have no backend yet: RLS only
// lets a member read their own transactions and membership row, so showing
// other players needs a new RPC. Until that exists the lobby renders this
// fixed sample so the layout can be reviewed.

export interface SampleWin {
  user: string;
  amount: number;
  gameTypeId: string;
  gameName: string;
}

export const SAMPLE_RECENT_WINS: SampleWin[] = [
  { user: "maja", amount: 12450, gameTypeId: "crash", gameName: "Crash" },
  { user: "jonas", amount: 8200, gameTypeId: "tumble", gameName: "Tumble" },
  { user: "sofie", amount: 5000, gameTypeId: "blackjack", gameName: "Blackjack" },
  { user: "emil", amount: 3750, gameTypeId: "slots", gameName: "Lucky Sevens" },
  { user: "nora", amount: 2940, gameTypeId: "mines", gameName: "Mines" },
  { user: "oskar", amount: 1800, gameTypeId: "roulette", gameName: "Roulette" },
  { user: "liv", amount: 960, gameTypeId: "plinko", gameName: "Plinko" },
];

export const SAMPLE_ONLINE: { user: string; activity: string }[] = [
  { user: "maja", activity: "Playing Crash" },
  { user: "jonas", activity: "Playing Tumble" },
  { user: "sofie", activity: "Playing Blackjack" },
  { user: "emil", activity: "In the lobby" },
];

export const SAMPLE_ONLINE_TOTAL = 14;
