import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const GLASS = "bg-white/5 backdrop-blur-xl border border-white/10";
const CARD_GLOW = "shadow-[0_8px_32px_rgba(124,58,237,0.15)]";

interface GameSettingsModalProps {
  title: string;
  imageUrl: string | undefined;
  initialName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

export function GameSettingsModal({ title, imageUrl, initialName, onSave, onClose }: GameSettingsModalProps) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  async function handleSave() {
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save game");
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-2xl ${GLASS} ${CARD_GLOW} overflow-hidden`}>
      <div className="flex items-start justify-between p-5 border-b border-white/10">
        <p className="font-semibold text-base">{title}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

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

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !trimmed}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
