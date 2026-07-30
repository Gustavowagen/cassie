import { supabase } from "../lib/supabase";
import type { GameType, CasinoGame } from "../types";

export function useGames() {
  async function listGameTypes(): Promise<GameType[]> {
    const { data, error } = await supabase.from("game_types").select("*").order("name");
    if (error) throw error;
    return (data ?? []) as GameType[];
  }

  async function listCasinoGames(casinoId: string): Promise<CasinoGame[]> {
    const { data, error } = await supabase
      .from("casino_games")
      .select("*")
      .eq("casino_id", casinoId)
      .order("custom_name");
    if (error) throw error;
    return (data ?? []) as CasinoGame[];
  }

  async function createGame(casinoId: string, gameTypeId: string, customName: string): Promise<CasinoGame> {
    const { data, error } = await supabase
      .from("casino_games")
      .insert({ casino_id: casinoId, game_type_id: gameTypeId, custom_name: customName, is_active: true })
      .select()
      .single();
    if (error) throw error;
    return data as CasinoGame;
  }

  async function updateGame(id: string, customName: string): Promise<CasinoGame> {
    const { data, error } = await supabase
      .from("casino_games")
      .update({ custom_name: customName })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as CasinoGame;
  }

  async function deleteGame(id: string): Promise<void> {
    const { error } = await supabase.from("casino_games").delete().eq("id", id);
    if (error) throw error;
  }

  return { listGameTypes, listCasinoGames, createGame, updateGame, deleteGame };
}
