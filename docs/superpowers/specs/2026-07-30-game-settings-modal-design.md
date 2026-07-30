# Game Settings Modal — Design

## Problem

Admins currently add a new game instance to a casino via a small inline form
that expands underneath each game type card in the Games settings tab (name
field + Create/Cancel). There is no way to edit an instance's name after
creation — only delete it.

## Goal

- A settings popup (modal) appears whenever an admin creates a new game
  instance.
- The same popup is reachable after the game exists, so its name can be
  changed later.
- For now the only editable setting is the instance's name. The front image
  is fixed to the game type's default image and shown read-only, with a
  disabled "Change image — coming soon" control communicating where
  per-instance images will go once that's built.

## Component: `src/components/GameSettingsModal.tsx`

New component, used for both creating and editing an instance.

```ts
interface GameSettingsModalProps {
  mode: "create" | "edit";
  gameTypeName: string;   // e.g. "Slot Machine" — used in the create-mode title
  imageUrl: string | undefined;
  initialName: string;    // gt.name as a default in create mode, custom_name in edit mode
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}
```

- Renders via the existing `Modal` component at size `"md"`.
- Title: `Add {gameTypeName}` in create mode, `Edit {initialName}` in edit
  mode.
- Body:
  - Image preview (the fixed default art) with a disabled button/overlay
    reading "Change image — coming soon" beneath it.
  - `Name` labeled text input, pre-filled with `initialName`, autofocused.
  - Save / Cancel buttons. Save is disabled while saving or when the
    trimmed name is empty.
- Owns its own `saving` / `error` local state, mirroring the current inline
  form: on save, calls `onSave(trimmedName)`; on failure shows the same
  inline error text used today ("Failed to add game" / the thrown error
  message); on success calls `onClose()`.
- Submitting via Enter in the name field triggers Save, matching current
  behavior.

## Wiring in `CasinoDashboard.tsx` (`SettingsTab`)

- Replace the `addingType` / `newName` inline-expansion state with:
  ```ts
  type ModalState =
    | { mode: "create"; gameType: GameType }
    | { mode: "edit"; game: CasinoGame }
    | null;
  const [modalState, setModalState] = useState<ModalState>(null);
  ```
- "+ Add" button on a game type card → `setModalState({ mode: "create", gameType: gt })`.
  Same `atMax` (5 instances) disable logic as today.
- Each instance row gets a small gear icon placed before the existing trash
  icon → `setModalState({ mode: "edit", game: inst })`.
- Render `<GameSettingsModal>` conditionally based on `modalState`, wiring:
  - create mode: `onSave={(name) => onCreate(modalState.gameType.id, name)}`
  - edit mode: `onSave={(name) => onUpdate(modalState.game.id, name)}`
  - `onClose={() => setModalState(null)}` in both cases.
- The inline add-form JSX (`isAdding` block) and its associated state
  (`addingType`, `newName`, `saving`, `saveError`) are removed — fully
  replaced by the modal.

## Hook change: `src/hooks/useGames.ts`

Add:

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

Exported alongside `listGameTypes`, `listCasinoGames`, `createGame`,
`deleteGame`. `CasinoDashboard` wires it to update local `casinoGames`
state the same way `createGame`/`deleteGame` already do (replace the
matching entry by `id`).

## Cleanup: consolidate duplicated game-art maps

`GameTile.tsx`'s `GAME_ART` and `CasinoDashboard.tsx`'s
`SETTINGS_GAME_ART` are identical `Record<string, string>` maps from
`game_type_id` to an SVG path. The new modal needs the same lookup a third
time, so this is consolidated into a single export:

- New file `src/lib/gameArt.ts` exporting `GAME_ART: Record<string, string>`.
- `GameTile.tsx` imports and uses it instead of its local copy.
- `CasinoDashboard.tsx` imports it instead of its local `SETTINGS_GAME_ART`
  (all call sites renamed to `GAME_ART` or aliased on import).
- `GameSettingsModal.tsx` imports it to resolve `imageUrl` isn't needed
  internally — the caller passes `imageUrl` in, resolved from the same
  shared map at the call site in `CasinoDashboard.tsx`.

## Out of scope

- No DB migration. The image stays a fixed lookup by `game_type_id`, not
  stored per-instance. A column (e.g. `image_url` on `casino_games`) is
  added later when per-instance images become editable.
- No changes to which game types exist, deletion behavior, or the 5-instance
  cap.

## Testing

Manual verification via Playwright using the seeded test admin account
(`claudetest.cassie@gmail.com`):

1. Open a casino's admin Settings tab → Games section.
2. Click "+ Add" on a game type → modal opens with the type's default name
   and image preview.
3. Change the name, Save → modal closes, new instance appears in the list.
4. Click the gear icon on an existing instance → modal opens in edit mode
   pre-filled with its current name.
5. Change the name, Save → modal closes, list reflects the new name.
6. Refresh the page → renamed instance persists (confirms the DB update,
   not just local state).
