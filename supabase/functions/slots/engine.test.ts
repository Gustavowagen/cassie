import { describe, it, expect } from "vitest";
import {
  SYMBOL_WEIGHTS,
  pickSymbol,
  spin,
  roundMoney,
  BOARD_DIMENSIONS,
  ALLOWED_REWARD_MODES,
  type Reel,
  type SymbolId,
  type BoardSize,
} from "./engine";

function queue(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("BOARD_DIMENSIONS", () => {
  it("has an entry for every BoardSize with the expected rows/cols", () => {
    expect(BOARD_DIMENSIONS["3x3"]).toEqual({ rows: 3, cols: 3 });
    expect(BOARD_DIMENSIONS["3x4"]).toEqual({ rows: 3, cols: 4 });
    expect(BOARD_DIMENSIONS["5x3"]).toEqual({ rows: 3, cols: 5 });
    expect(BOARD_DIMENSIONS["3x6"]).toEqual({ rows: 3, cols: 6 });
    expect(BOARD_DIMENSIONS["4x6"]).toEqual({ rows: 4, cols: 6 });
  });
});

describe("ALLOWED_REWARD_MODES", () => {
  it("locks 3x3 and 3x4 to single_row", () => {
    expect(ALLOWED_REWARD_MODES["3x3"]).toEqual(["single_row"]);
    expect(ALLOWED_REWARD_MODES["3x4"]).toEqual(["single_row"]);
  });

  it("locks 4x6 to full_board", () => {
    expect(ALLOWED_REWARD_MODES["4x6"]).toEqual(["full_board"]);
  });

  it("allows free choice on 5x3 and 3x6", () => {
    expect(ALLOWED_REWARD_MODES["5x3"]).toEqual(["single_row", "full_board"]);
    expect(ALLOWED_REWARD_MODES["3x6"]).toEqual(["single_row", "full_board"]);
  });
});

describe("spin", () => {
  it("draws cols reels of length rows for the default 5x3 board, from independent rng() calls", () => {
    const rng = queue([
      0, 0, 0, // reel0: dot, dot, dot
      0.35, 0.35, 0.35, // reel1: square, square, square
      0.6, 0.8, 0.92, // reel2: diamond, star, seven
      0, 0.35, 0.6, // reel3: dot, square, diamond
      0.92, 0.8, 0, // reel4: seven, star, dot
    ]);
    const reels = spin(rng, "5x3");
    expect(reels).toHaveLength(5);
    reels.forEach((reel) => expect(reel).toHaveLength(3));
    expect(reels[0]).toEqual(["dot", "dot", "dot"]);
    expect(reels[1]).toEqual(["square", "square", "square"]);
    expect(reels[2]).toEqual(["diamond", "star", "seven"]);
    expect(reels[3]).toEqual(["dot", "square", "diamond"]);
    expect(reels[4]).toEqual(["seven", "star", "dot"]);
  });

  it("draws rows*cols reels for a non-default board size (3x3 = 9 draws)", () => {
    const rng = queue([0, 0, 0, 0.35, 0.35, 0.35, 0.6, 0.8, 0.92]);
    const reels = spin(rng, "3x3");
    expect(reels).toHaveLength(3);
    reels.forEach((reel) => expect(reel).toHaveLength(3));
    expect(reels).toEqual([
      ["dot", "dot", "dot"],
      ["square", "square", "square"],
      ["diamond", "star", "seven"],
    ]);
  });

  it("draws a 4-row board (4x6) with reels of length 4", () => {
    const rng = queue(new Array(24).fill(0)); // all dot
    const reels = spin(rng, "4x6");
    expect(reels).toHaveLength(6);
    reels.forEach((reel) => expect(reel).toEqual(["dot", "dot", "dot", "dot"]));
  });
});
