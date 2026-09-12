import { useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  DEFAULT_DAILY_SPIN,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  SEGMENT_PALETTE,
  expectedValue,
  nothingChance,
  resolveDailySpin,
  type DailySpinSegment,
  type DailySpinSettings,
} from "../../lib/dailySpin";
import type { Casino, CasinoSettings } from "../../types";
import { cn, formatChips } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { DailySpinWheel } from "../DailySpinWheel";

export function SpecialFeaturesPanel({
  casino,
  onSaved,
}: {
  casino: Casino;
  onSaved: (settings: CasinoSettings) => void;
}) {
  const [draft, setDraft] = useState<DailySpinSettings>(() =>
    resolveDailySpin(casino.settings?.specialFeatures?.dailySpin)
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The preview runs the draft through the same resolver the server uses, so
  // what the owner sees is what a player will actually get.
  const resolved = useMemo(() => resolveDailySpin(draft), [draft]);
  const totalWeight = draft.segments.reduce((s, x) => s + x.weight, 0) || 1;
  const ev = expectedValue(resolved);
  const blank = nothingChance(resolved);

  function patch(p: Partial<DailySpinSettings>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function patchSegment(index: number, p: Partial<DailySpinSegment>) {
    setDraft((d) => ({
      ...d,
      segments: d.segments.map((s, i) => (i === index ? { ...s, ...p } : s)),
    }));
  }

  function addSegment() {
    setDraft((d) => {
      if (d.segments.length >= MAX_SEGMENTS) return d;
      const i = d.segments.length;
      return {
        ...d,
        segments: [
          ...d.segments,
          {
            id: `seg-${Date.now()}-${i}`,
            label: "New prize",
            amount: 100,
            weight: 10,
            color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
          },
        ],
      };
    });
  }

  function removeSegment(index: number) {
    setDraft((d) =>
      d.segments.length <= MIN_SEGMENTS
        ? d
        : { ...d, segments: d.segments.filter((_, i) => i !== index) }
    );
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      // Store the resolved config, not the raw draft — an owner's partially
      // typed value never reaches the database.
      const settings: CasinoSettings = {
        ...casino.settings,
        specialFeatures: { ...casino.settings?.specialFeatures, dailySpin: resolved },
      };
      const { error } = await supabase.from("casinos").update({ settings }).eq("id", casino.id);
      if (error) throw error;
      onSaved(settings);
      setMessage("Saved!");
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Daily Spin</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A free wheel spin, once per cooldown. You decide every prize — including the blanks.
        </p>
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="h-4 w-4 accent-primary"
        />
        <span className="flex-1">
          <span className="block text-sm font-semibold">Enable Daily Spin</span>
          <span className="block text-xs text-muted-foreground">
            When off, the card is hidden from the lobby entirely.
          </span>
        </span>
      </label>

      <div className={cn("space-y-5", !draft.enabled && "opacity-60")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ds-title">Card title</Label>
            <Input
              id="ds-title"
              maxLength={32}
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-subtitle">Card subtitle</Label>
            <Input
              id="ds-subtitle"
              maxLength={60}
              value={draft.subtitle}
              onChange={(e) => patch({ subtitle: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-cooldown">Cooldown (hours)</Label>
            <Input
              id="ds-cooldown"
              type="number"
              min={1}
              max={168}
              value={draft.cooldownHours}
              onChange={(e) => patch({ cooldownHours: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">Prizes</h4>
              <p className="text-xs text-muted-foreground">
                {draft.segments.length}/{MAX_SEGMENTS} slices. Set a prize to 0 chips to make it a
                blank.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              disabled={draft.segments.length >= MAX_SEGMENTS}
              onClick={addSegment}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          <div className="space-y-2">
            {draft.segments.map((seg, i) => (
              <div
                key={seg.id}
                className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2.5"
              >
                <input
                  type="color"
                  aria-label={`Colour for ${seg.label}`}
                  value={seg.color}
                  onChange={(e) => patchSegment(i, { color: e.target.value })}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                />
                <div className="min-w-[7rem] flex-1 space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Label
                  </Label>
                  <Input
                    maxLength={24}
                    value={seg.label}
                    onChange={(e) => patchSegment(i, { label: e.target.value })}
                    className="h-9"
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Chips
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={seg.amount}
                    onChange={(e) => patchSegment(i, { amount: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
                <div className="w-20 space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Weight
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={seg.weight}
                    onChange={(e) => patchSegment(i, { weight: Number(e.target.value) })}
                    className="h-9"
                  />
                </div>
                <span className="w-14 pb-2 text-right text-xs tabular-nums text-muted-foreground">
                  {((seg.weight / totalWeight) * 100).toFixed(1)}%
                </span>
                <button
                  type="button"
                  onClick={() => removeSegment(i)}
                  disabled={draft.segments.length <= MIN_SEGMENTS}
                  aria-label={`Remove ${seg.label}`}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid items-center gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-[auto,1fr]">
          <div className="mx-auto w-[min(260px,60vw)]">
            <DailySpinWheel config={resolved} preview />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              Average {formatChips(Math.round(ev))} chips per spin
            </p>
            <p className="text-sm text-muted-foreground">
              {(blank * 100).toFixed(0)}% of spins land on nothing
            </p>
            <p className="pt-1 text-xs text-muted-foreground">
              For scale, new members start with{" "}
              {formatChips(casino.settings.startingBalance)} chips.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setDraft({ ...DEFAULT_DAILY_SPIN, enabled: draft.enabled })}
        >
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Reset to default wheel
        </Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
