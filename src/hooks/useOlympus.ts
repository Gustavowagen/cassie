import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { OlympusResult, OlympusFreeSpinsResult } from "../types";

// supabase-js returns non-2xx as FunctionsHttpError; the JSON { error } body
// lives on error.context (a Response), not on `data`. When the request never
// reached the function (network failure) there's no context to parse, so fall
// back to a message a player can act on instead of the raw SDK error text.
// Same shape useTumble handles, for the same reasons.
async function parseFunctionError(error: unknown): Promise<string> {
  let message = "Failed to place bet, please try again";
  const ctx = (error as unknown as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const parsed = await ctx.json();
      if (parsed?.error) message = parsed.error as string;
    } catch {
      /* keep the fallback message */
    }
  }
  return message;
}

export function useOlympus(casinoId: string | undefined, gameId: string | undefined) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spin = useCallback(
    async (bet: number) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("olympus", {
        body: { casino_id: casinoId, casino_game_id: gameId, bet },
      });
      setLoading(false);
      if (error) {
        const message = await parseFunctionError(error);
        setError(message);
        throw new Error(message);
      }
      return data as OlympusResult;
    },
    [casinoId, gameId]
  );

  /**
   * `bet` is the PER-SPIN stake, not the price. The batch's price is derived
   * from it server-side (freeSpinsCost) and comes back on the response — the
   * client never names a price, because the price is what holds the feature
   * at the same house edge as a base spin.
   */
  const buyFreeSpins = useCallback(
    async (bet: number) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("olympus", {
        body: { action: "buy_free_spins", casino_id: casinoId, casino_game_id: gameId, bet },
      });
      setLoading(false);
      if (error) {
        const message = await parseFunctionError(error);
        setError(message);
        throw new Error(message);
      }
      return data as OlympusFreeSpinsResult;
    },
    [casinoId, gameId]
  );

  return { loading, error, spin, buyFreeSpins };
}
