import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { SLOTS_DESIGNS, DEFAULT_SLOTS_DESIGN_ID, getSlotsDesign } from "../lib/slotsDesigns";

const GLASS = "bg-background border border-white/10";
const CARD_GLOW = "shadow-[0_8px_32px_rgba(124,58,237,0.15)]";

const MIN_BET_FLOOR = 0.01;
const MAX_BET_CEILING = 10_000_000;

const REWARD_MODES = [
  {
    id: "single_row" as const,
    label: "Single row reward",
    description: "Win by matching symbols on the middle row.",
  },
  {
    id: "full_board" as const,
    label: "Full board reward",
    description: "Win by matching symbols anywhere across all 3 rows.",
  },
];

// Fixed menu — mirrors supabase/functions/slots/engine.ts's HOUSE_EDGE_OPTIONS.
// Admins pick one of these; there's no free-entry field.
const HOUSE_EDGE_OPTIONS = [0, 0.01, 0.02, 0.03, 0.04, 0.05] as const;
type HouseEdge = (typeof HOUSE_EDGE_OPTIONS)[number];

interface GameSettingsModalProps {
  title: string;
  imageUrl: string | undefined;
  gameTypeId: string;
  initialName: string;
  initialMinBet: number;
  initialMaxBet: number;
  initialSettings: Record<string, unknown>;
  onSave: (name: string, minBet: number, maxBet: number, settings: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export function GameSettingsModal({
  title,
  imageUrl,
  gameTypeId,
  initialName,
  initialMinBet,
  initialMaxBet,
  initialSettings,
  onSave,
  onClose,
}: GameSettingsModalProps) {
  const [name, setName] = useState(initialName);
  const [minBetText, setMinBetText] = useState(String(initialMinBet));
  const [maxBetText, setMaxBetText] = useState(String(initialMaxBet));
  const [rewardMode, setRewardMode] = useState<"single_row" | "full_board">(
    initialSettings.rewardMode === "full_board" ? "full_board" : "single_row"
  );
  const [houseEdge, setHouseEdge] = useState<HouseEdge>(
    HOUSE_EDGE_OPTIONS.includes(initialSettings.houseEdge as HouseEdge)
      ? (initialSettings.houseEdge as HouseEdge)
      : 0.02
  );
  const [design, setDesign] = useState<string>(
    typeof initialSettings.design === "string" ? initialSettings.design : DEFAULT_SLOTS_DESIGN_ID
  );
  const [view, setView] = useState<"settings" | "design">("settings");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const minBet = parseFloat(minBetText);
  const maxBet = parseFloat(maxBetText);
  const betRangeValid =
    isFinite(minBet) &&
    minBet >= MIN_BET_FLOOR &&
    isFinite(maxBet) &&
    maxBet <= MAX_BET_CEILING &&
    maxBet >= minBet;
  const isSlots = gameTypeId === "slots";
  const canSave = trimmed && betRangeValid;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const settings = isSlots ? { ...initialSettings, rewardMode, houseEdge, design } : initialSettings;
      await onSave(trimmed, minBet, maxBet, settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save game");
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-2xl ${GLASS} ${CARD_GLOW} overflow-hidden`}>
      <div className="flex items-start justify-between p-5 border-b border-white/10">
        {view === "design" ? (
          <button
            type="button"
            onClick={() => setView("settings")}
            className="flex items-center gap-1 font-semibold text-base text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Choose a design
          </button>
        ) : (
          <p className="font-semibold text-base">{title}</p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {view === "design" ? (
        <div className="p-5 space-y-2">
          {SLOTS_DESIGNS.map((d) => {
            const selected = d.id === design;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setDesign(d.id);
                  setView("settings");
                }}
                className={`w-full flex items-center gap-3 text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  selected ? "border-primary bg-primary/10" : "border-border hover:border-foreground/30"
                }`}
              >
                <div
                  className="h-12 w-12 shrink-0 rounded-md flex items-center justify-center gap-0.5"
                  style={{ background: d.preview.gradient, boxShadow: `inset 0 0 0 1px ${d.preview.accent}44` }}
                >
                  {d.preview.dotColors.slice(0, 3).map((c, i) => (
                    <span
                      key={i}
                      className="h-2 w-2 rounded-full"
                      style={{ background: c, boxShadow: `0 0 4px ${c}` }}
                    />
                  ))}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
      <div className="p-5 space-y-4">
        <div>
          <Label>Front image</Label>
          <div className="mt-1.5 rounded-xl border border-border overflow-hidden">
            {imageUrl && (
              <img src={imageUrl} alt="" className="h-32 w-full object-cover" />
            )}
            <button
              type="button"
              disabled
              className="w-full py-1.5 text-xs font-medium text-muted-foreground bg-black/20 cursor-not-allowed"
            >
              Change image — coming soon
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="game-settings-name">Name</Label>
          <Input
            id="game-settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Game name"
            className="mt-1.5"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="game-settings-min-bet">Min bet</Label>
            <Input
              id="game-settings-min-bet"
              type="number"
              min={MIN_BET_FLOOR}
              max={MAX_BET_CEILING}
              step="any"
              value={minBetText}
              onChange={(e) => setMinBetText(e.target.value)}
              className="mt-1.5"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div>
            <Label htmlFor="game-settings-max-bet">Max bet</Label>
            <Input
              id="game-settings-max-bet"
              type="number"
              min={MIN_BET_FLOOR}
              max={MAX_BET_CEILING}
              step="any"
              value={maxBetText}
              onChange={(e) => setMaxBetText(e.target.value)}
              className="mt-1.5"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          {!betRangeValid && (
            <p className="col-span-2 text-xs text-destructive">
              Min bet must be at least {MIN_BET_FLOOR}, max bet can't exceed {MAX_BET_CEILING.toLocaleString()}, and max bet must be at least the min bet.
            </p>
          )}
        </div>

        {isSlots && (
          <div>
            <Label>Design</Label>
            <button
              type="button"
              onClick={() => setView("design")}
              className="mt-1.5 w-full flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-foreground/30"
            >
              <div
                className="h-10 w-10 shrink-0 rounded-md flex items-center justify-center gap-0.5"
                style={{
                  background: getSlotsDesign(design).preview.gradient,
                  boxShadow: `inset 0 0 0 1px ${getSlotsDesign(design).preview.accent}44`,
                }}
              >
                {getSlotsDesign(design).preview.dotColors.slice(0, 3).map((c, i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: c, boxShadow: `0 0 4px ${c}` }}
                  />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{getSlotsDesign(design).name}</p>
                <p className="text-xs text-muted-foreground">Tap to change design</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </div>
        )}

        {isSlots && (
          <div>
            <Label>Reward Mode</Label>
            <div className="mt-1.5 grid grid-cols-1 gap-2">
              {REWARD_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setRewardMode(mode.id)}
                  className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                    rewardMode === mode.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  <p className="text-sm font-medium">{mode.label}</p>
                  <p className="text-xs text-muted-foreground">{mode.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {isSlots && (
          <div>
            <Label>House edge</Label>
            <div className="mt-1.5 grid grid-cols-6 gap-1.5">
              {HOUSE_EDGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setHouseEdge(option)}
                  className={`rounded-lg border py-1.5 text-sm font-medium transition-colors ${
                    houseEdge === option
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  {Math.round(option * 100)}%
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Only changes the payout multiplier for a win — never how often players win.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}
