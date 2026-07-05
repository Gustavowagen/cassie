export type BetMap = Record<string, number>;

export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// n0..n36 straight bets, n37 = "00", plus the standard outside bets.
const VALID_KEYS = new Set<string>([
  ...Array.from({ length: 37 }, (_, n) => `n${n}`),
  "n37",
  "red", "black", "even", "odd", "low", "high",
  "d1", "d2", "d3", "c1", "c2", "c3",
]);

export function numColor(n: number): "red" | "black" | "green" {
  if (n === 0 || n === 37) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

export function numLabel(n: number): string {
  return n === 37 ? "00" : String(n);
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

// Throws on any unknown key or non-positive amount — bets come straight from
// the client and must never be trusted. Amounts may be fractional (the "low"
// stake tier bets as little as 0.1) but are rounded to cents.
export function validateBets(input: unknown): BetMap {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid bets");
  }
  const out: BetMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!VALID_KEYS.has(key)) throw new Error(`Unknown bet: ${key}`);
    if (typeof value !== "number" || !isFinite(value) || value <= 0) {
      throw new Error(`Invalid bet amount for ${key}`);
    }
    out[key] = roundMoney(value);
  }
  return out;
}

export function totalBet(bets: BetMap): number {
  return Object.values(bets).reduce((s, v) => s + v, 0);
}

export function calcPayout(result: number, bets: BetMap): number {
  const color = numColor(result);
  const isZero = result === 0 || result === 37;
  let total = 0;
  for (const [key, amount] of Object.entries(bets)) {
    if (!amount) continue;
    let mult = 0;
    if (key === `n${result}`) {
      mult = 36;
    } else if (!isZero) {
      if (key === "red" && color === "red") mult = 2;
      else if (key === "black" && color === "black") mult = 2;
      else if (key === "even" && result % 2 === 0) mult = 2;
      else if (key === "odd" && result % 2 !== 0) mult = 2;
      else if (key === "low" && result <= 18) mult = 2;
      else if (key === "high" && result >= 19) mult = 2;
      else if (key === "d1" && result <= 12) mult = 3;
      else if (key === "d2" && result >= 13 && result <= 24) mult = 3;
      else if (key === "d3" && result >= 25) mult = 3;
      else if (key === "c1" && result % 3 === 0) mult = 3;
      else if (key === "c2" && result % 3 === 2) mult = 3;
      else if (key === "c3" && result % 3 === 1) mult = 3;
    }
    total += amount * mult;
  }
  return total;
}
