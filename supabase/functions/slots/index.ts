import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { spin, evaluateWin, payoutFor, roundMoney } from "./engine.ts";

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

function describeSpin(win: ReturnType<typeof evaluateWin>): string {
  if (!win) return "Slots: no win";
  return `Slots: ${win.count}x ${win.symbol}`;
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
    const { casino_id, bet } = body as { casino_id: string; bet: number };

    // Membership/balance and bet limits don't depend on each other — fetch both at once.
    const [{ data: member }, { data: gt }] = await Promise.all([
      userClient
        .from("casino_members")
        .select("balance")
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .single(),
      admin.from("game_types").select("min_bet, max_bet").eq("id", "slots").single(),
    ]);
    if (!member) return json({ error: "You are not a member of this casino" }, 403);
    if (typeof bet !== "number" || !isFinite(bet) || bet <= 0) {
      return json({ error: "Invalid bet" }, 400);
    }
    const validBet = roundMoney(bet);
    if (validBet < Number(gt!.min_bet) || validBet > Number(gt!.max_bet)) {
      return json({ error: `Bet must be between ${gt!.min_bet} and ${gt!.max_bet}` }, 400);
    }
    if (validBet > member.balance) return json({ error: "Insufficient balance" }, 400);

    const reels = spin(rng);
    const win = evaluateWin(reels);
    const payout = payoutFor(win, validBet);
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
        description: describeSpin(win),
      }),
    ]);

    return json({ reels, win, bet: validBet, payout, balance });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
