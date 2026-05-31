# Online Casino Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web platform where users can create and join free play-money online casinos with customizable settings, themes, and games.

**Architecture:** Vite + React + TypeScript frontend with Supabase for auth, database, and real-time. Casinos are isolated spaces with their own balance systems, game selections, and theming. Row-Level Security enforces data isolation per casino.

**Tech Stack:** Vite 5, React 18, TypeScript, Tailwind CSS, Zustand (state), React Router v6, Supabase JS v2, shadcn/ui

---

## File Structure

```
onlineCassie/
├── CLAUDE.md                          # Project docs for AI assistants
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── package.json
├── .env.local                         # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── supabase/
│   └── migrations/
│       ├── 001_profiles.sql
│       ├── 002_casinos.sql
│       ├── 003_casino_members.sql
│       ├── 004_games.sql
│       └── 005_transactions.sql
└── src/
    ├── main.tsx
    ├── App.tsx                        # Router setup
    ├── lib/
    │   ├── supabase.ts               # Supabase client singleton
    │   └── utils.ts                  # cn(), formatCurrency()
    ├── types/
    │   └── index.ts                  # All shared TypeScript types
    ├── stores/
    │   ├── authStore.ts              # User session state
    │   └── casinoStore.ts            # Current casino context
    ├── hooks/
    │   ├── useAuth.ts                # Auth helpers
    │   ├── useCasino.ts              # Casino CRUD
    │   └── useBalance.ts             # Member balance
    ├── components/
    │   ├── ui/                       # shadcn/ui primitives
    │   ├── Layout.tsx                # App shell with nav
    │   ├── AuthGuard.tsx             # Redirect if not logged in
    │   └── CasinoCard.tsx            # Casino listing card
    └── pages/
        ├── Home.tsx                  # Landing + casino list
        ├── Auth.tsx                  # Login / signup
        ├── CreateCasino.tsx          # Create casino form
        ├── CasinoDashboard.tsx       # Casino lobby (member view)
        ├── CasinoAdmin.tsx           # Owner settings panel
        └── NotFound.tsx
```

---

## Task 1: Vite + React + TypeScript scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`

- [ ] **Step 1: Scaffold the project**

```bash
cd C:\Users\bjorn\onlineCassie
npm create vite@latest . -- --template react-ts
```

Expected: Vite project files created (package.json, src/, index.html, etc.)

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js zustand react-router-dom
npm install -D tailwindcss postcss autoprefixer @types/node
npx tailwindcss init -p
```

- [ ] **Step 3: Install shadcn/ui**

```bash
npx shadcn@latest init
```
Choose: TypeScript yes, style Default, base color Slate, CSS variables yes, src/components/ui path.

- [ ] **Step 4: Add core shadcn components**

```bash
npx shadcn@latest add button input card badge label toast dialog
```

- [ ] **Step 5: Configure Tailwind**

Replace `tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 6: Create .env.local**

```env
VITE_SUPABASE_URL=https://tvivhadsgtvfvxwpahef.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2aXZoYWRzZ3R2ZnZ4d3BhaGVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNDA5NzcsImV4cCI6MjA5NTYxNjk3N30.g32Hk9lJ_bydJ4FeimiBrMBUIdhNazkituuv4inIWHI
```

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold vite+react+ts with supabase and shadcn"
```

---

## Task 2: Supabase schema — auth, profiles, casinos

**Files:**
- Create: `supabase/migrations/001_profiles.sql`
- Create: `supabase/migrations/002_casinos.sql`

- [ ] **Step 1: Write profiles migration**

`supabase/migrations/001_profiles.sql`:
```sql
-- Extends Supabase auth.users with display name and avatar
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Public profiles are viewable by everyone"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

- [ ] **Step 2: Apply profiles migration via MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with project_id `tvivhadsgtvfvxwpahef` and the SQL above.

- [ ] **Step 3: Write casinos migration**

