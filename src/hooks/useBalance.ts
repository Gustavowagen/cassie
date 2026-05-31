import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import type { CasinoMember } from "../types";

export function useBalance(casinoId: string | undefined) {
  const { setMembership } = useCasinoStore();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!casinoId || !user) return;

    supabase
      .from("casino_members")
      .select("*")
      .eq("casino_id", casinoId)
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => setMembership((data as CasinoMember) ?? null));

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
        (payload) => setMembership(payload.new as CasinoMember)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [casinoId, user, setMembership]);
}
