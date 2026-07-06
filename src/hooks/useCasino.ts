import { supabase } from "../lib/supabase";
import type { Casino, CasinoMemberWithProfile, ChipTransaction } from "../types";
import { slugify } from "../lib/utils";

export function useCasino() {
  async function createCasino(data: {
    name: string;
    description: string;
    logoUrl?: string;
  }): Promise<Casino> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const slug = slugify(data.name);
    const { data: casino, error } = await supabase
      .from("casinos")
      .insert({
        name: data.name,
        slug,
        description: data.description,
        owner_id: user.id,
        settings: {
          startingBalance: 10000,
          allowPublicJoin: true,
          maxMembers: 500,
        },
        theme: {
          primaryColor: "#7c3aed",
          logoUrl: data.logoUrl ?? null,
          backgroundUrl: null,
        },
      })
      .select()
      .single();
    if (error) throw error;
    return casino as Casino;
  }

  async function joinCasino(casinoId: string) {
    const { data, error } = await supabase.rpc("join_casino", {
      p_casino_id: casinoId,
    });
    if (error) throw error;
    return data;
  }

  async function listCasinos(): Promise<Casino[]> {
    const { data, error } = await supabase
      .from("casinos")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Casino[];
  }

  async function getCasinoBySlug(slug: string): Promise<Casino | null> {
    const { data } = await supabase
      .from("casinos")
      .select("*")
      .eq("slug", slug)
      .single();
    return (data as Casino) ?? null;
  }

  async function listMyCasinos(userId: string): Promise<Casino[]> {
    const { data, error } = await supabase
      .from("casino_members")
      .select("casino:casinos(*)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false });
    if (error) throw error;
    return (data ?? [])
      .map((row: any) => row.casino)
      .filter((c): c is Casino => c !== null);
  }

  async function getCasinoMembers(
    casinoId: string
  ): Promise<CasinoMemberWithProfile[]> {
    const { data, error } = await supabase
      .from("casino_members")
      .select("*, profile:profiles(username, avatar_url)")
      .eq("casino_id", casinoId)
      .order("joined_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as CasinoMemberWithProfile[];
  }

  async function giveChips(casinoId: string, targetUserId: string, amount: number) {
    const { error } = await supabase.rpc("give_chips", {
      p_casino_id: casinoId,
      p_target_user_id: targetUserId,
      p_amount: amount,
    });
    if (error) throw error;
  }

  async function setMemberRole(casinoId: string, targetUserId: string, newRole: "member" | "admin") {
    const { error } = await supabase.rpc("set_member_role", {
      p_casino_id: casinoId,
      p_target_user_id: targetUserId,
      p_new_role: newRole,
    });
    if (error) throw error;
  }

  async function getMemberProfitLoss(
    casinoId: string,
    userId: string,
    from?: Date,
    to?: Date,
  ): Promise<number> {
    const { data, error } = await supabase.rpc("get_member_profit_loss", {
      p_casino_id: casinoId,
      p_user_id: userId,
      p_from: from?.toISOString() ?? null,
      p_to: to?.toISOString() ?? null,
    });
    if (error) throw error;
    return data as number;
  }

  async function listChipTransactions(
    casinoId: string,
    from: Date,
    to: Date,
  ): Promise<ChipTransaction[]> {
    const { data, error } = await supabase.rpc("list_chip_transactions", {
      p_casino_id: casinoId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) throw error;
    return (data ?? []) as ChipTransaction[];
  }

  return {
    createCasino,
    joinCasino,
    listCasinos,
    listMyCasinos,
    getCasinoBySlug,
    getCasinoMembers,
    giveChips,
    setMemberRole,
    getMemberProfitLoss,
    listChipTransactions,
  };
}
