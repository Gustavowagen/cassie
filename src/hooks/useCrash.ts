import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { CrashState } from "../types";

export function useCrash(casinoId: string | undefined, gameId: string | undefined) {
  const [state, setState] = useState<CrashState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("crash", { body });
    setLoading(false);
    if (error) {
      // supabase-js returns non-2xx as FunctionsHttpError; the JSON { error }
      // body lives on error.context (a Response), not on `data`. When the
      // request never reached the function (network failure) there's no
      // context to parse, so fall back to a message a player can act on
      // instead of the raw SDK error text.
      let message = body.action === "start" ? "Failed to place bet, please try again" : "Failed to cash out, please try again";
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
    setState(data as CrashState);
    return data as CrashState;
  }, []);

  const start = useCallback(
    (bet: number) => invoke({ action: "start", casino_id: casinoId, casino_game_id: gameId, bet }),
    [invoke, casinoId, gameId]
  );

  const cashOut = useCallback(() => {
    if (!state) throw new Error("No active round");
    return invoke({ action: "cashout", round_id: state.roundId });
  }, [invoke, state]);

  const reset = useCallback(() => setState(null), []);

  return { state, loading, error, start, cashOut, reset };
}
