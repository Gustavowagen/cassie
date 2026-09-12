import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import type { CasinoMember } from "../types";

/**
 * Keeps the store's membership row in sync with this casino, live.
 *
 * Returns `{ loading }`, which is true until the first read for the current
 * casino has come back. Without it a null membership is ambiguous — still
 * being fetched, or fetched and the user isn't a member — and a caller that
 * has to act on "not a member" (the fullscreen game route, which sends a
 * non-member back to the casino page to join) can't tell the two apart.
 */
export function useBalance(casinoId: string | undefined): { loading: boolean } {
  const { setMembership } = useCasinoStore();
  const { user } = useAuthStore();
  // Keyed by what was loaded rather than a bare boolean, so the gap between
  // the casino changing and the new read resolving reads as loading instead
  // of briefly reporting the previous casino's answer for the new one.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!casinoId || !user) return;

    let cancelled = false;
    supabase
      .from("casino_members")
      .select("*")
      .eq("casino_id", casinoId)
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        setMembership((data as CasinoMember) ?? null);
        setLoadedFor(casinoId);
      });

    const channel = supabase
      .channel(`balance-${casinoId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "casino_members",
          filter: `casino_id=eq.${casinoId}`,
        },
        (payload) => {
          if ((payload.new as CasinoMember).user_id === user.id) {
            setMembership(payload.new as CasinoMember);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [casinoId, user, setMembership]);

  return { loading: !casinoId || !user || loadedFor !== casinoId };
}
