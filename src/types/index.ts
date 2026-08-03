export interface CasinoTheme {
  primaryColor: string;
  logoUrl: string | null;
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
  role: "member" | "admin";
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
  role: "member" | "admin";
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

export interface SlotReel {
  top: SlotSymbolId;
  mid: SlotSymbolId;
  bottom: SlotSymbolId;
}

export interface SlotWin {
  symbol: SlotSymbolId;
  count: 3 | 4 | 5;
  // Reel indices (0-based) holding the winning symbol — not necessarily
  // contiguous or left-aligned, since matches are scatter-style.
  positions: number[];
}

// Full-board mode win: count spans all 3 rows (7-15), so positions need a
// row alongside the reel index — kept as a separate type from SlotWin
// rather than unifying, so single-row's shape stays untouched. `wins` holds
// every symbol that reached the max count — normally length 1, occasionally
// 2 when two symbols tie (e.g. 7 dots + 7 squares); both pay and both light
// up when that happens.
export interface FullBoardSlotWin {
  count: number;
  wins: { symbol: SlotSymbolId; positions: { reel: number; row: "top" | "mid" | "bottom" }[] }[];
}

// Mirror of the edge function's response (supabase/functions/slots/engine.ts).
export interface SlotsResult {
  reels: SlotReel[];
  win: SlotWin | FullBoardSlotWin | null;
  rewardMode: "single_row" | "full_board";
  bet: number;
  payout: number;
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
