import { describe, it, expect } from "vitest";
import * as client from "./olympusEngine";
import * as server from "../../supabase/functions/olympus/engine.ts";

// The engine's own behaviour is covered where it lives, in
// supabase/functions/olympus/engine.test.ts — this file exists for one
// narrower job.
//
// src/lib/olympusEngine.ts re-exports the edge function's engine rather than
// mirroring it by hand (the pattern Tumble uses for its much smaller
// paytable copy). That is the whole reason the board and the paytable panel
// cannot describe odds the server does not actually run. If someone
// later "tidies" the re-export into a local copy, everything still compiles
// and every other test still passes — the two just quietly start to drift,
// which is exactly the failure this guards against.
describe("the client engine", () => {
  it("is the edge function's engine, not a copy of it", () => {
    // Identity, not deep equality: a duplicated module would pass a value
    // comparison on the day it was written and fail the game a month later.
    expect(client.playRound).toBe(server.playRound);
    expect(client.playFreeSpins).toBe(server.playFreeSpins);
    expect(client.findWins).toBe(server.findWins);
    expect(client.PAYTABLE).toBe(server.PAYTABLE);
    expect(client.SYMBOL_WEIGHTS).toBe(server.SYMBOL_WEIGHTS);
    expect(client.ORB_VALUE_WEIGHTS).toBe(server.ORB_VALUE_WEIGHTS);
  });

  it("re-exports everything the UI reads", () => {
    // Named so a rename on the server side fails here rather than at runtime
    // in a component that imported a now-undefined symbol.
    for (const name of [
      "COLS",
      "ROWS",
      "MIN_MATCH",
      "SYMBOLS",
      "PAYTABLE",
      "ORB_VALUES",
      "FREE_SPINS_COUNT",
      "BASELINE_RTP",
      "DEFAULT_HOUSE_EDGE",
      "HOUSE_EDGE_OPTIONS",
      "edgeScale",
      "freeSpinsCost",
      "freeSpinsCostMultiplier",
      "isOrb",
      "makeRng",
      "playRound",
      "playFreeSpins",
    ]) {
      expect(client).toHaveProperty(name);
    }
  });
});
