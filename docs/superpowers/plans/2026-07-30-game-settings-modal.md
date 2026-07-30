# Game Settings Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline "+ Add" game-instance form in the casino admin Settings tab with a modal popup, and make that same modal reachable afterward (via a gear icon) so an admin can rename an existing game instance.

**Architecture:** One new presentational component, `GameSettingsModal`, renders a name field plus a read-only image preview (with a disabled "coming soon" control) and Save/Cancel buttons. `CasinoDashboard.tsx`'s `SettingsTab` drives it with a single `gameModal` state slot that's either `{ mode: "create", gameType }`, `{ mode: "edit", game }`, or `null`, wrapping the component in the existing `Modal` (size `md`). A new `updateGame` function is added to `useGames.ts` for the rename. Along the way, the two duplicate `game_type_id → image path` lookup tables (`GameTile.tsx`'s `GAME_ART` and `CasinoDashboard.tsx`'s `SETTINGS_GAME_ART`) are consolidated into one shared `src/lib/gameArt.ts`.

**Tech Stack:** React + TypeScript, Supabase JS client, existing `Modal`/`Button`/`Input`/`Label` UI primitives. No DB migration. No React component test harness exists in this repo (only `vitest` unit tests on edge-function engine logic) — verification is manual, via the dev server and the seeded Playwright test account, matching how other UI features in this codebase are checked.

---

### Task 1: Consolidate the duplicated game-art maps into `src/lib/gameArt.ts`

**Files:**
- Create: `src/lib/gameArt.ts`
- Modify: `src/components/GameTile.tsx:1-11`
- Modify: `src/pages/CasinoDashboard.tsx:467-474`, `src/pages/CasinoDashboard.tsx:569`

- [ ] **Step 1: Create the shared module**

`src/lib/gameArt.ts`:

```ts
// Front-image lookup for each game type, keyed by game_type_id. Shared by
// GameTile (dashboard tile art), the admin Games settings list, and
// GameSettingsModal's image preview.
export const GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  crash: "/games/crash.svg",
  dice: "/games/dice.svg",
  mines: "/games/mines.svg",
  plinko: "/games/plinko.svg",
};
```

- [ ] **Step 2: Point `GameTile.tsx` at the shared map**

In `src/components/GameTile.tsx`, replace lines 1-11:

```ts
import type { CasinoGame } from "../types";

const GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  crash: "/games/crash.svg",
  dice: "/games/dice.svg",
  mines: "/games/mines.svg",
  plinko: "/games/plinko.svg",
};
```

with:

```ts
import type { CasinoGame } from "../types";
import { GAME_ART } from "../lib/gameArt";
```

- [ ] **Step 3: Point `CasinoDashboard.tsx` at the shared map**

Add the import near the other local imports (after the `GameTile` import, around line 24):

```ts
import { GAME_ART } from "../lib/gameArt";
```

Remove the local `SETTINGS_GAME_ART` block at lines 467-474:

```ts
const SETTINGS_GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  dice: "/games/dice.svg",
  mines: "/games/mines.svg",
  plinko: "/games/plinko.svg",
};

```

Update the one usage at line 569 from:

```ts
            const art = SETTINGS_GAME_ART[gt.id];
```

to:

```ts
            const art = GAME_ART[gt.id];
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: compiles with no errors (this is a pure rename/import consolidation, no behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gameArt.ts src/components/GameTile.tsx src/pages/CasinoDashboard.tsx
git commit -m "refactor: consolidate duplicated game-art maps into src/lib/gameArt.ts"
```

---

### Task 2: Add `updateGame` to `useGames.ts`

**Files:**
- Modify: `src/hooks/useGames.ts`

- [ ] **Step 1: Add the function**

In `src/hooks/useGames.ts`, add after `createGame` (after line 29, before `deleteGame`):

```ts
  async function updateGame(id: string, customName: string): Promise<CasinoGame> {
    const { data, error } = await supabase
      .from("casino_games")
      .update({ custom_name: customName })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as CasinoGame;
  }

```

Update the final `return` statement (currently `return { listGameTypes, listCasinoGames, createGame, deleteGame };`) to:

```ts
  return { listGameTypes, listCasinoGames, createGame, updateGame, deleteGame };
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGames.ts
git commit -m "feat(games): add updateGame for renaming a casino game instance"
```

---

### Task 3: Create `GameSettingsModal` component

**Files:**
- Create: `src/components/GameSettingsModal.tsx`

- [ ] **Step 1: Write the component**

`src/components/GameSettingsModal.tsx`:

