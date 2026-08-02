import { useEffect, useState } from "react";
import { DateRangePicker } from "./ui/datepicker";
import { ChipLedgerTable } from "./ChipLedgerTable";
import { useCasino } from "../hooks/useCasino";
import type { ChipTransaction } from "../types";

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
}: {
  casinoId: string;
  showUserColumn: boolean;
}) {
  const { listChipTransactions } = useCasino();
  const [period, setPeriod] = useState<LedgerPeriod>("today");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());
  const [rows, setRows] = useState<ChipTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
    listChipTransactions(casinoId, from, to)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [casinoId, period, customFrom, customTo]);

  return (
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
  );
}
