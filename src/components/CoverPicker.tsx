import { Check } from "lucide-react";
import { COVER_PRESETS } from "../lib/casinoCovers";

interface Props {
  value: string;
  onChange: (url: string) => void;
}

// Cover-art picker shared by casino creation and the casino settings tab —
// keeps both pickers in sync with the same preset list and look.
export function CoverPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
      {COVER_PRESETS.map((preset) => {
        const selected = value === preset.url;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset.url)}
            title={preset.label}
            className={`relative rounded-xl overflow-hidden border-2 transition-all ${
              selected
                ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.3)]"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <img
              src={preset.url}
              alt={preset.label}
              className="w-full aspect-[4/5] object-cover"
            />
            {selected && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Check className="h-6 w-6 text-white drop-shadow" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
