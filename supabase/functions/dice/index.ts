import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  rollValue,
  winChanceFor,
  multiplierFor,
  isWin,
  roundMoney,
  MIN_WIN_CHANCE,
  MAX_WIN_CHANCE,
  type Direction,
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
    const { casino_id, bet, target, direction } = body as {
      casino_id: string;
      bet: number;
      target: number;
      direction: Direction;
    };

    if (direction !== "under" && direction !== "over") {
      return json({ error: "Invalid direction" }, 400);
    }
    if (typeof target !== "number" || !isFinite(target)) {
      return json({ error: "Invalid target" }, 400);
    }

    const winChance = winChanceFor(target, direction);
    if (winChance < MIN_WIN_CHANCE || winChance > MAX_WIN_CHANCE) {
      return json(
        { error: `Win chance must be between ${MIN_WIN_CHANCE}% and ${MAX_WIN_CHANCE}%` },
        400
      );
    }

    // Membership/balance and bet limits don't depend on each other — fetch both at once.
    const [{ data: member }, { data: gt }] = await Promise.all([
      userClient
        .from("casino_members")
        .select("balance")
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .single(),
      admin.from("game_types").select("min_bet, max_bet").eq("id", "dice").single(),
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

    const multiplier = multiplierFor(winChance);
    const roll = rollValue(rng);
    const won = isWin(roll, target, direction);
    const payout = won ? roundMoney(validBet * multiplier) : 0;
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
        game_type_id: "dice",
        description: `Dice: rolled ${roll.toFixed(2)}, needed ${direction} ${target.toFixed(2)}`,
      }),
    ]);

    return json({ roll, target, direction, winChance, multiplier, won, payout, balance });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
