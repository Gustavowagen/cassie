import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dropPath, bucketFor, multiplierFor, isRisk, roundMoney, ROWS } from "./engine.ts";

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
    const { casino_id, casino_game_id, bet, risk } = body as {
      casino_id: string;
      casino_game_id: string;
      bet: number;
      risk: unknown;
    };

    if (!isRisk(risk)) return json({ error: "Invalid risk" }, 400);
    if (typeof bet !== "number" || !isFinite(bet) || bet <= 0) {
      return json({ error: "Invalid bet" }, 400);
    }

    const { data: cg } = await admin
      .from("casino_games")
      .select("min_bet, max_bet")
      .eq("id", casino_game_id)
      .eq("casino_id", casino_id)
      .eq("game_type_id", "plinko")
      .single();
    if (!cg) return json({ error: "Game not found" }, 400);
    const validBet = roundMoney(bet);
    if (validBet < Number(cg.min_bet) || validBet > Number(cg.max_bet)) {
      return json({ error: `Bet must be between ${cg.min_bet} and ${cg.max_bet}` }, 400);
    }

    const path = dropPath(rng);
    const bucket = bucketFor(path);
    const multiplier = multiplierFor(risk, bucket);
    const payout = roundMoney(validBet * multiplier);
    const net = roundMoney(payout - validBet);

    // The client can drop several balls at once, which fires this function
    // concurrently for the same player. record_game_result locks the member
    // row (SELECT ... FOR UPDATE) before applying `net`, so Postgres queues
    // concurrent calls and each one sees the previous drop's committed
    // balance instead of racing on a stale read-then-write — no lost updates,
    // no overdraft, regardless of how many balls land at the same instant.
    const { data: balance, error: rpcError } = await userClient.rpc("record_game_result", {
      p_casino_id: casino_id,
      p_game_type_id: "plinko",
      p_net_amount: net,
      p_description: `Plinko: ${risk} risk, ${ROWS} rows, landed ${multiplier}x`,
    });
    if (rpcError) {
      const status = /insufficient/i.test(rpcError.message) ? 400 : /member/i.test(rpcError.message) ? 403 : 500;
      return json({ error: rpcError.message }, status);
    }

    // `path` drives the client's drop animation, so the ball is seen to land in
    // the bucket the server already picked.
    return json({ path, bucket, risk, multiplier, payout, won: payout > validBet, balance });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
