import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";

export function SetupNickname() {
  const { user, profile, setProfile } = useAuthStore();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate("/auth");
    else if (profile?.username) navigate("/");
  }, [user, profile, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError("Nickname cannot be blank.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({ username: trimmed })
        .eq("id", user!.id)
        .select()
        .single();
      if (error) {
        if (error.message.includes("profiles_username_key") || error.message.includes("duplicate key")) {
          throw new Error("That nickname is already taken.");
        }
        throw error;
      }
      setProfile(data);
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <Card>
        <CardHeader>
          <CardTitle>Choose a Nickname</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Pick a nickname that other players will see.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="nickname">Nickname</Label>
              <Input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                autoComplete="username"
                maxLength={30}
                autoFocus
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "..." : "Save Nickname"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
