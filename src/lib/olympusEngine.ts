// The client's view of the Gates of Olympus engine.
//
// This is a re-export, not a copy. Every other game in this codebase mirrors
// its engine's constants by hand into the component that renders them (see
// the PAYTABLE literal at the top of Tumble.tsx), which is fine when the
// client only needs a paytable to display. Olympus needs more than that: the
// /showcase/olympus page plays complete rounds locally, so it needs the whole
// engine — weights, cascade, orbs and all. Re-exporting the edge function's
// module means the showcase and the paytable panel cannot drift from what the
// server actually pays, because they are running the same code.
//
// The engine module is deliberately free of Deno and Supabase imports so it
// can be consumed from both sides; see its header.
//
// NOTHING here is authoritative. The server replays none of it: every real
// spin is resolved by supabase/functions/olympus/index.ts and the client only
// animates the steps it gets back.

export * from "../../supabase/functions/olympus/engine.ts";
