# Default Profile Pictures — Design

## Goal

Let a user pick a preset profile picture (casino-icon avatar) on the Profile page, instead of always seeing the gradient+initials placeholder.

## Data Model

Reuse the existing `profiles.avatar_url` column (already selected in `useCasino.ts` and typed in `src/types/index.ts`, but currently unused for rendering — no migration needed).

- A picked preset is stored as the string `preset:<key>` (e.g. `preset:dice`).
- `avatar_url === null` (the default) means "no preset picked" — falls back to the current gradient+initials rendering, unchanged from today.
- The `preset:` prefix avoids ambiguity if real image-upload URLs are added later.

## Preset Set

Nine presets, each a fixed emoji paired with a fixed gradient (curated, not hash-derived like `avatarGradient`):

| key | emoji |
|---|---|
| `dice` | 🎲 |
| `spade` | ♠️ |
| `diamond` | ♦️ |
| `club` | ♣️ |
| `heart` | ♥️ |
| `slots` | 🎰 |
| `joker` | 🃏 |
| `roulette` | 🎡 |
| `chip` | 🪙 |

Defined as a single `AVATAR_PRESETS: { key: string; emoji: string; gradient: string }[]` array in `src/lib/utils.ts`, next to `avatarGradient`.

## UI

**Trigger:** In `Profile.tsx`, the existing 84px avatar circle becomes clickable (`<button>` instead of `<div>`). On hover/focus it shows a small pencil/camera badge overlay in the bottom-right corner, echoing the existing pencil-icon affordance used for nickname editing.

**Picker modal:** Clicking the avatar opens the shared `Modal` component (`size="md"`, dismissible). Contents:
- A 3×3 grid of the nine presets, each rendered as a ~64px circle (emoji on its gradient).
- The currently-selected preset (if any) shows a highlighted ring.
- Clicking a preset saves immediately (no separate confirm step): optimistic local update, then `supabase.from("profiles").update({ avatar_url: "preset:<key>" }).eq("id", user.id)`, then close the modal. On failure, roll back the optimistic update and surface the existing error-message pattern used elsewhere on the page.
- A reset control (e.g. "Use initials instead") sets `avatar_url` back to `null` the same way.

**Rendering:** In `Profile.tsx`, if `profile.avatar_url` starts with `preset:`, look up the matching entry in `AVATAR_PRESETS` and render its emoji on its gradient in the avatar circle; otherwise render today's `avatarGradient(displayName)` + `initialsOf(displayName)`.

## Out of Scope

- Real image upload.
- Showing the picked preset anywhere besides `Profile.tsx` (e.g. `CasinoDashboard.tsx` member lists/headers keep using `avatarGradient(username)` + initials, untouched).
- Admins setting another member's avatar.

## Testing

- Manual verification via Playwright using the seeded test account (`claudetest.cassie@gmail.com`): open Profile, pick a preset, confirm it persists across reload, reset back to initials, confirm that persists too.
