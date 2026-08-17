import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  playRound,
  payoutFor,
  roundMoney,
  HOUSE_EDGE_OPTIONS,
  DEFAULT_HOUSE_EDGE,
  type TumbleRound,
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

// Missing/off-menu settings fall back to DEFAULT_HOUSE_EDGE — which is what
// every freshly enabled casino_games row (settings = '{}') gets. This is also
// the authoritative gate on the 1-5% menu: even if the admin UI's dropdown
// were bypassed, an out-of-range edge is coerced rather than trusted. Float
// tolerant because `raw` round-trips through JSON.
function resolveHouseEdge(settings: unknown): number {
  const raw =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>).houseEdge : undefined;
  if (typeof raw === "number" && HOUSE_EDGE_OPTIONS.some((o) => Math.abs(o - raw) < 1e-9)) {
    return raw;
  }
  return DEFAULT_HOUSE_EDGE;
}

function describeRound(round: TumbleRound): string {
  if (round.steps.length === 0) return "Tumble: no win";
  const symbols = round.steps
    .flatMap((s) => s.wins)
    .map((w) => `${w.count}x ${w.symbol}`)
    .join("+");
  const tumbles = round.steps.length > 1 ? `, ${round.steps.length} tumbles` : "";
  const mult = round.multiplier > 1 ? `, x${round.multiplier}` : "";
  return `Tumble: ${symbols}${tumbles}${mult}`;
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

    // Membership/balance and bet limits don't depend on each other.
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
        .eq("game_type_id", "tumble")
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

    const houseEdge = resolveHouseEdge(cg.settings);
    // The whole cascade resolves here, so bet and payout settle in one atomic
    // update — the client only replays the steps as an animation.
    const round = playRound(rng, houseEdge);
    const payout = payoutFor(round, validBet);
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
        game_type_id: "tumble",
        description: describeRound(round),
      }),
    ]);

    return json({ round, bet: validBet, payout, balance });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
