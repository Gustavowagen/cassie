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
      .eq("casino_id", casinoId);
    if (error) throw error;
    return (data ?? []) as CasinoGame[];
  }

  async function enableGame(casinoId: string, gameTypeId: string): Promise<void> {
    const { error } = await supabase
      .from("casino_games")
      .upsert({ casino_id: casinoId, game_type_id: gameTypeId, is_active: true });
    if (error) throw error;
  }

  async function disableGame(casinoId: string, gameTypeId: string): Promise<void> {
    const { error } = await supabase
      .from("casino_games")
      .delete()
      .eq("casino_id", casinoId)
      .eq("game_type_id", gameTypeId);
    if (error) throw error;
  }

  return { listGameTypes, listCasinoGames, enableGame, disableGame };
}
