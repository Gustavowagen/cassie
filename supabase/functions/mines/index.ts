import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startRound,
  revealTile,
  cashOut,
  sanitize,
  roundMoney,
  MIN_MINES,
  MAX_MINES,
  type RoundState,
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

    if (body.action === "start") {
      const { casino_id, bet, mines_count } = body as {
        casino_id: string;
        bet: number;
        mines_count: number;
      };

      if (!Number.isInteger(mines_count) || mines_count < MIN_MINES || mines_count > MAX_MINES) {
        return json({ error: `Mines must be between ${MIN_MINES} and ${MAX_MINES}` }, 400);
      }

      // Membership/balance and bet limits don't depend on each other — fetch both at once.
      const [{ data: member }, { data: gt }] = await Promise.all([
        userClient
          .from("casino_members")
          .select("balance")
          .eq("casino_id", casino_id)
          .eq("user_id", user.id)
          .single(),
        admin.from("game_types").select("min_bet, max_bet").eq("id", "mines").single(),
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

      // One active round at a time.
      await admin
        .from("mines_rounds")
        .delete()
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .neq("status", "complete");

      const state = startRound({ bet: validBet, minesCount: mines_count, rng });
      const balance = roundMoney(member.balance - validBet);

      const [{ data: round }] = await Promise.all([
        admin
          .from("mines_rounds")
          .insert({ casino_id, user_id: user.id, state, status: state.status })
          .select("id")
          .single(),
        admin.from("casino_members").update({ balance }).eq("casino_id", casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id,
          user_id: user.id,
          amount: -validBet,
          balance_after: balance,
          game_type_id: "mines",
          description: `Mines bet (${mines_count} mines)`,
        }),
      ]);

      return json(sanitize(state, round!.id, balance));
    }

    if (body.action === "reveal") {
      const { round_id, tile } = body as { round_id: string; tile: number };

      const { data: round } = await admin
        .from("mines_rounds")
        .select("*")
        .eq("id", round_id)
        .eq("user_id", user.id)
        .single();
      if (!round) return json({ error: "Round not found" }, 404);
      if (round.status === "complete") return json({ error: "Round already finished" }, 400);

      const prev = round.state as RoundState;
      let next: RoundState;
      try {
        next = revealTile(prev, tile);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }

      const writes: Promise<unknown>[] = [
        admin
          .from("mines_rounds")
          .update({ state: next, status: next.status, updated_at: new Date().toISOString() })
          .eq("id", round_id),
      ];

      const { data: member } = await admin
        .from("casino_members")
        .select("balance")
        .eq("casino_id", round.casino_id)
        .eq("user_id", user.id)
        .single();

      let balance = member!.balance;
      if (next.status === "complete") {
        balance = roundMoney(member!.balance + (next.payout ?? 0));
        writes.push(
          admin.from("casino_members").update({ balance }).eq("casino_id", round.casino_id).eq("user_id", user.id),
          admin.from("transactions").insert({
            casino_id: round.casino_id,
            user_id: user.id,
            amount: next.payout ?? 0,
            balance_after: balance,
            game_type_id: "mines",
            description: next.outcome === "hit_mine" ? "Mines: hit a mine" : "Mines: cleared the board",
          })
        );
      }

      await Promise.all(writes);
      return json(sanitize(next, round_id, balance));
    }

    if (body.action === "cashout") {
      const { round_id } = body as { round_id: string };

      const { data: round } = await admin
        .from("mines_rounds")
        .select("*")
        .eq("id", round_id)
        .eq("user_id", user.id)
        .single();
      if (!round) return json({ error: "Round not found" }, 404);
      if (round.status === "complete") return json({ error: "Round already finished" }, 400);

      const prev = round.state as RoundState;
      let next: RoundState;
      try {
        next = cashOut(prev);
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
          .from("mines_rounds")
          .update({ state: next, status: next.status, updated_at: new Date().toISOString() })
          .eq("id", round_id),
        admin.from("casino_members").update({ balance }).eq("casino_id", round.casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id: round.casino_id,
          user_id: user.id,
          amount: next.payout ?? 0,
          balance_after: balance,
          game_type_id: "mines",
          description: "Mines: cashed out",
        }),
      ]);

      return json(sanitize(next, round_id, balance));
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