`supabase/migrations/002_casinos.sql`:
```sql
create table public.casinos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text unique not null,
  description text,
  -- Theme settings stored as jsonb: { primaryColor, logoUrl, backgroundUrl }
  theme jsonb not null default '{"primaryColor":"#7c3aed","logoUrl":null,"backgroundUrl":null}'::jsonb,
  -- Casino settings: { startingBalance, allowPublicJoin, maxMembers }
  settings jsonb not null default '{"startingBalance":10000,"allowPublicJoin":true,"maxMembers":500}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

alter table public.casinos enable row level security;

create policy "Casinos are publicly viewable"
  on public.casinos for select using (true);

create policy "Authenticated users can create casinos"
  on public.casinos for insert with check (auth.uid() = owner_id);

create policy "Only owner can update casino"
  on public.casinos for update using (auth.uid() = owner_id);

create policy "Only owner can delete casino"
  on public.casinos for delete using (auth.uid() = owner_id);

-- Validate slug format (lowercase alphanumeric + hyphens)
alter table public.casinos
  add constraint casinos_slug_format check (slug ~ '^[a-z0-9-]+$');
```

- [ ] **Step 4: Apply casinos migration**

Use `mcp__claude_ai_Supabase__apply_migration` with the SQL above.

- [ ] **Step 5: Commit migrations**

```bash
git add supabase/
git commit -m "feat: add profiles and casinos schema with RLS"
```

---

## Task 3: Supabase schema — members, games, transactions

**Files:**
- Create: `supabase/migrations/003_casino_members.sql`
- Create: `supabase/migrations/004_games.sql`
- Create: `supabase/migrations/005_transactions.sql`

- [ ] **Step 1: Write casino_members migration**

`supabase/migrations/003_casino_members.sql`:
```sql
create table public.casino_members (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  balance bigint not null default 0, -- stored in cents/chips
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  unique(casino_id, user_id)
);

alter table public.casino_members enable row level security;

create policy "Members can view their own membership"
  on public.casino_members for select using (auth.uid() = user_id);

create policy "Casino members can view all members of same casino"
  on public.casino_members for select using (
    exists (
      select 1 from public.casino_members cm
      where cm.casino_id = casino_members.casino_id and cm.user_id = auth.uid()
    )
  );

create policy "Users can join casinos"
  on public.casino_members for insert with check (auth.uid() = user_id);

-- Function to join casino and set starting balance
create or replace function public.join_casino(p_casino_id uuid)
returns public.casino_members language plpgsql security definer as $$
declare
  v_starting_balance bigint;
  v_member public.casino_members;
begin
  select (settings->>'startingBalance')::bigint
  into v_starting_balance
  from public.casinos
  where id = p_casino_id and is_active = true;

  if not found then
    raise exception 'Casino not found or inactive';
  end if;

  insert into public.casino_members (casino_id, user_id, balance)
  values (p_casino_id, auth.uid(), v_starting_balance)
  returning * into v_member;

  return v_member;
end;
$$;
```

- [ ] **Step 2: Apply casino_members migration**

Use `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 3: Write games migration**

`supabase/migrations/004_games.sql`:
```sql
-- Catalogue of available game types
create table public.game_types (
  id text primary key, -- e.g. 'slots', 'blackjack', 'roulette'
  name text not null,
  description text,
  min_bet bigint not null default 100,
  max_bet bigint not null default 100000
);

insert into public.game_types (id, name, description, min_bet, max_bet) values
  ('slots', 'Slot Machine', 'Classic 3-reel slot machine', 100, 50000),
  ('blackjack', 'Blackjack', 'Beat the dealer to 21', 500, 100000),
  ('roulette', 'Roulette', 'European single-zero roulette', 100, 100000),
  ('crash', 'Crash', 'Cash out before the multiplier crashes', 100, 50000),
  ('dice', 'Dice Roll', 'Roll over or under a target number', 100, 50000);

