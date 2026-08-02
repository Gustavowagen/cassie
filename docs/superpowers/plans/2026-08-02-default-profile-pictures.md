# Default Profile Pictures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick one of nine preset casino-icon avatars on the Profile page, stored in the existing `profiles.avatar_url` column, with a reset back to the current gradient+initials look.

**Architecture:** A curated `AVATAR_PRESETS` array + two tiny string helpers live in `src/lib/utils.ts` (pure logic, unit-tested). `src/pages/Profile.tsx` gets a clickable avatar that opens the shared `Modal` component with a 3×3 preset grid; picking one calls `supabase.from("profiles").update(...)` and updates the Zustand `authStore` profile, optimistically and with rollback on failure — mirroring the existing nickname-edit flow already in that file.

**Tech Stack:** React + TypeScript, Zustand (`useAuthStore`), Supabase client, existing `Modal` UI component, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-02-default-profile-pictures-design.md`

---

### Task 1: Avatar preset data + helpers in `src/lib/utils.ts`

**Files:**
- Modify: `src/lib/utils.ts`
- Test: `src/lib/utils.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AVATAR_PRESETS, avatarPresetKeyFromUrl, avatarPresetUrl, findAvatarPreset } from "./utils";

describe("avatar presets", () => {
  it("has nine unique preset keys", () => {
    const keys = AVATAR_PRESETS.map((p) => p.key);
    expect(keys).toHaveLength(9);
    expect(new Set(keys).size).toBe(9);
  });

  it("round-trips a preset key through avatarPresetUrl and avatarPresetKeyFromUrl", () => {
    const url = avatarPresetUrl("dice");
    expect(url).toBe("preset:dice");
    expect(avatarPresetKeyFromUrl(url)).toBe("dice");
  });

  it("returns null for a non-preset avatar_url", () => {
    expect(avatarPresetKeyFromUrl(null)).toBeNull();
    expect(avatarPresetKeyFromUrl(undefined)).toBeNull();
    expect(avatarPresetKeyFromUrl("https://example.com/photo.png")).toBeNull();
  });

  it("finds a preset by key", () => {
    expect(findAvatarPreset("dice")?.emoji).toBe("🎲");
    expect(findAvatarPreset("nonexistent")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/utils.test.ts`
Expected: FAIL — `AVATAR_PRESETS`, `avatarPresetKeyFromUrl`, `avatarPresetUrl`, `findAvatarPreset` are not exported from `./utils`.

- [ ] **Step 3: Add the presets and helpers**

Append to `src/lib/utils.ts` (after `initialsOf`):

```typescript
export interface AvatarPreset {
  key: string;
  emoji: string;
  gradient: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: "dice", emoji: "🎲", gradient: "linear-gradient(135deg, hsl(263 70% 55%), hsl(303 70% 40%))" },
  { key: "spade", emoji: "♠️", gradient: "linear-gradient(135deg, hsl(220 70% 50%), hsl(260 70% 35%))" },
  { key: "diamond", emoji: "♦️", gradient: "linear-gradient(135deg, hsl(0 70% 55%), hsl(340 70% 40%))" },
  { key: "club", emoji: "♣️", gradient: "linear-gradient(135deg, hsl(150 65% 42%), hsl(190 65% 32%))" },
  { key: "heart", emoji: "♥️", gradient: "linear-gradient(135deg, hsl(340 75% 55%), hsl(0 75% 45%))" },
  { key: "slots", emoji: "🎰", gradient: "linear-gradient(135deg, hsl(40 80% 55%), hsl(15 80% 45%))" },
  { key: "joker", emoji: "🃏", gradient: "linear-gradient(135deg, hsl(280 65% 55%), hsl(320 65% 40%))" },
  { key: "roulette", emoji: "🎡", gradient: "linear-gradient(135deg, hsl(190 70% 50%), hsl(230 70% 40%))" },
  { key: "chip", emoji: "🪙", gradient: "linear-gradient(135deg, hsl(45 85% 55%), hsl(30 85% 40%))" },
];

const AVATAR_PRESET_PREFIX = "preset:";

export function avatarPresetUrl(key: string): string {
  return `${AVATAR_PRESET_PREFIX}${key}`;
}

export function avatarPresetKeyFromUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl || !avatarUrl.startsWith(AVATAR_PRESET_PREFIX)) return null;
  return avatarUrl.slice(AVATAR_PRESET_PREFIX.length);
}

export function findAvatarPreset(key: string): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((p) => p.key === key);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/utils.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat(profile): add avatar preset data and helpers"
```

---

### Task 2: Avatar picker UI in `src/pages/Profile.tsx`

**Files:**
- Modify: `src/pages/Profile.tsx`

- [ ] **Step 1: Update imports and derive the selected preset**

In `src/pages/Profile.tsx`, replace the top imports and add derived state. Replace:

```typescript
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, LogIn } from "lucide-react";
import { Button } from "../components/ui/button";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";
import { avatarGradient, initialsOf } from "../lib/utils";
```

with:

```typescript
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
```

Then, inside the `Profile` function, right after the existing `const displayName = ...` line, add:

```typescript
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const selectedPresetKey = avatarPresetKeyFromUrl(profile?.avatar_url);
  const selectedPreset = selectedPresetKey ? findAvatarPreset(selectedPresetKey) : undefined;
```

- [ ] **Step 2: Add the save/reset handler**

After the existing `handleSave` function (nickname save), add:

```typescript
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
```

- [ ] **Step 3: Make the avatar clickable and render the preset**

Replace the avatar circle block:

```tsx
        <div
          className="h-[84px] w-[84px] rounded-full flex items-center justify-center text-2xl font-bold text-white flex-none"
          style={{ background: avatarGradient(displayName) }}
        >
          {initialsOf(displayName)}
        </div>
```

with:

```tsx
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="group relative h-[84px] w-[84px] rounded-full flex items-center justify-center text-2xl font-bold text-white flex-none"
          style={{ background: selectedPreset ? selectedPreset.gradient : avatarGradient(displayName) }}
        >
          {selectedPreset ? selectedPreset.emoji : initialsOf(displayName)}
          <span className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <Camera className="h-6 w-6" />
          </span>
        </button>
```

- [ ] **Step 4: Add the picker modal**

At the end of the component's returned JSX, right before the final closing `</div>` (after the sign-out button), add:

```tsx
      {pickerOpen && (
        <Modal onClose={() => setPickerOpen(false)} size="md">
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
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `src/pages/Profile.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/pages/Profile.tsx
git commit -m "feat(profile): add default profile picture picker"
```

---

### Task 3: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify via Playwright using the seeded test account**

Sign in as `claudetest.cassie@gmail.com` / `ClaudeTest123!` (see `CLAUDE.md` Test Account section), navigate to `/profile`, and confirm:
- The avatar circle shows a hover badge (camera icon) and is clickable.
- Clicking it opens a modal with a 3×3 grid of 9 casino-icon presets.
- Clicking a preset closes the modal and updates the avatar immediately.
- Reloading the page (`F5`) shows the same preset persisted (confirms the DB write + fetch-on-load round-trip via `useAuthStore`/`profiles` table).
- Reopening the picker highlights the currently-selected preset with a checkmark.
- Clicking "Use initials instead" reverts the avatar to the gradient+initials look, and this also persists across reload.
- Check the modal at a narrow viewport (~375px) — the 3×3 grid stays usable and doesn't overflow.

- [ ] **Step 3: Confirm no regressions in the nickname editing flow on the same page** (shares the `profile` state and `GLASS` styling)

---

## Self-Review Notes

- Spec coverage: data model (Step 3 of Task 1), preset set (Task 1), trigger/hover badge (Task 2 Step 3), modal grid + selection highlight + reset (Task 2 Step 4), optimistic update + rollback (Task 2 Step 2), scoped to Profile.tsx only (no changes to `CasinoDashboard.tsx`) — all covered.
- No placeholders — every step has complete code.
- Naming is consistent across tasks: `AVATAR_PRESETS`, `avatarPresetUrl`, `avatarPresetKeyFromUrl`, `findAvatarPreset` used identically in Task 1 and Task 2.
