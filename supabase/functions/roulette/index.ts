import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calcPayout, numColor, numLabel, roundMoney, totalBet, validateBets } from "./engine.ts";

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
    if (body.action !== "spin") return json({ error: "Unknown action" }, 400);

    const { casino_id, casino_game_id } = body as { casino_id: string; casino_game_id: string };
    if (typeof casino_id !== "string" || !casino_id) {
      return json({ error: "Invalid casino_id" }, 400);
    }

    let bets;
    try {
      bets = validateBets(body.bets);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }

    const total = totalBet(bets);
    if (total <= 0) return json({ error: "No bets placed" }, 400);

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
        .select("min_bet, max_bet")
        .eq("id", casino_game_id)
        .eq("casino_id", casino_id)
        .eq("game_type_id", "roulette")
        .single(),
    ]);
    if (!member) return json({ error: "You are not a member of this casino" }, 403);
    if (!cg) return json({ error: "Game not found" }, 400);
    if (total < Number(cg.min_bet) || total > Number(cg.max_bet)) {
      return json({ error: `Total bet must be between ${cg.min_bet} and ${cg.max_bet}` }, 400);
    }
    if (total > member.balance) return json({ error: "Insufficient balance" }, 400);

    const result = Math.floor(rng() * 38);
    const winAmount = roundMoney(calcPayout(result, bets));
    const net = roundMoney(winAmount - total);
    const balance = roundMoney(member.balance + net);

    await Promise.all([
      admin.from("casino_members").update({ balance })
        .eq("casino_id", casino_id).eq("user_id", user.id),
      admin.from("transactions").insert({
        casino_id, user_id: user.id, amount: net, balance_after: balance,
        game_type_id: "roulette", description: `Roulette: ${numLabel(result)} (${numColor(result)})`,
      }),
    ]);

    return json({ result, payout: winAmount, balance });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
