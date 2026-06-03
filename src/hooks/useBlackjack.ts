import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { BlackjackState, Move } from "../types";

export function useBlackjack(casinoId: string | undefined) {
  const [state, setState] = useState<BlackjackState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("blackjack", { body });
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
    setState(data as BlackjackState);
    return data as BlackjackState;
  }, []);

  const start = useCallback(
    (bet: number) => invoke({ action: "start", casino_id: casinoId, bet }),
    [invoke, casinoId]
  );

  const act = useCallback(
    (move: Move) => {
      if (!state) throw new Error("No active round");
      return invoke({ action: "action", round_id: state.roundId, move });
    },
    [invoke, state]
  );

  const reset = useCallback(() => setState(null), []);

  return { state, loading, error, start, act, reset };
}
