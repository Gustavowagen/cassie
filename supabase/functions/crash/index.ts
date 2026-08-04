import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startRound, resolveCashout, sanitize, roundMoney, type CrashRoundState } from "./engine.ts";

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

    if (body.action === "start") {
      const { casino_id, casino_game_id, bet } = body as {
        casino_id: string;
        casino_game_id: string;
        bet: number;
      };

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
          .eq("game_type_id", "crash")
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

      // One active round at a time — clean up any abandoned round first.
      await admin
        .from("crash_rounds")
        .delete()
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .neq("status", "complete");

      const state = startRound({ bet: validBet, startedAt: new Date().toISOString(), rng });
      const balance = roundMoney(member.balance - validBet);

      const [{ data: round }] = await Promise.all([
        admin
          .from("crash_rounds")
          .insert({ casino_id, user_id: user.id, state, status: state.status })
          .select("id")
          .single(),
        admin.from("casino_members").update({ balance }).eq("casino_id", casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id,
          user_id: user.id,
          amount: -validBet,
          balance_after: balance,
          game_type_id: "crash",
          description: "Crash bet placed",
        }),
      ]);

      return json(sanitize(state, round!.id, balance));
    }

    if (body.action === "cashout") {
      const { round_id } = body as { round_id: string };

      const { data: round } = await admin
        .from("crash_rounds")
        .select("*")
        .eq("id", round_id)
        .eq("user_id", user.id)
        .single();
      if (!round) return json({ error: "Round not found" }, 404);
      if (round.status === "complete") return json({ error: "Round already finished" }, 400);

      const prev = round.state as CrashRoundState;
      let next: CrashRoundState;
      try {
        next = resolveCashout(prev, Date.now());
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }

      const { data: member } = await admin
        .from("casino_members")
        .select("balance")
        .eq("casino_id", round.casino_id)
        .eq("user_id", user.id)
        .single();
      const balance = roundMoney(member!.balance + (next.payout ?? 0));

      await Promise.all([
        admin
          .from("crash_rounds")
          .update({ state: next, status: next.status, updated_at: new Date().toISOString() })
          .eq("id", round_id),
        admin.from("casino_members").update({ balance }).eq("casino_id", round.casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id: round.casino_id,
          user_id: user.id,
          amount: next.payout ?? 0,
          balance_after: balance,
          game_type_id: "crash",
          description: next.outcome === "busted" ? "Crash: busted" : "Crash: cashed out",
        }),
      ]);

      return json(sanitize(next, round_id, balance));
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
