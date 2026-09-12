import { supabase } from "../lib/supabase";
import type { ChipRequest } from "../types";

export function useChipRequests() {
  async function requestChips(casinoId: string, amount: number): Promise<ChipRequest> {
    const { data, error } = await supabase.rpc("request_chips", {
      p_casino_id: casinoId,
      p_amount: amount,
    });
    if (error) {
      if (error.code === "23505") {
        throw new Error("You already have a pending request");
      }
      throw error;
    }
    return {
      id: data.id,
      user_id: data.user_id,
      username: null,
      amount: data.amount,
      created_at: data.created_at,
    };
  }

  async function cancelChipRequest(requestId: string): Promise<void> {
    const { error } = await supabase.rpc("cancel_chip_request", { p_request_id: requestId });
    if (error) throw error;
  }

  async function acceptChipRequest(requestId: string): Promise<void> {
    const { error } = await supabase.rpc("accept_chip_request", { p_request_id: requestId });
    if (error) throw error;
  }

  async function denyChipRequest(requestId: string): Promise<void> {
    const { error } = await supabase.rpc("deny_chip_request", { p_request_id: requestId });
    if (error) throw error;
  }

  async function listChipRequests(casinoId: string): Promise<ChipRequest[]> {
    const { data, error } = await supabase.rpc("list_chip_requests", { p_casino_id: casinoId });
    if (error) throw error;
    return (data ?? []) as ChipRequest[];
  }

  return { requestChips, cancelChipRequest, acceptChipRequest, denyChipRequest, listChipRequests };
}
