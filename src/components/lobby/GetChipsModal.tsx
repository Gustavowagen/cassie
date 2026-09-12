import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { formatChips } from "../../lib/utils";
import { useChipRequests } from "../../hooks/useChipRequests";
import type { ChipRequest } from "../../types";

const GLASS = "bg-background border border-white/10";

export function GetChipsModal({
  casinoId,
  userId,
  onClose,
}: {
  casinoId: string;
  userId: string;
  onClose: () => void;
}) {
  const { requestChips, cancelChipRequest, listChipRequests } = useChipRequests();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ChipRequest | null>(null);
  const [amountText, setAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listChipRequests(casinoId)
      .then((rows) => {
        if (cancelled) return;
        setPending(rows.find((r) => r.user_id === userId) ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [casinoId, userId]);

  const amount = parseFloat(amountText);
  const amountValid = isFinite(amount) && amount > 0;

  async function handleSubmit() {
    if (!amountValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const request = await requestChips(casinoId, amount);
      setPending(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!pending || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelChipRequest(pending.id);
      setPending(null);
      setAmountText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`rounded-2xl ${GLASS} overflow-hidden flex-1 min-h-0 flex flex-col`}>
      <div className="flex items-start justify-between p-5 border-b border-white/10 shrink-0">
        <p className="font-semibold text-base">Get chips</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5 space-y-4 overflow-y-auto min-h-0">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : pending ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your request for{" "}
              <span className="font-semibold text-foreground">{formatChips(pending.amount)} chips</span> is waiting
              on an admin.
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button size="sm" variant="outline" onClick={handleCancel} disabled={submitting}>
              {submitting ? "Cancelling…" : "Cancel request"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="get-chips-amount">Amount</Label>
              <Input
                id="get-chips-amount"
                type="number"
                min={0.0001}
                step="any"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0"
                className="mt-1.5"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSubmit} disabled={submitting || !amountValid}>
                {submitting ? "Sending…" : "Send request"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
