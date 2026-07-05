import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { DiceResult, DiceDirection } from "../types";

export function useDice(casinoId: string | undefined) {
  const [result, setResult] = useState<DiceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roll = useCallback(
    async (bet: number, target: number, direction: DiceDirection) => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("dice", {
        body: { casino_id: casinoId, bet, target, direction },
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
      setResult(data as DiceResult);
      return data as DiceResult;
    },
    [casinoId]
  );

  return { result, loading, error, roll };
}
