import { X } from "lucide-react";
import { notificationMessage } from "../../lib/notifications";
import type { AppNotification } from "../../types";

const GLASS = "bg-background border border-white/10";

export function NotificationsModal({
  notifications,
  loading,
  onClose,
}: {
  notifications: AppNotification[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className={`rounded-2xl ${GLASS} overflow-hidden flex-1 min-h-0 flex flex-col`}>
      <div className="flex items-start justify-between p-5 border-b border-white/10 shrink-0">
        <p className="font-semibold text-base">Notifications</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-2 overflow-y-auto min-h-0">
        {loading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-2.5 px-3 py-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "" : "bg-emerald-400"}`} />
                <div>
                  <p className="text-sm">{notificationMessage(n)}</p>
                  <p className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
