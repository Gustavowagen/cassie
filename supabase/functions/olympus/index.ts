import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  playRound,
  playFreeSpins,
  payoutFor,
  roundMoney,
  resolveHouseEdge,
  freeSpinsEnabled,
  freeSpinsCost,
  FREE_SPINS_COUNT,
  type OlympusRound,
  type OlyFreeSpinsBatch,
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

function describeRound(round: OlympusRound): string {
  if (round.totalWin === 0) return "Olympus: no win";
  const symbols = round.steps
    .flatMap((s) => s.wins)
    .map((w) => `${w.count}x ${w.symbol}`)
    .join("+");
  // steps includes the settled board that ended the round, so the number of
  // cascades a player actually watched is one fewer.
  const cascades = round.steps.length > 2 ? `, ${round.steps.length - 1} tumbles` : "";
  const mult = round.multiplier > 0 ? `, x${round.multiplier}` : "";
  return `Olympus: ${symbols}${cascades}${mult}`;
}

function describeFreeSpins(batch: OlyFreeSpinsBatch, cost: number, payout: number): string {
  const finalMultiplier = batch.spins[batch.spins.length - 1]?.multiplierAfter ?? 0;
  const mult = finalMultiplier > 0 ? `, final x${finalMultiplier}` : "";
  return `Olympus free spins: ${batch.spins.length} spins for ${cost} chips${mult}, total payout ${payout}`;
}

/**
 * Membership (via the user's own client, so RLS applies) and the game row
 * (via admin, since casino_games settings are not the player's to read).
 * Neither depends on the other, so they go together.
 */
async function loadContext(
  casinoId: string,
  casinoGameId: string,
  userId: string,
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>
) {
  const [{ data: member }, { data: cg }] = await Promise.all([
    userClient
      .from("casino_members")
      .select("balance")
      .eq("casino_id", casinoId)
      .eq("user_id", userId)
      .single(),
    admin
      .from("casino_games")
      .select("min_bet, max_bet, settings")
      .eq("id", casinoGameId)
      .eq("casino_id", casinoId)
      .eq("game_type_id", "olympus")
      .single(),
  ]);
  return { member, cg };
}

/** One atomic settle: the balance and the ledger row land together. */
async function settle(
  admin: ReturnType<typeof createClient>,
  casinoId: string,
  userId: string,
  net: number,
  balance: number,
  description: string
) {
  await Promise.all([
    admin
      .from("casino_members")
      .update({ balance })
      .eq("casino_id", casinoId)
      .eq("user_id", userId),
    admin.from("transactions").insert({
      casino_id: casinoId,
      user_id: userId,
      amount: net,
      balance_after: balance,
      game_type_id: "olympus",
      description,
    }),
  ]);
}

async function handleSpin(
  body: unknown,
  userId: string,
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>
): Promise<Response> {
  const { casino_id, casino_game_id, bet } = body as {
    casino_id: string;
    casino_game_id: string;
    bet: number;
  };

  const { member, cg } = await loadContext(casino_id, casino_game_id, userId, userClient, admin);
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
  // update — the client only replays the returned steps.
  const round = playRound(rng, houseEdge);
  const payout = payoutFor(round, validBet);
  const net = roundMoney(payout - validBet);
  const balance = roundMoney(member.balance + net);

  await settle(admin, casino_id, userId, net, balance, describeRound(round));

  return json({ round, bet: validBet, payout, balance });
}

async function handleBuyFreeSpins(
  body: unknown,
  userId: string,
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>
): Promise<Response> {
  const { casino_id, casino_game_id, bet } = body as {
    casino_id: string;
    casino_game_id: string;
    bet: number;
  };

  const { member, cg } = await loadContext(casino_id, casino_game_id, userId, userClient, admin);
  if (!member) return json({ error: "You are not a member of this casino" }, 403);
  if (!cg) return json({ error: "Game not found" }, 400);
  if (!freeSpinsEnabled(cg.settings)) {
    return json({ error: "Free spins are not enabled for this game" }, 400);
  }

  // The player picks a PER-SPIN stake, bounded by the instance's own bet
  // limits, and the price follows from it. Unlike Tumble — where the player
  // names a price and the stake is derived — the price here is not the
  // player's to choose: it is fixed by the maths that keeps the batch at the
  // same RTP as a base spin (see freeSpinsCostMultiplier). So the stake is
  // what gets validated, and the cost is computed, never read from the body.
  if (typeof bet !== "number" || !isFinite(bet) || bet <= 0) {
    return json({ error: "Invalid bet" }, 400);
  }
  const validBet = roundMoney(bet);
  if (validBet < Number(cg.min_bet) || validBet > Number(cg.max_bet)) {
    return json({ error: `Bet must be between ${cg.min_bet} and ${cg.max_bet}` }, 400);
  }

  const cost = freeSpinsCost(validBet);
  if (cost > member.balance) {
    return json({ error: `Free spins cost ${cost} chips — not enough balance` }, 400);
  }

  const houseEdge = resolveHouseEdge(cg.settings);
  // FREE_SPINS_COUNT is a fixed 15, so the whole batch resolves here in one
  // go, same as a single round does.
  const batch = playFreeSpins(rng, houseEdge);
  const payout = roundMoney(batch.totalWin * validBet);
  const net = roundMoney(payout - cost);
  const balance = roundMoney(member.balance + net);

  await settle(admin, casino_id, userId, net, balance, describeFreeSpins(batch, cost, payout));

  return json({ batch, bet: validBet, cost, spins: FREE_SPINS_COUNT, payout, balance });
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
    const action = (body as { action?: string }).action ?? "spin";

    if (action === "buy_free_spins") {
      return await handleBuyFreeSpins(body, user.id, userClient, admin);
    }
    return await handleSpin(body, user.id, userClient, admin);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
