export type Direction = "under" | "over";
export type Rng = () => number;

export const HOUSE_EDGE = 0.02;
export const MIN_WIN_CHANCE = 1;
export const MAX_WIN_CHANCE = 95;

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// A roll in [0, 100) with 2-decimal precision.
export function rollValue(rng: Rng): number {
  return Math.floor(rng() * 10000) / 100;
}

// Self-inverse: also used to convert a desired win chance back into a target.
export function winChanceFor(target: number, direction: Direction): number {
  return direction === "under" ? target : 100 - target;
}

export function multiplierFor(winChance: number): number {
  return (100 * (1 - HOUSE_EDGE)) / winChance;
}

export function isWin(roll: number, target: number, direction: Direction): boolean {
  return direction === "under" ? roll < target : roll > target;
}
