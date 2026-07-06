import type { ChipTransaction } from "../types";
import { formatChips } from "../lib/utils";

export function ChipLedgerTable({
  rows,
  showUserColumn,
  loading,
}: {
  rows: ChipTransaction[];
  showUserColumn: boolean;
  loading: boolean;
}) {
  if (loading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  if (rows.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        No chip grants or removals in this period.
      </p>
    );

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {showUserColumn && (
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Player</th>
            )}
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">By</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const given = r.amount >= 0;
            return (
              <tr key={r.id} className="border-b border-border last:border-0">
                {showUserColumn && (
                  <td className="px-4 py-3 font-medium">{r.username ?? "Unknown"}</td>
                )}
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                      given
                        ? "bg-green-500/15 text-green-600 dark:text-green-400"
                        : "bg-red-500/15 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {given ? "Given" : "Claimed"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatChips(Math.abs(r.amount))}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                  {r.admin_username ?? "—"}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
