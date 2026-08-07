import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  spin,
  evaluateWin,
  evaluateFullBoardWin,
  payoutFor,
  payoutForFullBoard,
  roundMoney,
  HOUSE_EDGE_OPTIONS,
  DEFAULT_HOUSE_EDGE,
  BOARD_SIZES,
  DEFAULT_BOARD_SIZE,
  ALLOWED_REWARD_MODES,
  type BoardSize,
  type RewardMode,
} from "./engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

// Unknown/missing settings, or any value not in BOARD_SIZES, default to
// DEFAULT_BOARD_SIZE ("5x3") — this is what keeps every pre-existing
// casino_games row (settings = '{}') playing exactly as before.
function resolveBoardSize(settings: unknown): BoardSize {
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).boardSize : undefined;
  if (typeof raw === "string" && (BOARD_SIZES as string[]).includes(raw)) {
    return raw as BoardSize;
  }
  return DEFAULT_BOARD_SIZE;
}

// Authoritative gate: even if the admin UI's disabled state were bypassed
// (or a stored settings blob predates a later change to ALLOWED_REWARD_MODES),
// a disallowed rewardMode for the resolved boardSize is coerced to that
// size's first allowed mode rather than trusted. For every board size
// that allows both modes, that first-allowed value is "single_row",
// matching today's existing default.
function resolveRewardMode(settings: unknown, boardSize: BoardSize): RewardMode {
  const allowed = ALLOWED_REWARD_MODES[boardSize];
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).rewardMode : undefined;
  if ((raw === "single_row" || raw === "full_board") && allowed.includes(raw)) {
    return raw;
  }
  return allowed[0];
}

// Unknown/missing/off-menu settings default to DEFAULT_HOUSE_EDGE (2%) —
// this is what every pre-existing casino_games row (settings = '{}') gets,
// and it doubles as server-side enforcement of the fixed 0-5% menu in case
// the admin UI's dropdown were ever bypassed. Float-tolerant equality since
// `raw` round-trips through JSON.
function resolveHouseEdge(settings: unknown): number {
  const raw =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).houseEdge
      : undefined;
  if (typeof raw === "number" && HOUSE_EDGE_OPTIONS.some((o) => Math.abs(o - raw) < 1e-9)) {
    return raw;
  }
  return DEFAULT_HOUSE_EDGE;
}

type DescribableWin = { symbol: string; count: number } | { wins: { symbol: string; count: number }[] };

function describeSpin(rewardMode: RewardMode, win: DescribableWin | null): string {
  if (!win) return "Slots: no win";
  if (rewardMode === "full_board") {
    const { wins } = win as { wins: { symbol: string; count: number }[] };
    const parts = wins.map((w) => `${w.count}x ${w.symbol}`).join("+");
    return `Slots: ${parts} (full board)`;
  }
  const { symbol, count } = win as { symbol: string; count: number };
  return `Slots: ${count}x ${symbol} (row)`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: auth } = await userClient.auth.getUser();
    const user = auth.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json();
    const { casino_id, casino_game_id, bet } = body as {
      casino_id: string;
      casino_game_id: string;
      bet: number;
    };

    // Membership/balance and bet limits don't depend on each other — fetch both at once.
    const [{ data: member }, { data: cg }] = await Promise.all([
      userClient
        .from("casino_members")
        .select("balance")
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .single(),
      admin
        .from("casino_games")
        .select("min_bet, max_bet, settings")
        .eq("id", casino_game_id)
        .eq("casino_id", casino_id)
        .eq("game_type_id", "slots")
        .single(),
    ]);
    if (!member) return json({ error: "You are not a member of this casino" }, 403);
    if (!cg) return json({ error: "Game not found" }, 400);
    if (typeof bet !== "number" || !isFinite(bet) || bet <= 0) {
      return json({ error: "Invalid bet" }, 400);
    }
    const validBet = roundMoney(bet);
    if (validBet < Number(cg.min_bet) || validBet > Number(cg.max_bet)) {
      return json({ error: `Bet must be between ${cg.min_bet} and ${cg.max_bet}` }, 400);
    }
    if (validBet > member.balance) return json({ error: "Insufficient balance" }, 400);

    const boardSize = resolveBoardSize(cg.settings);
    const rewardMode = resolveRewardMode(cg.settings, boardSize);
    const houseEdge = resolveHouseEdge(cg.settings);
    const reels = spin(rng, boardSize);

    let win: ReturnType<typeof evaluateWin> | ReturnType<typeof evaluateFullBoardWin>;
    let payout: number;
    if (rewardMode === "full_board") {
      win = evaluateFullBoardWin(reels, boardSize);
      payout = payoutForFullBoard(win, validBet, boardSize, houseEdge);
    } else {
      win = evaluateWin(reels, boardSize);
      payout = payoutFor(win, validBet, boardSize, houseEdge);
    }
    const net = roundMoney(payout - validBet);
    const balance = roundMoney(member.balance + net);

    await Promise.all([
      admin
        .from("casino_members")
        .update({ balance })
        .eq("casino_id", casino_id)
        .eq("user_id", user.id),
      admin.from("transactions").insert({
        casino_id,
        user_id: user.id,
        amount: net,
        balance_after: balance,
        game_type_id: "slots",
        description: describeSpin(rewardMode, win),
      }),
    ]);

    return json({ reels, win, rewardMode, boardSize, bet: validBet, payout, balance });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
