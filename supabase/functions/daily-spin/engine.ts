// The Daily Spin engine.
//
// Deliberately free of Deno and Supabase imports so the same module can be
// consumed from the client — see src/lib/dailySpin.ts, which re-exports it.
// That is what stops the owner's settings preview from promising odds the
// server will not actually roll. Mirrors supabase/functions/olympus/engine.ts.
//
// NOTHING here is authoritative on its own: a real claim is resolved by
// supabase/functions/daily-spin/index.ts, which calls into this module.

export interface DailySpinSegment {
  /** Stable key across reorder/edit. Not meaningful to the server. */
  id: string;
  label: string;
  /** Chips awarded. 0 means Nothing — a first-class outcome, not an error. */
  amount: number;
  /** Relative odds within this wheel. Not a percentage. */
  weight: number;
  /** "#rrggbb" slice fill. */
  color: string;
}

export interface DailySpinSettings {
  enabled: boolean;
  title: string;
  subtitle: string;
  cooldownHours: number;
  segments: DailySpinSegment[];
}

export const MIN_SEGMENTS = 3;
export const MAX_SEGMENTS = 12;

const MAX_TITLE = 32;
const MAX_SUBTITLE = 60;
const MAX_LABEL = 24;
const MAX_AMOUNT = 10_000_000;
const MAX_WEIGHT = 1000;
const MIN_COOLDOWN_HOURS = 1;
const MAX_COOLDOWN_HOURS = 168;

const DEFAULT_TITLE = "Daily spin";
const DEFAULT_SUBTITLE = "Spin the wheel for free chips";
const DEFAULT_COOLDOWN_HOURS = 24;

/** Fallback slice colours, indexed by position. */
export const SEGMENT_PALETTE = [
  "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#14b8a6", "#a855f7",
  "#f97316", "#06b6d4", "#84cc16", "#e11d48",
];

/** Money is numeric(16,4) everywhere in this codebase. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * The wheel a casino gets when its owner has never configured one.
 *
 * Tuned to be a nudge, not an income: ~420 chips per spin against a 10,000
 * default starting balance (~4%/day), with roughly a third of spins landing
 * on Nothing. The two Nothing slices sit on opposite arcs so a near-miss on
 * the Jackpot is visually adjacent to a blank.
 *
 * `enabled` is false: the owner opts in.
 */