```tsx
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const GLASS = "bg-white/5 backdrop-blur-xl border border-white/10";
const CARD_GLOW = "shadow-[0_8px_32px_rgba(124,58,237,0.15)]";

interface GameSettingsModalProps {
  title: string;
  imageUrl: string | undefined;
  initialName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

export function GameSettingsModal({ title, imageUrl, initialName, onSave, onClose }: GameSettingsModalProps) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  async function handleSave() {
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save game");
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-2xl ${GLASS} ${CARD_GLOW} overflow-hidden`}>
      <div className="flex items-start justify-between p-5 border-b border-white/10">
        <p className="font-semibold text-base">{title}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <Label>Front image</Label>
          <div className="mt-1.5 rounded-xl border border-border overflow-hidden">
            {imageUrl && (
              <img src={imageUrl} alt="" className="h-32 w-full object-cover" />
            )}
            <button
              type="button"
              disabled
              className="w-full py-1.5 text-xs font-medium text-muted-foreground bg-black/20 cursor-not-allowed"
            >
              Change image — coming soon
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="game-settings-name">Name</Label>
          <Input
            id="game-settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Game name"
            className="mt-1.5"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !trimmed}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: compiles with no errors. (The component isn't wired up anywhere yet, so this only checks the file is self-consistent.)

- [ ] **Step 3: Commit**

```bash
git add src/components/GameSettingsModal.tsx
git commit -m "feat(games): add GameSettingsModal for create/edit game instance"
```

---

### Task 4: Wire the modal into `SettingsTab`, replacing the inline add-form

**Files:**
- Modify: `src/pages/CasinoDashboard.tsx:66` (hook destructure)
- Modify: `src/pages/CasinoDashboard.tsx:301-316` (`SettingsTab` call site)
- Modify: `src/pages/CasinoDashboard.tsx:476-649` (`SettingsTab` definition)

- [ ] **Step 1: Pull `updateGame` out of the hook**

At line 66, change:

```ts
  const { listGameTypes, listCasinoGames, createGame, deleteGame } = useGames();
```

to:

```ts
  const { listGameTypes, listCasinoGames, createGame, updateGame, deleteGame } = useGames();
```

- [ ] **Step 2: Add the `onUpdate` prop at the `SettingsTab` call site**

Replace lines 301-316:

```tsx
          {activeTab === "settings" && (
            <SettingsTab
              casinoId={currentCasino.id}
              casino={currentCasino}
              casinoGames={casinoGames}
              managedGameTypes={gameTypes.filter((g) => MANAGED_GAME_IDS.includes(g.id))}
              onCreate={async (typeId, customName) => {
                const newGame = await createGame(currentCasino.id, typeId, customName);
                setCasinoGames((prev) => [...prev, newGame]);
              }}
              onDelete={async (id) => {
                await deleteGame(id);
                setCasinoGames((prev) => prev.filter((g) => g.id !== id));
              }}
            />
          )}
```

with:

```tsx
          {activeTab === "settings" && (
            <SettingsTab
              casinoId={currentCasino.id}
              casino={currentCasino}
              casinoGames={casinoGames}
              managedGameTypes={gameTypes.filter((g) => MANAGED_GAME_IDS.includes(g.id))}
              onCreate={async (typeId, customName) => {
                const newGame = await createGame(currentCasino.id, typeId, customName);
                setCasinoGames((prev) => [...prev, newGame]);
              }}
              onUpdate={async (id, customName) => {
                const updated = await updateGame(id, customName);
                setCasinoGames((prev) => prev.map((g) => (g.id === id ? updated : g)));
              }}
              onDelete={async (id) => {
                await deleteGame(id);
                setCasinoGames((prev) => prev.filter((g) => g.id !== id));
              }}
            />
          )}
```

- [ ] **Step 3: Import `GameSettingsModal`**

Add near the other component imports (after the `GameTile` import, around line 24):

```ts
import { GameSettingsModal } from "../components/GameSettingsModal";
```

- [ ] **Step 4: Replace the `SettingsTab` definition's games section**

Replace the entire block from `function SettingsTab({` (line 476) through the closing of the games section `</div>` at line 649 (i.e. everything up to, but not including, the `{/* Casino details section */}` comment at line 651) with:

```tsx
type GameModalState =
  | { mode: "create"; gameType: GameType }
  | { mode: "edit"; game: CasinoGame }
  | null;

function SettingsTab({
  casinoId: _casinoId,
  casino,
  casinoGames,
  managedGameTypes,
  onCreate,
  onUpdate,
  onDelete,
}: {
  casinoId: string;
  casino: Casino;
  casinoGames: CasinoGame[];
  managedGameTypes: GameType[];
  onCreate: (typeId: string, customName: string) => Promise<void>;
  onUpdate: (id: string, customName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [gameModal, setGameModal] = useState<GameModalState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [description, setDescription] = useState(casino.description ?? "");
  const [primaryColor, setPrimaryColor] = useState(casino.theme.primaryColor);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null);

  function countForType(typeId: string) {
    return casinoGames.filter((g) => g.game_type_id === typeId).length;
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveDetails() {
    setDetailsSaving(true);
    setDetailsMessage(null);
    try {
      await supabase
        .from("casinos")
        .update({ description, theme: { ...casino.theme, primaryColor } })
        .eq("id", casino.id);
      setDetailsMessage("Saved!");
      setTimeout(() => setDetailsMessage(null), 2000);
    } catch (err) {
      setDetailsMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setDetailsSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Games section */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-base">Available Games</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Up to 5 instances per game type.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {managedGameTypes.map((gt) => {
            const count = countForType(gt.id);
            const atMax = count >= 5;
            const instances = casinoGames.filter((g) => g.game_type_id === gt.id);
            const playable = PLAYABLE_GAME_IDS.has(gt.id);
            const art = GAME_ART[gt.id];

            return (
              <div key={gt.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                  {art && (
                    <div className="h-10 w-10 rounded-lg overflow-hidden shrink-0 border border-border">
                      <img src={art} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-sm">{gt.name}</p>
                      {!playable && (
                        <span className="text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                          soon
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{count}/5 active</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={atMax}
                    onClick={() => setGameModal({ mode: "create", gameType: gt })}
                    className="shrink-0 text-xs h-7 px-2.5"
                  >
                    + Add
                  </Button>
                </div>

                {instances.length > 0 && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                    {instances.map((inst) => (
                      <div key={inst.id} className="flex items-center justify-between">
                        <span className="text-sm">{inst.custom_name}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setGameModal({ mode: "edit", game: inst })}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === inst.id}
                            onClick={() => handleDelete(inst.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {gameModal && (
        <Modal onClose={() => setGameModal(null)} size="md">
          <GameSettingsModal
            title={gameModal.mode === "create" ? `Add ${gameModal.gameType.name}` : `Edit ${gameModal.game.custom_name}`}
            imageUrl={GAME_ART[gameModal.mode === "create" ? gameModal.gameType.id : gameModal.game.game_type_id]}
            initialName={gameModal.mode === "create" ? gameModal.gameType.name : gameModal.game.custom_name}
            onSave={async (name) => {
              if (gameModal.mode === "create") {
                await onCreate(gameModal.gameType.id, name);
              } else {
                await onUpdate(gameModal.game.id, name);
              }
              setGameModal(null);
            }}
            onClose={() => setGameModal(null)}
          />
        </Modal>
      )}

```

Note: this removes the `addingType`, `newName`, `saving`, `saveError`, `startAdding`, and `handleCreate` state/functions entirely (their behavior is now inside `GameSettingsModal`), and removes the inline `isAdding` form JSX. The `{/* Casino details section */}` block that follows (originally starting at line 651) is unchanged and stays right after this.

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: compiles with no errors. If TypeScript complains about unused `casinoId`/`_casinoId`, that's pre-existing (already prefixed with `_`) and not a new issue.

- [ ] **Step 6: Commit**

```bash
git add src/pages/CasinoDashboard.tsx
git commit -m "feat(games): open a settings modal to create or rename game instances"
```

---

### Task 5: Manual verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on `http://localhost:5173`.

- [ ] **Step 2: Sign in and open a casino's admin settings**

Using Playwright (or the `claude-in-chrome` browser tools), sign in with the seeded test account:
- Email: `claudetest.cassie@gmail.com`
- Password: `ClaudeTest123!`

Navigate to any casino the account admins, open the dashboard, go to the **Settings** tab.

- [ ] **Step 3: Verify the create flow**

Click **+ Add** on a game type that isn't at its 5-instance cap. Confirm:
- A modal opens titled "Add {Game Type Name}".
- The image preview shows the game type's default art, with a disabled "Change image — coming soon" control beneath it.
- The name field is pre-filled with the game type's name.
- Change the name, click **Save**. Confirm the modal closes and the new instance appears in the list under that game type with the new name.

- [ ] **Step 4: Verify the edit flow**

Click the gear icon next to any existing game instance. Confirm:
- A modal opens titled "Edit {current name}", pre-filled with that name.
- Change the name, click **Save**. Confirm the modal closes and the instance's name updates in the list immediately.

- [ ] **Step 5: Verify persistence**

Refresh the page, go back to Settings. Confirm the renamed instance still shows its new name (proves the Supabase update landed, not just local state).

- [ ] **Step 6: Verify delete and the 5-instance cap still work**

Delete a game instance via the trash icon — confirm it disappears. Confirm **+ Add** becomes disabled once a game type reaches 5 instances.

- [ ] **Step 7: Run the full test suite as a final sanity check**

Run: `npm test`
Expected: all existing tests pass (this feature touches no edge-function engine logic, so nothing here should change).

---

## Self-Review Notes

- **Spec coverage:** popup-on-create ✅ (Task 4, `+ Add` → `gameModal` create mode), popup-reachable-after-creation ✅ (Task 4, gear icon → `gameModal` edit mode), name-only editable setting ✅ (`GameSettingsModal`'s single `Name` field), fixed default image shown read-only with a note about future editability ✅ (disabled "Change image — coming soon" control), `GAME_ART` consolidation ✅ (Task 1), no DB migration ✅ (no migration file in this plan), manual test plan ✅ (Task 5).
- **Type consistency:** `CasinoGame`/`GameType` types (from `src/types/index.ts`) are used as-is, unmodified. `GameSettingsModal`'s props (`title`, `imageUrl`, `initialName`, `onSave`, `onClose`) match exactly between its Task 3 definition and its Task 4 call site. `useGames()`'s returned `updateGame` signature (`(id: string, customName: string) => Promise<CasinoGame>`) matches its Task 2 definition and Task 4 usage.
- **No placeholders:** every step has complete, runnable code — no TODOs or "similar to above" shortcuts.
