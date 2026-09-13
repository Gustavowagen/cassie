import { useCallback, useEffect, useState } from "react";
import { DateRangePicker } from "./ui/datepicker";
import { Button } from "./ui/button";
import { ChipLedgerTable } from "./ChipLedgerTable";
import { useCasino } from "../hooks/useCasino";
import { useChipRequests } from "../hooks/useChipRequests";
import { formatChips } from "../lib/utils";
import type { ChipRequest, ChipTransaction } from "../types";

type LedgerPeriod = "today" | "7d" | "30d" | "custom";

const PERIODS: { id: LedgerPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "custom", label: "Custom" },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function ChipLedgerPanel({
  casinoId,
  showUserColumn,
  canManage,
}: {
  casinoId: string;
  showUserColumn: boolean;
  canManage: boolean;
}) {
  const { listChipTransactions } = useCasino();
  const { listChipRequests, acceptChipRequest, denyChipRequest, cancelChipRequest } = useChipRequests();
  const [period, setPeriod] = useState<LedgerPeriod>("today");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());
  const [rows, setRows] = useState<ChipTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<ChipRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const refreshLedger = useCallback(() => {
    const earliestAllowed = new Date(Date.now() - 30 * 86_400_000);
    let from: Date;
    let to = new Date();
    if (period === "today") from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    else if (period === "7d") from = new Date(Date.now() - 7 * 86_400_000);
    else if (period === "30d") from = earliestAllowed;
    else {
      from = customFrom ? new Date(customFrom) : earliestAllowed;
      if (from < earliestAllowed) from = earliestAllowed;
      to = customTo ? new Date(customTo + "T23:59:59") : new Date();
    }

    setLoading(true);
    setError(null);
    return listChipTransactions(casinoId, from, to)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
    // listChipTransactions deliberately omitted: useCasino() returns a fresh function
    // reference every render, so including it here would recompute refreshLedger every
    // render, retrigger the effect below, and loop.
  }, [casinoId, period, customFrom, customTo]);

  useEffect(() => {
    refreshLedger();
  }, [refreshLedger]);

  const refreshPending = useCallback(() => {
    setPendingLoading(true);
    return listChipRequests(casinoId)
      .then(setPending)
      .catch(() => setPending([]))
      .finally(() => setPendingLoading(false));
    // listChipRequests omitted for the same reason as listChipTransactions above.
  }, [casinoId]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  async function handleAccept(id: string) {
    setResolvingId(id);
    setPendingError(null);
    try {
      await acceptChipRequest(id);
      await Promise.all([refreshPending(), refreshLedger()]);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Failed to accept request");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleDeny(id: string) {
    setResolvingId(id);
    setPendingError(null);
    try {
      await denyChipRequest(id);
      await refreshPending();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Failed to deny request");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleCancel(id: string) {
    setResolvingId(id);
    setPendingError(null);
    try {
      await cancelChipRequest(id);
      await refreshPending();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Failed to cancel request");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {!pendingLoading && pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Pending requests</h3>
          <div className="space-y-2">
            {pending.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  {showUserColumn && <p className="text-sm font-medium truncate">{r.username ?? "Unknown"}</p>}
                  <p className="font-mono text-sm">{formatChips(r.amount)} chips</p>
                  <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canManage ? (
                    <>
                      <Button size="sm" variant="outline" disabled={resolvingId === r.id} onClick={() => handleDeny(r.id)}>
                        Deny
                      </Button>
                      <Button size="sm" disabled={resolvingId === r.id} onClick={() => handleAccept(r.id)}>
                        Accept
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" disabled={resolvingId === r.id} onClick={() => handleCancel(r.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {pendingError && <p className="text-xs text-destructive">{pendingError}</p>}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                period === id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <DateRangePicker
            from={customFrom}
            to={customTo}
            onFromChange={setCustomFrom}
            onToChange={setCustomTo}
            maxTo={todayStr()}
            minFrom={daysAgoStr(30)}
            maxRangeDays={30}
          />
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <ChipLedgerTable rows={rows} showUserColumn={showUserColumn} loading={loading} />
      </div>
    </div>
  );
}
