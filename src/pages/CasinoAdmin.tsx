import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { supabase } from "../lib/supabase";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import { useCasino } from "../hooks/useCasino";
import type { GameType } from "../types";

export function CasinoAdmin() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getCasinoBySlug } = useCasino();
  const { currentCasino, setCasino } = useCasinoStore();
  const { user } = useAuthStore();
  const [allGames, setAllGames] = useState<GameType[]>([]);
  const [enabledGameIds, setEnabledGameIds] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#7c3aed");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !user) return;

    getCasinoBySlug(slug).then((c) => {
      if (!c || c.owner_id !== user.id) {
        navigate("/");
        return;
      }
      setCasino(c);
      setDescription(c.description ?? "");
      setPrimaryColor(c.theme.primaryColor);

      supabase
        .from("casino_games")
        .select("game_type_id")
        .eq("casino_id", c.id)
        .then(({ data }) =>
          setEnabledGameIds(new Set(data?.map((g) => g.game_type_id) ?? []))
        );
    });

    supabase
      .from("game_types")
      .select("*")
      .then(({ data }) => setAllGames((data ?? []) as GameType[]));
  }, [slug, user]);

  function toggleGame(gameId: string) {
    setEnabledGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  }

  async function handleSave() {
    if (!currentCasino) return;
    setSaving(true);
    setMessage(null);
    try {
      await supabase
        .from("casinos")
        .update({
          description,
          theme: { ...currentCasino.theme, primaryColor },
        })
        .eq("id", currentCasino.id);

      await supabase
        .from("casino_games")
        .delete()
        .eq("casino_id", currentCasino.id);

      if (enabledGameIds.size > 0) {
        await supabase.from("casino_games").insert(
          [...enabledGameIds].map((id) => ({
            casino_id: currentCasino.id,
            game_type_id: id,
          }))
        );
      }
      setMessage("Saved successfully!");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!currentCasino)
    return (
      <div className="text-center py-16 text-muted-foreground">Loading...</div>
    );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin — {currentCasino.name}</h1>
        <Button
          variant="outline"
          onClick={() => navigate(`/casino/${slug}`)}
        >
          Back to Casino
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Casino Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <Label>Primary Color</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-16 cursor-pointer rounded border"
              />
              <span className="text-sm text-muted-foreground">
                {primaryColor}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enabled Games</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {allGames.map((game) => (
              <Badge
                key={game.id}
                variant={enabledGameIds.has(game.id) ? "default" : "outline"}
                className="cursor-pointer text-sm py-1 px-3 select-none"
                onClick={() => toggleGame(game.id)}
              >
                {game.name}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Click to toggle games on/off for your casino.
          </p>
        </CardContent>
      </Card>

      {message && (
        <p className="text-sm text-center text-muted-foreground">{message}</p>
      )}
      <Button className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}
