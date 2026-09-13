import { formatChips } from "./utils";
import type { AppNotification } from "../types";

export function notificationMessage(n: Pick<AppNotification, "type" | "payload">): string {
  const amount = formatChips(n.payload.amount);
  switch (n.type) {
    case "chip_request_created":
      return `${n.payload.requester_username ?? "A member"} requested ${amount} chips`;
    case "chip_request_accepted":
      return `Your request for ${amount} chips was accepted`;
    case "chip_request_denied":
      return `Your request for ${amount} chips was denied`;
  }
}
