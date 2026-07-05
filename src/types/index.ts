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
