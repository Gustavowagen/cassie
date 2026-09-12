import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { resolveDailySpin, nextSpinAt } from "../lib/dailySpin";
import type { Casino, DailySpinResult } from "../types";

/** "7h 12m" / "12m 04s" / "48s" — the promo card's countdown label. */
export function formatReadyIn(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/**
 * Client state for one casino's daily spin: the resolved config, whether a
 * spin is available, and a live countdown when it isn't.
 *
 * `lastSpinAt` comes from the membership row. The server is authoritative on
 * the cooldown — a 429 carries its own `nextSpinAt`, which we adopt, so a
 * client with a skewed clock still converges on the truth.
 */
export function useDailySpin(casino: Casino | null, lastSpinAt: string | null | undefined) {
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server-supplied override, set from a claim response or a 429. Takes
  // precedence over the membership row, which may be a render behind.
  const [serverNextAt, setServerNextAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const config = useMemo(
    () => resolveDailySpin(casino?.settings?.specialFeatures?.dailySpin),
    [casino?.settings]
  );

  // `lastSpinAt` is `undefined` for one or more renders while the membership
  // row is still being fetched (the optional chain in CasinoDashboard short-
  // circuits until then) and only becomes `null` once the row has actually
  // loaded and this member has never spun. Those are NOT interchangeable:
  // collapsing "unknown" into "never spun" (e.g. `lastSpinAt ?? null`) would
  // read as "no cooldown pending" and let a member who already spun today
  // briefly see an actionable "Spin now" that is guaranteed to 429. Keep the
  // unknown case distinct so `available` can stay false until we know.
  const membershipLoaded = lastSpinAt !== undefined;
  const effectiveLast = serverNextAt ? null : lastSpinAt ?? null;
  const unlockAt = useMemo(() => {
    if (serverNextAt) {
      const t = new Date(serverNextAt).getTime();
      return isFinite(t) && t > now ? new Date(t) : null;
    }
    return nextSpinAt(effectiveLast, config.cooldownHours);
  }, [serverNextAt, effectiveLast, config.cooldownHours, now]);

  // Only tick while a cooldown is actually pending — an idle lobby does no work.
  useEffect(() => {
    if (!unlockAt || !config.enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [unlockAt?.getTime() ?? null, config.enabled]);

  // Clear the server override when the membership row updates, so fresh
  // lastSpinAt values arriving from the DB are adopted once realtime sync lands.
  useEffect(() => {
    setServerNextAt(null);
  }, [lastSpinAt]);

  // Requires membershipLoaded too: while the row hasn't loaded, unlockAt is
  // null (nothing to count down to) but that must read as "unknown", not
  // "available" — see the comment on membershipLoaded above.
  const available = config.enabled && membershipLoaded && !unlockAt;
  const readyIn = config.enabled && unlockAt ? formatReadyIn(unlockAt.getTime() - now) : null;

  const spin = useCallback(async (): Promise<DailySpinResult> => {
    if (!casino) throw new Error("No casino");
    setSpinning(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke("daily-spin", {
      body: { casino_id: casino.id },
    });
    setSpinning(false);

    if (fnError) {
      // supabase-js returns non-2xx as FunctionsHttpError; the JSON { error }
      // body lives on error.context (a Response), not on `data`. Mirrors the
      // handling in src/hooks/useDice.ts.
      let message = "Couldn't spin, please try again";
      const ctx = (fnError as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const parsed = await ctx.json();
          if (parsed?.error) message = parsed.error as string;
          // Adopt the server's cooldown so a skewed client clock self-corrects.
          if (parsed?.nextSpinAt) setServerNextAt(parsed.nextSpinAt as string);
        } catch {
          /* keep the fallback message */
        }
      }
      setError(message);
      throw new Error(message);
    }

    const result = data as DailySpinResult;
    setServerNextAt(result.nextSpinAt);
    return result;
  }, [casino]);

  return { config, available, readyIn, spinning, error, spin };
}