-- Which games are enabled per casino
create table public.casino_games (
  casino_id uuid not null references public.casinos(id) on delete cascade,
  game_type_id text not null references public.game_types(id),
  is_active boolean not null default true,
  primary key (casino_id, game_type_id)
);

alter table public.casino_games enable row level security;
alter table public.game_types enable row level security;

create policy "Game types are public"
  on public.game_types for select using (true);

create policy "Casino games visible to all"
  on public.casino_games for select using (true);

create policy "Only casino owner can manage games"
  on public.casino_games for all using (
    exists (select 1 from public.casinos where id = casino_id and owner_id = auth.uid())
  );
```

- [ ] **Step 4: Apply games migration**

Use `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 5: Write transactions migration**

`supabase/migrations/005_transactions.sql`:
```sql
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  casino_id uuid not null references public.casinos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null, -- positive = win, negative = bet
  balance_after bigint not null,
  game_type_id text references public.game_types(id),
  description text,
  created_at timestamptz default now()
);

alter table public.transactions enable row level security;

create policy "Users can view own transactions"
  on public.transactions for select using (auth.uid() = user_id);

create policy "System can insert transactions"
  on public.transactions for insert with check (auth.uid() = user_id);
```

- [ ] **Step 6: Apply transactions migration**

Use `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 7: Commit**

```bash
git add supabase/
git commit -m "feat: add members, games, and transactions schema"
```

---

## Task 4: Supabase client + TypeScript types

**Files:**
- Create: `src/lib/supabase.ts`
- Create: `src/lib/utils.ts`
- Create: `src/types/index.ts`

- [ ] **Step 1: Write Supabase client**

`src/lib/supabase.ts`:
```ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
```

- [ ] **Step 2: Generate TypeScript types from Supabase**

Use `mcp__claude_ai_Supabase__generate_typescript_types` with project_id `tvivhadsgtvfvxwpahef`. Save output to `src/types/database.ts`.

- [ ] **Step 3: Write shared domain types**

`src/types/index.ts`:
```ts
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
```

- [ ] **Step 4: Write utils**

`src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatChips(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toString();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
```

- [ ] **Step 5: Install clsx + tailwind-merge (used by shadcn)**

```bash
npm install clsx tailwind-merge
```

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "feat: add supabase client, types, and utils"
```

---

## Task 5: Auth store + Zustand stores

**Files:**
- Create: `src/stores/authStore.ts`
- Create: `src/stores/casinoStore.ts`

- [ ] **Step 1: Write auth store**

`src/stores/authStore.ts`:
```ts
import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../types";

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  profile: null,
  loading: true,
  setSession: (session) =>
    set({ session, user: session?.user ?? null, loading: false }),
  setProfile: (profile) => set({ profile }),
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, profile: null });
  },
}));
```

- [ ] **Step 2: Write casino store**

`src/stores/casinoStore.ts`:
```ts
import { create } from "zustand";
import type { Casino, CasinoMember, GameType } from "../types";

interface CasinoState {
  currentCasino: Casino | null;
  membership: CasinoMember | null;
  enabledGames: GameType[];
  setCasino: (casino: Casino | null) => void;
  setMembership: (m: CasinoMember | null) => void;
  setEnabledGames: (games: GameType[]) => void;
}

export const useCasinoStore = create<CasinoState>((set) => ({
  currentCasino: null,
  membership: null,
  enabledGames: [],
  setCasino: (casino) => set({ currentCasino: casino }),
  setMembership: (membership) => set({ membership }),
  setEnabledGames: (enabledGames) => set({ enabledGames }),
}));
```

- [ ] **Step 3: Commit**

```bash
git add src/stores/
git commit -m "feat: add auth and casino zustand stores"
```

---

## Task 6: React hooks for auth, casino, balance

**Files:**
- Create: `src/hooks/useAuth.ts`
- Create: `src/hooks/useCasino.ts`
- Create: `src/hooks/useBalance.ts`

- [ ] **Step 1: Write useAuth hook**

`src/hooks/useAuth.ts`:
```ts
import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";

export function useAuthListener() {
  const { setSession, setProfile } = useAuthStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) fetchProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session?.user) fetchProfile(session.user.id);
        else setProfile(null);
      }
    );
    return () => subscription.unsubscribe();
  }, [setSession, setProfile]);

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    setProfile(data ?? null);
  }
}
```

- [ ] **Step 2: Write useCasino hook**

`src/hooks/useCasino.ts`:
```ts
import { supabase } from "../lib/supabase";
import type { Casino } from "../types";
import { slugify } from "../lib/utils";

export function useCasino() {
  async function createCasino(data: {
    name: string;
    description: string;
    startingBalance: number;
    allowPublicJoin: boolean;
  }): Promise<Casino> {
    const slug = slugify(data.name);
    const { data: casino, error } = await supabase
      .from("casinos")
      .insert({
        name: data.name,
        slug,
        description: data.description,
        settings: {
          startingBalance: data.startingBalance,
          allowPublicJoin: data.allowPublicJoin,
          maxMembers: 500,
        },
      })
      .select()
      .single();
    if (error) throw error;
    return casino as Casino;
  }

  async function joinCasino(casinoId: string) {
    const { data, error } = await supabase.rpc("join_casino", {
      p_casino_id: casinoId,
    });
    if (error) throw error;
    return data;
  }

  async function listCasinos(): Promise<Casino[]> {
    const { data, error } = await supabase
      .from("casinos")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Casino[];
  }

  async function getCasinoBySlug(slug: string): Promise<Casino | null> {
    const { data } = await supabase
      .from("casinos")
      .select("*")
      .eq("slug", slug)
      .single();
    return (data as Casino) ?? null;
  }

  return { createCasino, joinCasino, listCasinos, getCasinoBySlug };
}
```

- [ ] **Step 3: Write useBalance hook**

`src/hooks/useBalance.ts`:
```ts
import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";

export function useBalance(casinoId: string | undefined) {
  const { setMembership } = useCasinoStore();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!casinoId || !user) return;

    supabase
      .from("casino_members")
      .select("*")
      .eq("casino_id", casinoId)
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => setMembership(data ?? null));

    // Real-time balance updates
    const channel = supabase
      .channel(`balance-${casinoId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "casino_members",
          filter: `casino_id=eq.${casinoId}`,
        },
        (payload) => setMembership(payload.new as any)
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [casinoId, user, setMembership]);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/
git commit -m "feat: add auth, casino, and balance hooks"
```

---

## Task 7: App shell — routing, layout, auth guard

**Files:**
- Create: `src/App.tsx`
- Create: `src/components/Layout.tsx`
- Create: `src/components/AuthGuard.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Write Layout component**

