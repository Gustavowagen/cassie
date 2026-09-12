import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveDailySpin, pickSegment, nextSpinAt } from "./engine.ts";

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

    const { casino_id } = (await req.json()) as { casino_id: string };
    if (!casino_id) return json({ error: "Missing casino_id" }, 400);

    // Membership (via the user's own client, so RLS proves it) and the
    // casino's settings. Neither depends on the other, so they go together.
    const [{ data: member }, { data: casino }] = await Promise.all([
      userClient
        .from("casino_members")
        .select("last_daily_spin_at")
        .eq("casino_id", casino_id)
        .eq("user_id", user.id)
        .single(),
      admin.from("casinos").select("settings").eq("id", casino_id).single(),
    ]);
    if (!member) return json({ error: "You are not a member of this casino" }, 403);
    if (!casino) return json({ error: "Casino not found" }, 400);

    const settings = casino.settings as Record<string, unknown> | null;
    const specialFeatures = settings?.specialFeatures as Record<string, unknown> | undefined;
    const config = resolveDailySpin(specialFeatures?.dailySpin);
    if (!config.enabled) {
      return json({ error: "Daily spin is not available in this casino" }, 400);
    }

    // Fast-path reject so an obviously-early claim never touches the write
    // path. claim_daily_spin re-checks authoritatively.
    const pending = nextSpinAt(member.last_daily_spin_at as string | null, config.cooldownHours);
    if (pending) {
      return json(
        { error: "Your next spin isn't ready yet", nextSpinAt: pending.toISOString() },
        429
      );
    }

    const segmentIndex = pickSegment(config, rng);
    const segment = config.segments[segmentIndex];

    const { data: balance, error } = await admin.rpc("claim_daily_spin", {
      p_casino_id: casino_id,
      p_user_id: user.id,
      p_amount: segment.amount,
      p_cooldown_hours: config.cooldownHours,
      p_description: `Daily spin: ${segment.label}`,
    });
    if (error) return json({ error: error.message }, 500);
    // The fast path raced against a concurrent claim and lost. Nothing was
    // credited and nothing was written.
    if (balance === null) {
      return json({ error: "Your next spin isn't ready yet" }, 429);
    }

    // Ground nextSpinAt in the timestamp Postgres actually just wrote,
    // rather than Deno's own clock, so it can't disagree with the clock
    // that claim_daily_spin's cooldown guard enforces. The guard has just
    // closed the window, so nothing else can move this value underneath us.
    const { data: updated, error: reReadError } = await admin
      .from("casino_members")
      .select("last_daily_spin_at")
      .eq("casino_id", casino_id)
      .eq("user_id", user.id)
      .single();

    const grounded = nextSpinAt(
      (updated?.last_daily_spin_at as string | null) ?? null,
      config.cooldownHours
    );
    if (!grounded) {
      // The claim already succeeded (balance moved, cooldown written) — we
      // cannot fail this response over a display-only re-read. This branch
      // means the re-read itself came back empty/errored immediately after
      // writing that same row (reReadError below, if set, says why); it is
      // not reachable via ordinary clock skew, since claim_daily_spin just
      // stamped last_daily_spin_at with Postgres's now() and cooldownHours
      // is at least 1. Log it so the rare case is visible in function logs
      // rather than silently masked, then fall back to Deno's clock so the
      // response still carries a best-effort countdown.
      console.error("daily-spin: nextSpinAt re-read failed, falling back to Deno clock", {
        casino_id,
        user_id: user.id,
        reReadError,
      });
    }

    return json({
      segmentIndex,
      label: segment.label,
      amount: segment.amount,
      balance: Number(balance),
      nextSpinAt: (grounded ?? new Date(Date.now() + config.cooldownHours * 3600_000)).toISOString(),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
