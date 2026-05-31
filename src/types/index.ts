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
  description: string | null;
  theme: CasinoTheme;
  settings: CasinoSettings;
  is_active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface CasinoMember {
  id: string;
  casino_id: string;
  user_id: string;
  balance: number;
  role: "owner" | "member";
  joined_at: string;
}

export interface GameType {
  id: string;
  name: string;
  description: string | null;
  min_bet: number;
  max_bet: number;
}
