# Per-Game Info Buttons — Design

## Problem

Players have no in-app way to learn how a game works or what its rules are
(e.g. whether Blackjack lets you split a King and a Queen). Each game's
modal (`src/components/games/*.tsx`) only shows the game itself.

## Scope

Add a clickable info ("i") button to every existing game (Dice, Plinko,
Blackjack, Roulette, Mines, Slots, Crash). Clicking it swaps the game's
body content for a short description plus any rules worth stating
precisely. Clicking again (or a "Back to game" button in the panel) returns
to the game, with no loss of in-progress round state. Future games should
follow the same pattern — CLAUDE.md's "Adding a New Game" checklist gets a
new step for this.

Explicitly out of scope, per user direction during brainstorming:
- No mention of house edge or other numeric-fairness details anywhere.
- Slots' reward mode (single-row vs full-board) is described generically —
  not as this casino's live configured value — even though it's the one
  real per-casino-configurable, gameplay-affecting setting in the codebase
  (`casino_games.settings.rewardMode`, read in `slots/index.ts`).

## Content

New file `src/lib/gameInfo.ts`:

```ts
export interface GameInfoEntry {
  title: string;
  description: string;
  rules?: string[];
}

export const GAME_INFO: Record<
  "dice" | "plinko" | "blackjack" | "roulette" | "mines" | "slots" | "crash",
  GameInfoEntry
> = { ... };
```

Keyed by the same `game_type_id` strings already used in
`CasinoDashboard.tsx` (`"blackjack"`, `"roulette"`, `"dice"`, `"mines"`,
`"crash"`, `"slots"`, `"plinko"`).

Per-game copy (2-3 sentence description + rules bullets where the rules
are non-obvious), sourced from the actual engine behavior in
`supabase/functions/<game>/engine.ts` (verified against `engine.test.ts`
where relevant — not guessed):

- **Dice** — pick a target number and roll under/over it; the server draws
  a random result and the win chance you pick determines your payout
  multiplier (lower win chance, higher multiplier).
- **Plinko** — drop a ball down a 12-row peg board after choosing a risk
  level (low/medium/high); risk changes how extreme the landing
  multipliers are (bigger edges vs a bigger safe middle), not how the
  board itself works.
- **Blackjack** — the most detail, since its rules are the least obvious:
  - Dealer stands on all 17s, including soft 17.
  - Blackjack (natural 21) pays 3:2.
  - Splitting requires an exact rank match — a King and a Queen are both
    worth 10 but are **not** a pair; King and King is.
  - Up to 3 hands total from splitting (an initial split plus one resplit).
  - Splitting aces deals one card to each hand and ends both immediately —
    even a resulting 21 does not pay the blackjack bonus.
  - Double is allowed on any fresh two-card hand, including after a split,
    except split aces.
  - Insurance is offered only when the dealer shows an ace, costs half your
    bet, and pays 2:1 if the dealer has blackjack.
- **Roulette** — American wheel (0 and 00, 38 pockets total); place bets on
  numbers or outside bets. Payout odds: straight 35:1, split 17:1, corner
  8:1, dozens/columns 2:1, red/black/even/odd/high-low 1:1.
- **Mines** — choose how many mines (1-24) are hidden on a 5×5 grid; each
  safe tile you reveal raises your multiplier; cash out anytime; hitting a
  mine ends the round with a total loss.
- **Slots** — 5-reel, 5-symbol machine. Generic explanation of both
  possible reward modes without stating which one is active: single-row
  (3+ matching symbols anywhere on the middle row) or full-board (7+
  matching cells anywhere across all 15 visible cells, higher tiers pay
  more).
- **Crash** — a multiplier climbs from 1× once the round starts; cash out
  anytime to win bet × current multiplier; the crash point is randomly
  predetermined and hidden, and missing it loses the full bet.

## Components

- `src/components/ui/GameInfoButton.tsx` — icon button following the exact
  pattern of `MuteButton`/`BackdropToggleButton` (same `className` prop
  default, `h-5 w-5` lucide icon — `Info`). Takes `active: boolean` and
  `onClick: () => void`; no context needed since this is local per-game
  state, unlike the backdrop toggle which is modal-wide.
- `src/components/ui/GameInfoPanel.tsx` — takes a `game` key into
  `GAME_INFO` (or the resolved entry directly) plus an `onBack` callback.
  Renders title, description paragraph, bulleted "Rules" list if present,
  and a "Back to game" button. Styled with plain `bg-card`/foreground
  tokens so it reads correctly inside every game's theme (including
  Blackjack's dark glass theme — panel sits on top of that game's own
  background, no per-theme variants needed).

## Placement & behavior

Every game gets local state: `const [showInfo, setShowInfo] = useState(false)`.

- `<GameInfoButton>` sits immediately beside `<BackdropToggleButton>` in
  the header row, in all 7 games.
- When `showInfo` is true, the game swaps its **body content only** for
  `<GameInfoPanel>`; the header (title/balance, buttons, Exit) is
  untouched and stays functional the whole time.
  - Dice, Plinko, Crash, Slots, Roulette, Mines all already wrap their
    body in a single `flex-1 min-h-0 overflow-auto` div right after the
    header — the conditional swap happens there.
  - Blackjack swaps its "Title + table" block (the two elements right
    after its `<header>`), keeping the top bar (Leave button, info/mute
    buttons, balance pill) in place.
- Closing: clicking the info button again (toggle) or the panel's own
  "Back to game" button both close it.
- This is a pure content swap, not an unmount — no game/round state is
  lost. A mid-hand Blackjack round or a mid-board Mines round is
  untouched underneath and resumes exactly where it was.

## CLAUDE.md update

Add a step to "Adding a New Game" (after the existing win/loss-feedback
step) instructing that new games must add a `GAME_INFO` entry in
`src/lib/gameInfo.ts` and place `<GameInfoButton>` beside
`<BackdropToggleButton>` in the header.

## Testing

No engine/business-logic changes — this is presentational only. Verify by
opening each of the 7 games in the browser (via the Playwright test
account), clicking the info button, confirming the body swaps to the
description/rules and the header stays interactive, and clicking back
(both ways) to confirm the game resumes with state intact (e.g. mid-round
Mines/Blackjack).
