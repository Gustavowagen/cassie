import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, LogIn } from "lucide-react";
import { Button } from "../components/ui/button";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";
import { avatarGradient, initialsOf } from "../lib/utils";

const GLASS = "bg-white/5 backdrop-blur-xl border border-white/10";

export function Profile() {
  const { user, profile, setProfile, signOut } = useAuthStore();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(profile?.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const displayName = profile?.username ?? user?.email?.split("@")[0] ?? "";

  function startEditing() {
    setNickname(displayName);
    setEditing(true);
  }

  async function handleSave() {
    const trimmed = nickname.trim();
    if (!trimmed || trimmed === profile?.username) {
      setEditing(false);
      return;
    }
    setError(null);
    setSaving(true);
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
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update nickname");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Profile</h1>
        <div className={`rounded-xl ${GLASS} p-8 text-center space-y-3`}>
          <LogIn className="h-6 w-6 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Sign in to view your profile.</p>
          <Button onClick={() => navigate("/auth")}>Sign in</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      <div className="flex items-center gap-3.5">
        <div
          className="h-[84px] w-[84px] rounded-full flex items-center justify-center text-2xl font-bold text-white flex-none"
          style={{ background: avatarGradient(displayName) }}
        >
          {initialsOf(displayName)}
        </div>
        <div>
          <div className="text-lg font-extrabold">{displayName}</div>
          <div className="text-muted-foreground text-xs mt-0.5">{user.email}</div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-bold">Username</h2>
        <div className={`rounded-xl ${GLASS} p-3.5`}>
          <label className="text-muted-foreground text-[11px] block mb-1">
            DISPLAY NAME
          </label>
          <div className="flex items-center justify-between gap-2.5">
            <input
              value={editing ? nickname : displayName}
              onChange={(e) => setNickname(e.target.value)}
              readOnly={!editing}
              maxLength={30}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="flex-1 bg-transparent border-none outline-none text-sm font-semibold"
            />
            <button
              type="button"
              onClick={() => (editing ? handleSave() : startEditing())}
              disabled={saving}
              className={`h-[26px] w-[26px] rounded-full flex items-center justify-center flex-none ${GLASS}`}
            >
              {editing ? (
                <span className="text-[11px] font-bold text-primary">{saving ? "…" : "✓"}</span>
              ) : (
                <Pencil className="h-[13px] w-[13px]" />
              )}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      <button
        type="button"
        onClick={() => signOut().then(() => navigate("/"))}
        className="w-full rounded-xl py-3.5 text-center text-sm font-semibold text-red-300 bg-red-400/10 border border-red-400/20 hover:bg-red-400/15 transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
