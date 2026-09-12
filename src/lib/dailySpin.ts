// The client's view of the Daily Spin engine.
//
// A re-export, not a copy — same treatment as src/lib/olympusEngine.ts, and
// for the same reason: the owner's settings preview shows an average payout
// and a chance-of-nothing figure, and those numbers are worthless if they are
// computed by different code than the server rolls with.
//
// The engine module is deliberately free of Deno and Supabase imports so it
// can be consumed from both sides; see its header.
//
// NOTHING here is authoritative. Every real claim is resolved by
// supabase/functions/daily-spin/index.ts.

export * from "../../supabase/functions/daily-spin/engine.ts";
