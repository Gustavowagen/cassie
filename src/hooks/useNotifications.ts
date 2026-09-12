import { supabase } from "../lib/supabase";
import type { AppNotification } from "../types";

export function useNotifications() {
  async function listNotifications(casinoId: string): Promise<AppNotification[]> {
    const { data, error } = await supabase.rpc("list_notifications", { p_casino_id: casinoId });
    if (error) throw error;
    return (data ?? []) as AppNotification[];
  }

  async function markNotificationsRead(casinoId: string): Promise<void> {
    const { error } = await supabase.rpc("mark_notifications_read", { p_casino_id: casinoId });
    if (error) throw error;
  }

  return { listNotifications, markNotificationsRead };
}