export const DEFAULT_DAILY_SPIN: DailySpinSettings = {
  enabled: false,
  title: DEFAULT_TITLE,
  subtitle: DEFAULT_SUBTITLE,
  cooldownHours: DEFAULT_COOLDOWN_HOURS,
  segments: [
    { id: "nothing-1", label: "Nothing",       amount: 0,      weight: 18, color: "#475569" },
    { id: "pocket",    label: "Pocket change", amount: 100,    weight: 22, color: "#3b82f6" },
    { id: "small",     label: "Small stack",   amount: 250,    weight: 18, color: "#10b981" },
    { id: "nothing-2", label: "Nothing",       amount: 0,      weight: 14, color: "#64748b" },
    { id: "lucky",     label: "Lucky handful", amount: 500,    weight: 13, color: "#8b5cf6" },
    { id: "big",       label: "Big stack",     amount: 1000,   weight: 8,  color: "#ec4899" },
    { id: "high",      label: "High roller",   amount: 2500,   weight: 4,  color: "#f59e0b" },
    { id: "jackpot",   label: "Jackpot",       amount: 10000,  weight: 1,  color: "#facc15" },
  ],
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function text(raw: unknown, max: number, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function resolveSegment(raw: unknown, index: number): DailySpinSegment | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const amountRaw = typeof rec.amount === "number" && isFinite(rec.amount) ? rec.amount : 0;
  const amount = roundMoney(Math.min(MAX_AMOUNT, Math.max(0, amountRaw)));

  // Weight floors at 1, never 0: a zero-weight slice is visible on the wheel
  // and can never be won, which reads to a player as a bug.
  const weight = clampInt(rec.weight, 1, MAX_WEIGHT, 1);

  const fallbackLabel = amount === 0 ? "Nothing" : `${amount} chips`;
  const label = text(rec.label, MAX_LABEL, fallbackLabel);

  const color =
    typeof rec.color === "string" && /^#[0-9a-f]{6}$/i.test(rec.color.trim())
      ? rec.color.trim()
      : SEGMENT_PALETTE[index % SEGMENT_PALETTE.length];

  const id = text(rec.id, 64, `seg-${index}`);

  return { id, label, amount, weight, color };
}

/**
 * Sanitizes anything at all into a valid config. Never throws — a malformed
 * `casinos.settings` jsonb must degrade to the default wheel rather than take
 * the lobby down. This is the authoritative gate: even if the settings UI were
 * bypassed, an out-of-range value is coerced rather than trusted.
 */
export function resolveDailySpin(raw: unknown): DailySpinSettings {
  const rec = asRecord(raw);
  if (!rec) return DEFAULT_DAILY_SPIN;

  const rawSegments = Array.isArray(rec.segments) ? rec.segments : [];
  const segments = rawSegments
    .slice(0, MAX_SEGMENTS)
    .map(resolveSegment)
    .filter((s): s is DailySpinSegment => s !== null);

  return {
    enabled: rec.enabled === true,
    title: text(rec.title, MAX_TITLE, DEFAULT_TITLE),
    subtitle: text(rec.subtitle, MAX_SUBTITLE, DEFAULT_SUBTITLE),
    cooldownHours: clampInt(
      rec.cooldownHours,
      MIN_COOLDOWN_HOURS,
      MAX_COOLDOWN_HOURS,
      DEFAULT_COOLDOWN_HOURS
    ),
    // Too few usable slices is not a wheel. Fall back wholesale rather than
    // padding, so the owner sees an obviously-default wheel and not a hybrid.
    segments: segments.length >= MIN_SEGMENTS ? segments : DEFAULT_DAILY_SPIN.segments,
  };
}

/**
 * Weighted pick. Walks the cumulative weights and returns the first index
 * whose running total passes `rng() * totalWeight`, clamping to the last
 * index so an `rng()` of exactly 1 cannot fall off the end.
 */
export function pickSegment(config: DailySpinSettings, rng: () => number): number {
  const total = config.segments.reduce((sum, s) => sum + s.weight, 0);
  const roll = rng() * total;
  let running = 0;
  for (let i = 0; i < config.segments.length; i++) {
    running += config.segments[i].weight;
    if (roll < running) return i;
  }
  return config.segments.length - 1;
}

/**
 * Mean chips per spin. This is the settings editor's OP-check, which is why
 * it lives here rather than in the edge function alone — the owner's preview
 * and the server's wheel have to be computed from the same numbers.
 */
export function expectedValue(config: DailySpinSettings): number {
  const total = config.segments.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) return 0;
  const weighted = config.segments.reduce((sum, s) => sum + s.amount * s.weight, 0);
  return weighted / total;
}

/** Odds of landing a 0-chip slice, 0–1. */
export function nothingChance(config: DailySpinSettings): number {
  const total = config.segments.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) return 1;
  const blank = config.segments.reduce((sum, s) => sum + (s.amount === 0 ? s.weight : 0), 0);
  return blank / total;
}

/**
 * When the next spin unlocks, or null if one is available right now.
 * An absent or unparseable timestamp means "never spun" — available.
 */
export function nextSpinAt(lastSpinAt: string | null, cooldownHours: number): Date | null {
  if (!lastSpinAt) return null;
  const last = new Date(lastSpinAt).getTime();
  if (!isFinite(last)) return null;
  const unlock = last + cooldownHours * 3600_000;
  return unlock > Date.now() ? new Date(unlock) : null;
}
