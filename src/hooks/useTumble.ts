import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { TumbleResult, TumbleFreeSpinsResult } from "../types";

// supabase-js returns non-2xx as FunctionsHttpError; the JSON { error } body
// lives on error.context (a Response), not on `data`. When the request never
// reached the function (network failure) there's no context to parse, so
// fall back to a message a player can act on instead of the raw SDK error
// text. Shared by spin and buyFreeSpins below, which both call the same
// edge function and hit the same failure shapes.
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

export function useTumble(casinoId: string | undefined, gameId: string | undefined) {
  const [result, setResult] = useState<TumbleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spin = useCallback(
    async (bet: number) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("tumble", {
        body: { casino_id: casinoId, casino_game_id: gameId, bet },
      });
      setLoading(false);
      if (error) {
        const message = await parseFunctionError(error);
        setError(message);
        throw new Error(message);
      }
      setResult(data as TumbleResult);
      return data as TumbleResult;
    },
    [casinoId, gameId]
  );

  // `cost` is the batch's total price; the server derives the per-spin stake
  // from it (see handleBuyFreeSpins in supabase/functions/tumble/index.ts).
  const buyFreeSpins = useCallback(
    async (cost: number) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("tumble", {
        body: { action: "buy_free_spins", casino_id: casinoId, casino_game_id: gameId, cost },
      });
      setLoading(false);
      if (error) {
        const message = await parseFunctionError(error);
        setError(message);
        throw new Error(message);
      }
      return data as TumbleFreeSpinsResult;
    },
    [casinoId, gameId]
  );

  return { result, loading, error, spin, buyFreeSpins };
}
