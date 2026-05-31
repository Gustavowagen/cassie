import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { useCasino } from "../hooks/useCasino";

export function CreateCasino() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startingBalance, setStartingBalance] = useState(10000);
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
        startingBalance,
        allowPublicJoin: true,
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
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <Input
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                placeholder="What's your casino about?"
              />
            </div>
            <div>
              <Label htmlFor="balance">Starting Chips per Player</Label>
              <Input
                id="balance"
                type="number"
                min={100}
                max={1000000}
                value={startingBalance}
                onChange={(e) => setStartingBalance(Number(e.target.value))}
                required
              />
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
