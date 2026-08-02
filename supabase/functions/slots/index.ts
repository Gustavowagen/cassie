import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  spin,
  evaluateWin,
  evaluateFullBoardWin,
  payoutFor,
  payoutForFullBoard,
  roundMoney,
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

type RewardMode = "single_row" | "full_board";

// Unknown/missing settings, or any value other than "full_board", default
// to today's behavior — this is what keeps every pre-existing casino_games
// row (settings = '{}') playing exactly as before.
function resolveRewardMode(settings: unknown): RewardMode {
  if (
    settings &&
    typeof settings === "object" &&
    (settings as Record<string, unknown>).rewardMode === "full_board"
  ) {
    return "full_board";
  }
  return "single_row";
}

type DescribableWin = { symbol: string; count: number } | { count: number; wins: { symbol: string }[] };

function describeSpin(rewardMode: RewardMode, win: DescribableWin | null): string {
  if (!win) return "Slots: no win";
  if (rewardMode === "full_board") {
    const { count, wins } = win as { count: number; wins: { symbol: string }[] };
    const symbols = wins.map((w) => w.symbol).join("+");
    return `Slots: ${count}x ${symbols} (full board)`;
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

    const rewardMode = resolveRewardMode(cg.settings);
    const reels = spin(rng);

    let win: ReturnType<typeof evaluateWin> | ReturnType<typeof evaluateFullBoardWin>;
    let payout: number;
    if (rewardMode === "full_board") {
      win = evaluateFullBoardWin(reels);
      payout = payoutForFullBoard(win, validBet);
    } else {
      win = evaluateWin(reels);
      payout = payoutFor(win, validBet);
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

    return json({ reels, win, rewardMode, bet: validBet, payout, balance });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
