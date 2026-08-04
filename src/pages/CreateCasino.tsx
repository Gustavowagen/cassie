import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { CoverPicker } from "../components/CoverPicker";
import { COVER_PRESETS } from "../lib/casinoCovers";
import { useCasino } from "../hooks/useCasino";

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
              <CoverPicker value={selectedCover} onChange={setSelectedCover} />
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