`src/components/Layout.tsx`:
```tsx
import { Link, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { useAuthStore } from "../stores/authStore";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, signOut } = useAuthStore();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b px-6 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold">OnlineCassie</Link>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-muted-foreground">
                {profile?.username ?? user.email}
              </span>
              <Button variant="outline" size="sm" onClick={() => signOut().then(() => navigate("/"))}>
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => navigate("/auth")}>Sign in</Button>
          )}
        </div>
      </nav>
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write AuthGuard**

`src/components/AuthGuard.tsx`:
```tsx
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Write App.tsx with routes**

`src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthListener } from "./hooks/useAuth";
import { Layout } from "./components/Layout";
import { AuthGuard } from "./components/AuthGuard";
import { Home } from "./pages/Home";
import { Auth } from "./pages/Auth";
import { CreateCasino } from "./pages/CreateCasino";
import { CasinoDashboard } from "./pages/CasinoDashboard";
import { CasinoAdmin } from "./pages/CasinoAdmin";
import { NotFound } from "./pages/NotFound";

export default function App() {
  useAuthListener();

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/create" element={<AuthGuard><CreateCasino /></AuthGuard>} />
          <Route path="/casino/:slug" element={<CasinoDashboard />} />
          <Route path="/casino/:slug/admin" element={<AuthGuard><CasinoAdmin /></AuthGuard>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Update main.tsx**

`src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: add routing, layout, and auth guard"
```

---

## Task 8: Pages — Home, Auth, NotFound

**Files:**
- Create: `src/pages/Home.tsx`
- Create: `src/pages/Auth.tsx`
- Create: `src/pages/NotFound.tsx`
- Create: `src/components/CasinoCard.tsx`

- [ ] **Step 1: Write CasinoCard component**

`src/components/CasinoCard.tsx`:
```tsx
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { Casino } from "../types";

