import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { useCasino } from "../hooks/useCasino";

const LOGO_PRESETS = [
  { id: "crown", url: "/casino-presets/crown.svg", label: "Crown" },
  { id: "spade", url: "/casino-presets/spade.svg", label: "Spade" },
  { id: "seven", url: "/casino-presets/seven.svg", label: "Lucky 7" },
  { id: "dice", url: "/casino-presets/dice.svg", label: "Dice" },
  { id: "chip", url: "/casino-presets/chip.svg", label: "Chip" },
  { id: "star", url: "/casino-presets/star.svg", label: "Star" },
];

export function CreateCasino() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);
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
        logoUrl: selectedLogo ?? undefined,
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
              <Label>Casino Logo</Label>
              <p className="text-xs text-muted-foreground mb-2 mt-0.5">
                Pick an icon for your casino.
              </p>
              <div className="grid grid-cols-6 gap-2">
                {LOGO_PRESETS.map((preset) => {
                  const selected = selectedLogo === preset.url;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setSelectedLogo(selected ? null : preset.url)
                      }
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
                        className="w-full aspect-square object-cover"
                      />
                      {selected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <Check className="h-5 w-5 text-white drop-shadow" />
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
