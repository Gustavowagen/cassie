import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { PlinkoResult, PlinkoRisk } from "../types";

export function usePlinko(casinoId: string | undefined, gameId: string | undefined) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const drop = useCallback(
    async (bet: number, risk: PlinkoRisk) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("plinko", {
        body: { casino_id: casinoId, casino_game_id: gameId, bet, risk },
      });
      setLoading(false);
      if (error) {
        // supabase-js returns non-2xx as FunctionsHttpError; the JSON { error }
        // body lives on error.context (a Response), not on `data`. When the
        // request never reached the function (network failure) there's no
        // context to parse, so fall back to a message a player can act on
        // instead of the raw SDK error text.
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
        setError(message);
        throw new Error(message);
      }
      return data as PlinkoResult;
    },
    [casinoId, gameId]
  );

  return { loading, error, drop };
}