export function CasinoCard({ casino }: { casino: Casino }) {
  const navigate = useNavigate();
  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardHeader>
        <CardTitle>{casino.name}</CardTitle>
        <CardDescription>{casino.description ?? "No description"}</CardDescription>
      </CardHeader>
      <CardFooter className="flex justify-between items-center">
        <Badge variant="outline">
          {casino.settings.startingBalance.toLocaleString()} chips
        </Badge>
        <Button size="sm" onClick={() => navigate(`/casino/${casino.slug}`)}>
          Enter
        </Button>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 2: Write Home page**

`src/pages/Home.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { CasinoCard } from "../components/CasinoCard";
import { useCasino } from "../hooks/useCasino";
import { useAuthStore } from "../stores/authStore";
import type { Casino } from "../types";

export function Home() {
  const [casinos, setCasinos] = useState<Casino[]>([]);
  const [loading, setLoading] = useState(true);
  const { listCasinos } = useCasino();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    listCasinos().then(setCasinos).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Online Casinos</h1>
          <p className="text-muted-foreground mt-1">Join a free play-money casino or create your own</p>
        </div>
        {user && (
          <Button onClick={() => navigate("/create")}>Create Casino</Button>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading casinos...</p>
      ) : casinos.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground text-lg">No casinos yet.</p>
          {user && <Button className="mt-4" onClick={() => navigate("/create")}>Be the first!</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {casinos.map((c) => <CasinoCard key={c.id} casino={c} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write Auth page**

`src/pages/Auth.tsx`:
```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { supabase } from "../lib/supabase";

export function Auth() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      }
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <Card>
        <CardHeader>
          <CardTitle>{mode === "signin" ? "Sign In" : "Create Account"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "..." : mode === "signin" ? "Sign In" : "Sign Up"}
            </Button>
          </form>
          <p className="text-sm text-center mt-4 text-muted-foreground">
            {mode === "signin" ? "No account? " : "Have an account? "}
            <button className="underline" onClick={() => setMode(m => m === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? "Sign Up" : "Sign In"}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Write NotFound page**

`src/pages/NotFound.tsx`:
```tsx
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="text-center py-24">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <p className="mt-4 text-lg">Page not found</p>
      <Button className="mt-6" onClick={() => navigate("/")}>Go Home</Button>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: add home, auth, and 404 pages"
```

---

## Task 9: Casino creation + dashboard pages

**Files:**
- Create: `src/pages/CreateCasino.tsx`
- Create: `src/pages/CasinoDashboard.tsx`

- [ ] **Step 1: Write CreateCasino page**

`src/pages/CreateCasino.tsx`:
```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useCasino } from "../hooks/useCasino";

export function CreateCasino() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startingBalance, setStartingBalance] = useState(10000);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { createCasino } = useCasino();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const casino = await createCasino({ name, description, startingBalance, allowPublicJoin: true });
      navigate(`/casino/${casino.slug}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Your Casino</h1>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Casino Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={50} />
            </div>
            <div>
              <Label htmlFor="desc">Description</Label>
              <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
            </div>
            <div>
              <Label htmlFor="balance">Starting Chips per Player</Label>
              <Input
                id="balance"
                type="number"
                min={100}
                max={1000000}
                value={startingBalance}
                onChange={(e) => setStartingBalance(Number(e.target.value))}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating..." : "Create Casino"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Write CasinoDashboard page**

`src/pages/CasinoDashboard.tsx`:
```tsx
import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useCasino } from "../hooks/useCasino";
import { useBalance } from "../hooks/useBalance";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import { formatChips } from "../lib/utils";

export function CasinoDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getCasinoBySlug, joinCasino } = useCasino();
  const { currentCasino, membership, setCasino } = useCasinoStore();
  const { user } = useAuthStore();
  useBalance(currentCasino?.id);

  useEffect(() => {
    if (!slug) return;
    getCasinoBySlug(slug).then((c) => {
      if (!c) navigate("/");
      else setCasino(c);
    });
  }, [slug]);

  if (!currentCasino) return <div>Loading casino...</div>;

  const isOwner = user?.id === currentCasino.owner_id;

  async function handleJoin() {
    if (!currentCasino) return;
    try {
      await joinCasino(currentCasino.id);
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{currentCasino.name}</h1>
          <p className="text-muted-foreground">{currentCasino.description}</p>
        </div>
        <div className="flex items-center gap-3">
          {membership && (
            <Badge className="text-base px-3 py-1">
              {formatChips(membership.balance)} chips
            </Badge>
          )}
          {isOwner && (
            <Button variant="outline" onClick={() => navigate(`/casino/${slug}/admin`)}>
              Admin
            </Button>
          )}
        </div>
      </div>

      {!membership && user && (
        <div className="text-center py-12">
          <p className="mb-4">You haven't joined this casino yet.</p>
          <Button onClick={handleJoin}>
            Join Casino ({currentCasino.settings.startingBalance.toLocaleString()} starting chips)
          </Button>
        </div>
      )}

      {!user && (
        <div className="text-center py-12">
          <p className="mb-4">Sign in to join and play.</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      )}

      {membership && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <p className="col-span-full text-muted-foreground">Games coming soon...</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/
git commit -m "feat: add casino creation and dashboard pages"
```

---

## Task 10: Casino admin panel (owner settings)

**Files:**
- Create: `src/pages/CasinoAdmin.tsx`

- [ ] **Step 1: Write CasinoAdmin page**

`src/pages/CasinoAdmin.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { supabase } from "../lib/supabase";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import { useCasino } from "../hooks/useCasino";
import type { GameType } from "../types";

export function CasinoAdmin() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getCasinoBySlug } = useCasino();
  const { currentCasino, setCasino } = useCasinoStore();
  const { user } = useAuthStore();
  const [allGames, setAllGames] = useState<GameType[]>([]);
  const [enabledGameIds, setEnabledGameIds] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#7c3aed");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    getCasinoBySlug(slug).then((c) => {
      if (!c || c.owner_id !== user?.id) { navigate("/"); return; }
      setCasino(c);
      setDescription(c.description ?? "");
      setPrimaryColor(c.theme.primaryColor);
    });
    supabase.from("game_types").select("*").then(({ data }) => setAllGames((data ?? []) as GameType[]));
    supabase.from("casino_games").select("game_type_id").eq("casino_id", currentCasino?.id ?? "").then(({ data }) => {
      setEnabledGameIds(new Set(data?.map((g) => g.game_type_id) ?? []));
    });
  }, [slug, user]);

  function toggleGame(gameId: string) {
    setEnabledGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId); else next.add(gameId);
      return next;
    });
  }

  async function handleSave() {
    if (!currentCasino) return;
    setSaving(true);
    setMessage(null);
    try {
      // Update casino settings
      await supabase.from("casinos").update({
        description,
        theme: { ...currentCasino.theme, primaryColor },
      }).eq("id", currentCasino.id);

      // Sync enabled games: delete all, re-insert enabled
      await supabase.from("casino_games").delete().eq("casino_id", currentCasino.id);
      if (enabledGameIds.size > 0) {
        await supabase.from("casino_games").insert(
          [...enabledGameIds].map((id) => ({ casino_id: currentCasino.id, game_type_id: id }))
        );
      }
      setMessage("Saved!");
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!currentCasino) return <div>Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin — {currentCasino.name}</h1>
        <Button variant="outline" onClick={() => navigate(`/casino/${slug}`)}>Back to Casino</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Casino Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label>Primary Color</Label>
            <div className="flex items-center gap-3">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-16 cursor-pointer rounded border" />
              <span className="text-sm text-muted-foreground">{primaryColor}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Enabled Games</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {allGames.map((game) => (
              <Badge
                key={game.id}
                variant={enabledGameIds.has(game.id) ? "default" : "outline"}
                className="cursor-pointer text-sm py-1 px-3"
                onClick={() => toggleGame(game.id)}
              >
                {game.name}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {message && <p className="text-sm text-center text-muted-foreground">{message}</p>}
      <Button className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/CasinoAdmin.tsx
git commit -m "feat: add casino admin panel with game toggles and theme settings"
```

---

## Task 11: CLAUDE.md and final setup

**Files:**
- Create: `CLAUDE.md`
- Create: `.gitignore`

- [ ] **Step 1: Write CLAUDE.md**

`CLAUDE.md`:
```markdown
# OnlineCassie

Platform for creating and joining free play-money online casinos. Built with Vite + React + TypeScript + Supabase.

## Dev Commands

- `npm run dev` — start dev server (localhost:5173)
- `npm run build` — production build
- `npm run preview` — preview production build

## Supabase

- Project: jackpot-jungle (`tvivhadsgtvfvxwpahef`)
- Region: eu-west-1
- URL: https://tvivhadsgtvfvxwpahef.supabase.co
- Migrations are in `supabase/migrations/` (apply via Supabase MCP or CLI)

## Architecture

- Auth: Supabase Auth (email/password). Profile auto-created on signup via trigger.
- State: Zustand stores in `src/stores/` (authStore, casinoStore)
- Routing: React Router v6, routes defined in `src/App.tsx`
- DB access: via `src/lib/supabase.ts` singleton + hooks in `src/hooks/`
- Chips/balance stored as integers (whole units, not cents)
- Casino settings and theme stored as jsonb columns

## Key Concepts

- **Casino slug**: URL-safe identifier derived from casino name, used in routes like `/casino/:slug`
- **join_casino RPC**: Use `supabase.rpc('join_casino', { p_casino_id })` to join and get starting balance
- **RLS**: Every table has Row Level Security. Users can only read/write their own data.

## Adding Games

1. Add game type to `game_types` table (migration or direct insert)
2. Create a game component in `src/components/games/`
3. Wire it up in `CasinoDashboard.tsx` based on `enabledGames` from `casinoStore`
```

- [ ] **Step 2: Write .gitignore**

`.gitignore`:
```
node_modules/
dist/
.env.local
.env.*.local
*.log
.DS_Store
```

- [ ] **Step 3: Final commit**

```bash
git add CLAUDE.md .gitignore
git commit -m "chore: add CLAUDE.md and gitignore"
```

- [ ] **Step 4: Verify dev server starts**

```bash
npm run dev
```
Expected: Vite dev server starts at http://localhost:5173 with no errors.

---

## Self-Review

**Spec coverage:**
- [x] Any user can create their own online casino for free — Task 9 CreateCasino page + Task 2 casinos table
- [x] Any user can join created casinos for free — Task 3 join_casino RPC + Task 9 CasinoDashboard join button
- [x] Casino owner controls settings — Task 10 CasinoAdmin with description, theme color, game toggles
- [x] Custom design (theme color) — CasinoAdmin primaryColor picker + theme jsonb
- [x] Games based on a list of selections — game_types table + casino_games toggle in CasinoAdmin
- [x] Vite + React frontend — Task 1
- [x] Supabase database — Tasks 2–3
- [x] CLAUDE.md — Task 11

**Gaps identified:** None — all spec requirements covered. Game implementations (slots, blackjack, etc.) are intentionally deferred as future tasks (out of scope for framework setup).
