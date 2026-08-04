import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { useCasino } from "../hooks/useCasino";

const COVER_PRESETS = [
  { id: "neon-roulette", url: "/casino-covers/neon-roulette.svg", label: "Neon Roulette" },
  { id: "champagne-toast", url: "/casino-covers/champagne-toast.svg", label: "Champagne Toast" },
  { id: "jackpot-slots", url: "/casino-covers/jackpot-slots.svg", label: "Jackpot Slots" },
  { id: "high-roller-dice", url: "/casino-covers/high-roller-dice.svg", label: "High Roller Dice" },
  { id: "vegas-skyline", url: "/casino-covers/vegas-skyline.svg", label: "Vegas Skyline" },
];

export function CreateCasino() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCover, setSelectedCover] = useState<string>(COVER_PRESETS[0].url);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { createCasino } = useCasino();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const casino = await createCasino({
        name,
        description,
        backgroundUrl: selectedCover,
      });
      navigate(`/casino/${casino.slug}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create casino");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Your Casino</h1>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="name">Casino Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={50}
                placeholder="My Awesome Casino"
              />
            </div>

            <div>
              <Label htmlFor="desc">Description</Label>
              <textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={300}
                placeholder="What's your casino about?"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none mt-1"
              />
            </div>

            <div>
              <Label>Cover Image</Label>
              <p className="text-xs text-muted-foreground mb-2 mt-0.5">
                Shown on the homepage, in search, and on your casino's page — pick one.
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {COVER_PRESETS.map((preset) => {
                  const selected = selectedCover === preset.url;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedCover(preset.url)}
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
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating..." : "Create Casino"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
