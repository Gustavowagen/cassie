import { supabase } from "../lib/supabase";
import type { Casino } from "../types";
import { slugify } from "../lib/utils";

export function useCasino() {
  async function createCasino(data: {
    name: string;
    description: string;
    startingBalance: number;
    allowPublicJoin: boolean;
  }): Promise<Casino> {
    const slug = slugify(data.name);
    const { data: casino, error } = await supabase
      .from("casinos")
      .insert({
        name: data.name,
        slug,
        description: data.description,
        settings: {
          startingBalance: data.startingBalance,
          allowPublicJoin: data.allowPublicJoin,
          maxMembers: 500,
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

  return { createCasino, joinCasino, listCasinos, getCasinoBySlug };
}
