import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  startRound,
  applyMove,
  sanitize,
  buildShoe,
  shuffle,
  roundMoney,
  type RoundState,
  type Move,
} from "./engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Let the browser cache the preflight so it isn't repeated before every action.
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

// Total chips the player paid in for a round (for transaction accounting).
function totalStaked(state: RoundState): number {
  return state.hands.reduce((sum, h) => sum + h.bet, 0) + state.insuranceBet;
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

    if (body.action === "start") {
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
          .select("min_bet, max_bet")
          .eq("id", casino_game_id)
          .eq("casino_id", casino_id)
          .eq("game_type_id", "blackjack")
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

      // One active round at a time.
      await admin
        .from("blackjack_rounds")
        .delete()
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .neq("status", "complete");

      const state = startRound({ shoe: shuffle(buildShoe(), rng), bet: validBet });

      // Deduct the stake now; credit any immediate (blackjack/peek) payout.
      let balance = roundMoney(member.balance - validBet);
      if (state.status === "complete") {
        const credited = state.hands.reduce((s, h) => s + (h.payout ?? 0), 0) + state.insurancePayout;
        balance = roundMoney(balance + credited);
      }

      // Persisting the round and applying the balance/transaction side effects
      // are independent writes — run them together instead of one-by-one.
      const writes: Promise<unknown>[] = [
        admin.from("casino_members").update({ balance })
          .eq("casino_id", casino_id).eq("user_id", user.id),
        admin.from("transactions").insert({
          casino_id, user_id: user.id, amount: -validBet, balance_after: roundMoney(member.balance - validBet),
          game_type_id: "blackjack", description: "Blackjack bet",
        }),
      ];
      if (state.status === "complete") {
        writes.push(
          admin.from("transactions").insert({
            casino_id, user_id: user.id,
            amount: roundMoney(balance - (member.balance - validBet)), balance_after: balance,
            game_type_id: "blackjack", description: "Blackjack payout",
          })
        );
      }

      const [{ data: round }] = await Promise.all([
        admin
          .from("blackjack_rounds")
          .insert({ casino_id, user_id: user.id, state, status: state.status })
          .select("id")
          .single(),
        ...writes,
      ]);

      return json(sanitize(state, round!.id, balance));
    }

    if (body.action === "action") {
      const { round_id, move } = body as { round_id: string; move: Move };

      const { data: round } = await admin
        .from("blackjack_rounds")
        .select("*")
        .eq("id", round_id)
        .eq("user_id", user.id)
        .single();
      if (!round) return json({ error: "Round not found" }, 404);
      if (round.status === "complete") return json({ error: "Round already finished" }, 400);

      const prev = round.state as RoundState;
      const stakedBefore = totalStaked(prev);

      let next: RoundState;
      try {
        next = applyMove(prev, move);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }

      // Additional stake required by double/split/insurance.
      const extraStake = totalStaked(next) - stakedBefore;

      const { data: member } = await admin
        .from("casino_members").select("balance")
        .eq("casino_id", round.casino_id).eq("user_id", user.id).single();
      if (extraStake > member!.balance) {
        return json({ error: "Insufficient balance for that move" }, 400);
      }

      let balance = member!.balance - extraStake;
      let credited = 0;
      if (next.status === "complete") {
        credited = next.hands.reduce((s, h) => s + (h.payout ?? 0), 0) + next.insurancePayout;
        balance += credited;
      }

      // The round state always needs persisting. A plain hit/stand never
      // touches the balance, so only queue the money writes when something
      // actually changed, and fire everything in parallel.
      const writes: Promise<unknown>[] = [
        admin.from("blackjack_rounds")
          .update({ state: next, status: next.status, updated_at: new Date().toISOString() })
          .eq("id", round_id),
      ];
      if (balance !== member!.balance) {
        writes.push(
          admin.from("casino_members").update({ balance })
            .eq("casino_id", round.casino_id).eq("user_id", user.id)
        );
      }
      if (extraStake > 0) {
        writes.push(
          admin.from("transactions").insert({
            casino_id: round.casino_id, user_id: user.id,
            amount: -extraStake, balance_after: balance,
            game_type_id: "blackjack", description: `Blackjack ${move}`,
          })
        );
      }
      if (next.status === "complete") {
        writes.push(
          admin.from("transactions").insert({
            casino_id: round.casino_id, user_id: user.id,
            amount: credited, balance_after: balance,
            game_type_id: "blackjack", description: "Blackjack payout",
          })
        );
      }

      await Promise.all(writes);

      return json(sanitize(next, round_id, balance));
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
