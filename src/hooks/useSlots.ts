import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { SlotsResult } from "../types";

export function useSlots(casinoId: string | undefined, gameId: string | undefined) {
  const [result, setResult] = useState<SlotsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spin = useCallback(
    async (bet: number) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("slots", {
        body: { casino_id: casinoId, casino_game_id: gameId, bet },
      });
      setLoading(false);
      if (error) {
        // supabase-js returns non-2xx as FunctionsHttpError; the JSON { error }
        // body lives on error.context (a Response), not on `data`.
        let message = error.message;
        const ctx = (error as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            if (parsed?.error) message = parsed.error as string;
          } catch {
            /* keep the default message */
          }
        }
        setError(message);
        throw new Error(message);
      }
      setResult(data as SlotsResult);
      return data as SlotsResult;
    },
    [casinoId, gameId]
  );

  return { result, loading, error, spin };
}
