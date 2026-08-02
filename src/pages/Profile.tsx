import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, LogIn, Camera, Check } from "lucide-react";
import { Button } from "../components/ui/button";
import { Modal } from "../components/ui/modal";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";
import {
  avatarGradient,
  initialsOf,
  AVATAR_PRESETS,
  avatarPresetUrl,
  avatarPresetKeyFromUrl,
  findAvatarPreset,
} from "../lib/utils";

const GLASS = "bg-white/5 backdrop-blur-xl border border-white/10";

export function Profile() {
  const { user, profile, setProfile, signOut } = useAuthStore();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(profile?.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const displayName = profile?.username ?? user?.email?.split("@")[0] ?? "";

  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const selectedPresetKey = avatarPresetKeyFromUrl(profile?.avatar_url);
  const selectedPreset = selectedPresetKey ? findAvatarPreset(selectedPresetKey) : undefined;

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

  async function selectAvatar(key: string | null) {
    const previousProfile = profile;
    const newAvatarUrl = key ? avatarPresetUrl(key) : null;
    setAvatarError(null);
    setAvatarSaving(key ?? "__reset__");
    setProfile(profile ? { ...profile, avatar_url: newAvatarUrl } : profile);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .update({ avatar_url: newAvatarUrl })
        .eq("id", user!.id)
        .select()
        .single();
      if (error) throw error;
      setProfile(data);
      setPickerOpen(false);
    } catch (err: unknown) {
      setProfile(previousProfile);
      setAvatarError(err instanceof Error ? err.message : "Failed to update picture");
    } finally {
      setAvatarSaving(null);
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
        <button
          type="button"
          onClick={() => {
            setAvatarError(null);
            setPickerOpen(true);
          }}
          className="group relative h-[84px] w-[84px] rounded-full flex items-center justify-center text-2xl font-bold text-white flex-none"
          style={{ background: selectedPreset ? selectedPreset.gradient : avatarGradient(displayName) }}
        >
          {selectedPreset ? selectedPreset.emoji : initialsOf(displayName)}
          <span className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <Camera className="h-6 w-6" />
          </span>
        </button>
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

      {pickerOpen && (
        <Modal onClose={() => setPickerOpen(false)} size="md" dismissible={avatarSaving === null}>
          <div className={`rounded-2xl ${GLASS} p-5 space-y-4`}>
            <h2 className="text-base font-bold">Choose a profile picture</h2>
            <div className="grid grid-cols-3 gap-3">
              {AVATAR_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => selectAvatar(preset.key)}
                  disabled={avatarSaving !== null}
                  className="relative h-16 w-16 mx-auto rounded-full flex items-center justify-center text-2xl disabled:opacity-50"
                  style={{ background: preset.gradient }}
                >
                  {preset.emoji}
                  {selectedPresetKey === preset.key && (
                    <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="h-3 w-3 text-white" />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => selectAvatar(null)}
              disabled={avatarSaving !== null || !selectedPresetKey}
              className="w-full rounded-xl py-2.5 text-center text-sm font-semibold bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              Use initials instead
            </button>
            {avatarError && <p className="text-sm text-destructive">{avatarError}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
