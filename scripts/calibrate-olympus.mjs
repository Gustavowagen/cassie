// Measures the two constants supabase/functions/olympus/engine.ts cannot
// derive in closed form: BASELINE_RTP (the raw pay table's long-run return in
// the base game) and FREE_SPINS_BASELINE_EV (one batch's expected return, in
// multiples of the per-spin stake).
//
// Both are measured against the real engine, not a stand-in, so they can
// never describe mechanics the game no longer has. Run it after ANY change to
// the symbol weights, the orb weight, the orb value table, MIN_MATCH, or the
// paytable — every one of those moves both figures:
//
//   node scripts/calibrate-olympus.mjs [baseRounds] [batches]
//
// then paste the printed constants back into engine.ts and re-run
// `npm test` (engine.test.ts asserts the engine actually converges on them).
// Node runs the .ts engine directly via its built-in type stripping.

import {
  playRound,
  playFreeSpins,
  FREE_SPINS_COUNT,
  BASELINE_RTP,
  FREE_SPINS_BASELINE_EV,
} from "../supabase/functions/olympus/engine.ts";

const baseRounds = Number(process.argv[2] ?? 10_000_000);
const batches = Number(process.argv[3] ?? 500_000);

// Math.random, not the seeded mulberry32: a calibration wants a good
// generator over a very long run, and nothing here needs reproducing.
const rng = Math.random;

function stats(n, draw) {
  let sum = 0;
  let sumSq = 0;
  let hits = 0;
  let max = 0;
  const started = Date.now();
  for (let i = 0; i < n; i++) {
    const v = draw();
    sum += v;
    sumSq += v * v;
    if (v > 0) hits++;
    if (v > max) max = v;
  }
  const mean = sum / n;
  return {
    mean,
    // Standard error of the mean; 2x it is the 95% interval.
    stderr: Math.sqrt(Math.max(0, sumSq / n - mean * mean) / n),
    hitRate: hits / n,
    max,
    seconds: (Date.now() - started) / 1000,
  };
}

console.log(`base game: ${baseRounds.toLocaleString()} rounds…`);
// houseEdge left undefined so the engine pays at scale 1 — which is exactly
// what "the raw table's RTP" means.
const base = stats(baseRounds, () => playRound(rng).totalWin);

console.log(
  `free spins: ${batches.toLocaleString()} batches ` +
    `(${(batches * FREE_SPINS_COUNT).toLocaleString()} spins)…`
);
const fs = stats(batches, () => playFreeSpins(rng).totalWin);

const costMultiplier = fs.mean / base.mean;

console.log(`
--- base game ------------------------------------------------
  BASELINE_RTP        ${base.mean}
  95% interval        ±${(base.stderr * 2).toFixed(6)}  (${((base.stderr * 2 * 100) / base.mean).toFixed(3)}% relative)
  hit rate            ${(base.hitRate * 100).toFixed(2)}% of spins pay
  largest round       ${base.max.toFixed(1)}x bet
  took                ${base.seconds.toFixed(1)}s

--- free spins -----------------------------------------------
  FREE_SPINS_BASELINE_EV  ${fs.mean}
  95% interval            ±${(fs.stderr * 2).toFixed(4)}  (${((fs.stderr * 2 * 100) / fs.mean).toFixed(3)}% relative)
  batches that paid       ${(fs.hitRate * 100).toFixed(2)}%
  largest batch           ${fs.max.toFixed(1)}x per-spin stake
  took                    ${fs.seconds.toFixed(1)}s

--- what this prices -----------------------------------------
  buy costs               ${costMultiplier.toFixed(4)}x the per-spin stake
  realized RTP at 3%      base ${((1 - 0.03)).toFixed(4)} / feature ${((fs.mean / base.mean / costMultiplier) * (1 - 0.03)).toFixed(4)}

--- paste into engine.ts -------------------------------------
export const BASELINE_RTP = ${base.mean};
export const FREE_SPINS_BASELINE_EV = ${fs.mean};

  (currently ${BASELINE_RTP} / ${FREE_SPINS_BASELINE_EV})
`);
