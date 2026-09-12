import { describe, it, expect } from "vitest";
import { countByCategory, filterLobbyGames, isBigGame, lobbyAccentVars } from "./lobby";

const games = [
  { game_type_id: "olympus", custom_name: "Gates of Olympus" },
  { game_type_id: "slots", custom_name: "Lucky Sevens" },
  { game_type_id: "tumble", custom_name: "Tumble" },
  { game_type_id: "blackjack", custom_name: "High Roller Blackjack" },
  { game_type_id: "mines", custom_name: "Mines" },
  { game_type_id: "keno", custom_name: "Keno" },
];

const names = (list: { custom_name: string }[]) => list.map((g) => g.custom_name);

describe("filterLobbyGames", () => {
  it("returns every game for 'all' with an empty query", () => {
    expect(filterLobbyGames(games, "all", "")).toHaveLength(6);
  });

  it("keeps the big reel games under 'slots'", () => {
    expect(names(filterLobbyGames(games, "slots", ""))).toEqual(["Gates of Olympus"]);
  });

  it("keeps the quick games under 'instant'", () => {
    expect(names(filterLobbyGames(games, "instant", ""))).toEqual([
      "Lucky Sevens",
      "Tumble",
      "High Roller Blackjack",
      "Mines",
    ]);
  });

  it("matches the query case-insensitively, ignoring surrounding spaces", () => {
    expect(names(filterLobbyGames(games, "instant", "  blackJACK "))).toEqual(["High Roller Blackjack"]);
  });

  it("lists an unmapped game type under 'all' only", () => {
    expect(names(filterLobbyGames(games, "all", "keno"))).toEqual(["Keno"]);
    expect(filterLobbyGames(games, "instant", "keno")).toHaveLength(0);
  });
});

describe("isBigGame", () => {
  it("treats the big reel games as big", () => {
    expect(isBigGame("olympus")).toBe(true);
  });

  it("treats every quick game as not big", () => {
    for (const id of ["slots", "tumble", "blackjack", "roulette", "dice", "mines", "plinko", "crash"]) {
      expect(isBigGame(id)).toBe(false);
    }
  });

  it("treats an unmapped game type as not big", () => {
    expect(isBigGame("keno")).toBe(false);
  });
});

describe("countByCategory", () => {
  it("counts mapped types per category and totals everything", () => {
    expect(countByCategory(games)).toEqual({ all: 6, slots: 1, instant: 4 });
  });
});

describe("lobbyAccentVars", () => {
  it("keeps a mid-lightness colour as-is", () => {
    expect(lobbyAccentVars("#6d28d9")).toMatchObject({
      "--lobby-accent": "109 40 217",
      "--lobby-accent-light": "200 173 241",
    });
  });

  it("darkens white so it still reads as an accent", () => {
    expect(lobbyAccentVars("#ffffff")).toMatchObject({ "--lobby-accent": "153 153 153" });
  });

  it("falls back to the app violet for malformed input", () => {
    expect(lobbyAccentVars("not-a-colour")).toMatchObject({ "--lobby-accent": "109 40 217" });
    expect(lobbyAccentVars(null)).toMatchObject({ "--lobby-accent": "109 40 217" });
  });
});
