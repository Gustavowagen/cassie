export interface CasinoTheme {
  primaryColor: string;
  backgroundUrl: string | null;
}

export interface CasinoSettings {
  startingBalance: number;
  allowPublicJoin: boolean;
  maxMembers: number;
}

export interface Casino {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  join_code: string;
  description: string | null;
  theme: CasinoTheme;
  settings: CasinoSettings;
  is_active: boolean;
  member_count: number;
  created_at: string;
}

export interface CasinoMemberWithProfile {
  id: string;
  casino_id: string;
  user_id: string;
  balance: number;
  role: "member" | "admin" | "agent";
  agent_id: string | null;
  joined_at: string;
  last_played_at: string | null;
  profile: { username: string | null; avatar_url: string | null } | null;
}

export interface Profile {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

export interface CasinoMember {
  id: string;
  casino_id: string;
  user_id: string;
  balance: number;
  role: "member" | "admin" | "agent";
  agent_id: string | null;
  joined_at: string;
  last_played_at: string | null;
}

export interface GameType {
  id: string;
  name: string;
  description: string | null;
  min_bet: number;
  max_bet: number;
}

export interface CasinoGame {
  id: string;
  casino_id: string;
  game_type_id: string;
  custom_name: string;
  is_active: boolean;
  min_bet: number;
  max_bet: number;
  settings: Record<string, unknown>;
}

// Shape of CasinoGame.settings for a slots instance.
export interface SlotsInstanceSettings {
  rewardMode?: "single_row" | "full_board";
  // Picked from a fixed menu (0%-5% in 1% steps), never freely typed.
  // Missing/off-menu defaults to 0.02 (2%), both here and server-side in
  // the slots edge function (supabase/functions/slots/engine.ts's
  // HOUSE_EDGE_OPTIONS / DEFAULT_HOUSE_EDGE).
  houseEdge?: 0 | 0.01 | 0.02 | 0.03 | 0.04 | 0.05;
  // Visual design id from src/lib/slotsDesigns.ts. Missing defaults to
  // DEFAULT_SLOTS_DESIGN_ID ("default"). Never affects odds/payouts.
  design?: string;
  // Missing defaults to "5x3" (today's board), both here and server-side
  // in supabase/functions/slots/engine.ts's DEFAULT_BOARD_SIZE. Gates
  // which rewardMode values are allowed — see engine.ts's
  // ALLOWED_REWARD_MODES, enforced authoritatively server-side.
  boardSize?: SlotBoardSize;
}

// Mirror of the edge function's sanitized output (engine.ts BlackjackState).
export type Rank = "A"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"10"|"J"|"Q"|"K";
export type Suit = "S"|"H"|"D"|"C";
export interface Card { rank: Rank; suit: Suit }
export type Move = "hit"|"stand"|"double"|"split"|"insurance";
export type BlackjackStatus = "player_turn"|"dealer_turn"|"complete";
export type BlackjackOutcome = "win"|"lose"|"push"|"blackjack";

export interface BlackjackHandView {
  cards: Card[];
  value: number;
  soft: boolean;
  bet: number;
  doubled: boolean;
  outcome?: BlackjackOutcome;
  payout?: number;
}
export interface BlackjackState {
  roundId: string;
  status: BlackjackStatus;
  dealer: { cards: Card[]; value: number | null; soft: boolean; hidden: boolean };
  hands: BlackjackHandView[];
  activeHand: number;
  legalActions: Move[];
  insuranceOffered: boolean;
  balance: number;
}

export type DiceDirection = "under" | "over";

export interface DiceResult {
  roll: number;
  target: number;
  direction: DiceDirection;
  winChance: number;
  multiplier: number;
  won: boolean;
  payout: number;
  balance: number;
}

export interface ChipTransaction {
  id: string;
  user_id: string;
  username: string | null;
  admin_id: string | null;
  admin_username: string | null;
  amount: number;
  balance_after: number;
  created_at: string;
}

export type SlotSymbolId = "dot" | "square" | "diamond" | "star" | "seven";

export type SlotBoardSize = "3x3" | "3x4" | "5x3" | "3x6" | "4x6";

// One reel = one column, top-to-bottom; length always equals the board's
// row count (3 for every size except 4x6, which has 4).
export type SlotReel = SlotSymbolId[];

export interface SlotWin {
  symbol: SlotSymbolId;
  count: number;
  // Reel indices (0-based) holding the winning symbol — not necessarily
  // contiguous or left-aligned, since matches are scatter-style.
  positions: number[];
}

// Full-board mode win: count spans every row, so positions need a row
// index alongside the reel index — kept as a separate type from SlotWin
// rather than unifying, so single-row's shape stays untouched. Every
// symbol has its own threshold and wins independently (see
// supabase/functions/slots/engine.ts), so `wins` holds every symbol that
// independently qualified this spin — normally length 0-1, occasionally
// more when multiple different symbols each clear their own threshold at
// once. Each entry carries its own `count`, since different symbols can
// qualify at different counts in the same spin.
export interface FullBoardSlotWin {
  wins: { symbol: SlotSymbolId; count: number; positions: { reel: number; row: number }[] }[];
}

// Mirror of the edge function's response (supabase/functions/slots/engine.ts).
export interface SlotsResult {
  reels: SlotReel[];
  win: SlotWin | FullBoardSlotWin | null;
  rewardMode: "single_row" | "full_board";
  boardSize: SlotBoardSize;
  bet: number;
  payout: number;
  balance: number;
}

// --- Tumble ---------------------------------------------------------------
//
// Mirrors supabase/functions/tumble/engine.ts. Tumble reuses the slots symbol
// ids (and therefore the slotsDesigns skins), but is otherwise its own game:
// a fixed 5x6 board, full-board wins only, and a cascade where winning
// symbols pop and fresh ones rain down until nothing qualifies.

// board[col][row], row 0 = top.
export type TumbleBoard = SlotSymbolId[][];

export interface TumbleCell {
  col: number;
  row: number;
}

export interface TumbleWin {
  symbol: SlotSymbolId;
  count: number;
  tier: number;
  /** Pay multiplier for this symbol alone, already house-edge scaled. */
  pay: number;
  positions: TumbleCell[];
}

export interface TumbleOrb extends TumbleCell {
  value: number;
}

/** One cascade step: the board that scored, what it paid, what popped. */
export interface TumbleStep {
  board: TumbleBoard;
  wins: TumbleWin[];
  orbs: TumbleOrb[];
  pay: number;
}

export interface TumbleRound {
  steps: TumbleStep[];
  /** The board left once nothing qualified — the opening board on a loss. */
  finalBoard: TumbleBoard;
  /** Summed pay of every step, edge-scaled. A bet multiplier, not chips. */
  basePay: number;
  /** Summed orb values, or 1 when none landed. Orbs never pay alone. */
  multiplier: number;
  totalMultiplier: number;
}

export interface TumbleResult {
  round: TumbleRound;
  bet: number;
  payout: number;
  balance: number;
}

// A purchasable batch of pre-paid spins at a chosen stake. Buying N spins at
// stake S costs exactly N x S -- same odds/house edge as a manual spin, just
// prepaid and auto-played. Mirrors supabase/functions/tumble/engine.ts's
// resolveFreeSpinsSettings, which is the authoritative source of these
// values (this type describes the shape only).
export interface TumbleFreeSpinsSettings {
  enabled: boolean;
  // Floor is always 1, never lower, regardless of the instance's regular
  // min_bet -- enforced both in GameSettingsModal.tsx and server-side.
  minBet: number;
  // >= minBet, capped at GameSettingsModal.tsx's MAX_BET_CEILING.
  maxBet: number;
  // Integer, 1-50.
  spinsPerPurchase: number;
}

// Shape of CasinoGame.settings for a tumble instance. Board size and reward
// mode are fixed by the game, so unlike slots there is nothing to configure
// but the edge, the skin, and (optionally) free spins.
export interface TumbleInstanceSettings {
  // Fixed menu of 1%-5% in 1% steps — note there is no 0% option, unlike
  // slots. Missing/off-menu defaults to 0.03, both here and server-side in
  // supabase/functions/tumble/engine.ts (HOUSE_EDGE_OPTIONS /
  // DEFAULT_HOUSE_EDGE), which is the authoritative gate.
  houseEdge?: 0.01 | 0.02 | 0.03 | 0.04 | 0.05;
  // Visual design id from src/lib/slotsDesigns.ts, shared with slots.
  // Missing defaults to DEFAULT_SLOTS_DESIGN_ID. Never affects odds.
  design?: string;
  // Missing/invalid defaults to { enabled: false, minBet: 1, maxBet: ...,
  // spinsPerPurchase: 10 }, resolved authoritatively server-side by
  // resolveFreeSpinsSettings in supabase/functions/tumble/engine.ts.
  freeSpins?: TumbleFreeSpinsSettings;
}

// Mirror of the edge function's buy_free_spins response.
export interface TumbleFreeSpinsResult {
  rounds: TumbleRound[];
  // The per-spin stake the player chose.
  bet: number;
  // spinsPerPurchase * bet.
  cost: number;
  // Summed payout across every round in the batch.
  payout: number;
  // Authoritative final balance after cost and payout are both applied.
  balance: number;
}

export type PlinkoRisk = "low" | "medium" | "high";

export interface PlinkoResult {
  /** One left (0) / right (1) deflection per row — replayed as the drop animation. */
  path: (0 | 1)[];
  bucket: number;
  risk: PlinkoRisk;
  multiplier: number;
  payout: number;
  won: boolean;
  balance: number;
}

export type MinesOutcome = "cashed_out" | "hit_mine" | "cleared";

export interface MinesState {
  roundId: string;
  status: "active" | "complete";
  minesCount: number;
  bet: number;
  revealed: number[];
  mines: number[] | null;
  outcome?: MinesOutcome;
  multiplier: number;
  nextMultiplier: number | null;
  payout: number | null;
  balance: number;
}

export type CrashOutcome = "cashed_out" | "busted";

export interface CrashState {
  roundId: string;
  status: "active" | "complete";
  bet: number;
  startedAt: string;
  crashPoint: number | null;
  outcome?: CrashOutcome;
  payout: number | null;
  cashedOutAt: number | null;
  balance: number;
}
