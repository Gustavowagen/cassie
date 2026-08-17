import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { GameInfoButton } from "../ui/GameInfoButton";
import { GameInfoPanel } from "../ui/GameInfoPanel";
import type { GameInfoEntry } from "../../lib/gameInfo";
import { formatChips } from "../../lib/utils";
import { playWinChime } from "../../lib/sound";
import { useSlots } from "../../hooks/useSlots";
import { getSlotsDesign } from "../../lib/slotsDesigns";
import { SlotSymbol, SlotsSkinStyles } from "./slotsSkin";
import type { SlotSymbolId, SlotReel, SlotWin, FullBoardSlotWin, SlotBoardSize } from "../../types";

type RewardMode = "single_row" | "full_board";
type AnySlotWin = (SlotWin | FullBoardSlotWin) & { amount: number };

const BOARD_DIMENSIONS: Record<SlotBoardSize, { rows: number; cols: number }> = {
  "3x3": { rows: 3, cols: 3 },
  "3x4": { rows: 3, cols: 4 },
  "5x3": { rows: 3, cols: 5 },
  "3x6": { rows: 3, cols: 6 },
  "4x6": { rows: 4, cols: 6 },
};

interface ClientPaytable {
  symbols: { id: SlotSymbolId; pay: number[] }[];
  baselineRtp: number;
  tierIndex: (count: number) => number;
  tierCount: 2 | 3;
  label: string;
  // Minimum match count to win at all — the single-row payline threshold,
  // or the full-board minCount. Kept here (not re-derived elsewhere) so
  // the info panel can state the real number instead of a hardcoded one.
  minCount: number;
}

// Mirrors supabase/functions/slots/engine.ts's SINGLE_ROW_TABLES — kept as
// a local, dependency-free copy (same pattern as Dice/Roulette) purely for
// the paytable's payout numbers. The server never trusts anything from
// here; it recomputes the real outcome and payout itself. No entry for
// 4x6 — single-row is never offered there (see ALLOWED_REWARD_MODES).
const SINGLE_ROW_PAYTABLES: Partial<Record<SlotBoardSize, ClientPaytable>> = {
  "3x3": {
    baselineRtp: 0.9049665,
    tierCount: 2,
    tierIndex: (count) => (count >= 3 ? 1 : 0),
    minCount: 2,
    label: "Paytable (2× · 3×)",
    symbols: [
      { id: "dot", pay: [0.5, 5.5] },
      { id: "square", pay: [1, 7.5] },
      { id: "diamond", pay: [1, 9.5] },
      { id: "star", pay: [1.5, 11.5] },
      { id: "seven", pay: [2, 15] },
    ],
  },
  "3x4": {
    baselineRtp: 0.99206293,
    tierCount: 2,
    tierIndex: (count) => (count >= 4 ? 1 : 0),
    minCount: 3,
    label: "Paytable (3× · 4×)",
    symbols: [
      { id: "dot", pay: [2.5, 18.5] },
      { id: "square", pay: [3, 24.5] },
      { id: "diamond", pay: [4, 30.5] },
      { id: "star", pay: [4.5, 36.5] },
      { id: "seven", pay: [6, 48.5] },
    ],
  },
  "5x3": {
    baselineRtp: 0.9619252895,
    tierCount: 3,
    tierIndex: (count) => (count >= 5 ? 2 : count === 4 ? 1 : 0),
    minCount: 3,
    label: "Paytable (3× · 4× · 5×)",
    symbols: [
      { id: "dot", pay: [1.5, 3, 12] },
      { id: "square", pay: [2, 4, 15] },
      { id: "diamond", pay: [2.5, 5, 19] },
      { id: "star", pay: [3, 6.5, 25] },
      { id: "seven", pay: [4, 8.5, 40] },
    ],
  },
  "3x6": {
    baselineRtp: 0.972812236308,
    tierCount: 3,
    tierIndex: (count) => (count >= 6 ? 2 : count === 5 ? 1 : 0),
    minCount: 4,
    label: "Paytable (4× · 5× · 6×)",
    symbols: [
      { id: "dot", pay: [4, 8, 31] },
      { id: "square", pay: [5, 10.5, 41.5] },
      { id: "diamond", pay: [6.5, 13, 52] },
      { id: "star", pay: [8, 15.5, 62] },
      { id: "seven", pay: [10.5, 20.5, 83] },
    ],
  },
};

interface FullBoardSymbolPaytable {
  id: SlotSymbolId;
  threshold: number;
  tierIndex: (count: number) => number;
  pay: number[];
  // Precomputed count-range text per tier (e.g. "7-8 · 9 · 10+") — kept as
  // a plain string here rather than derived from tierIndex at render time,
  // since deriving exact range boundaries back out of a tierIndex function
  // is more error-prone than stating them once alongside the thresholds
  // they were designed from (see the design doc's per-symbol tables).
  rangeLabel: string;
}

interface FullBoardClientPaytable {
  baselineRtp: number;
  symbols: FullBoardSymbolPaytable[];
}

// Mirrors supabase/functions/slots/engine.ts's FULL_BOARD_TABLES. Every
// symbol has its own threshold/tiers now (not one shared minCount) — see
// docs/superpowers/specs/2026-08-07-slots-full-board-per-symbol-thresholds-design.md.
const FULL_BOARD_PAYTABLES: Record<"5x3" | "3x6" | "4x6", FullBoardClientPaytable> = {
  "5x3": {
    baselineRtp: 0.953370178231,
    symbols: [
      { id: "dot", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [0.5, 1.5, 4.5], rangeLabel: "7-8 · 9 · 10+" },
      { id: "square", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [2.5, 8, 28], rangeLabel: "7-8 · 9 · 10+" },
      { id: "diamond", threshold: 7, tierIndex: (c) => (c >= 9 ? 2 : c === 8 ? 1 : 0), pay: [6, 17.5, 61.5], rangeLabel: "7 · 8 · 9+" },
      { id: "star", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [22, 66.5, 233.5], rangeLabel: "6 · 7 · 8+" },
      { id: "seven", threshold: 5, tierIndex: (c) => (c >= 7 ? 2 : c === 6 ? 1 : 0), pay: [27.5, 82.5, 288], rangeLabel: "5 · 6 · 7+" },
    ],
  },
  "3x6": {
    baselineRtp: 0.990009227769,
    symbols: [
      { id: "dot", threshold: 9, tierIndex: (c) => (c >= 12 ? 2 : c === 11 ? 1 : 0), pay: [1, 2.5, 9], rangeLabel: "9-10 · 11 · 12+" },
      { id: "square", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [1, 2.5, 9], rangeLabel: "7-8 · 9 · 10+" },
      { id: "diamond", threshold: 7, tierIndex: (c) => (c >= 10 ? 2 : c === 9 ? 1 : 0), pay: [3, 8.5, 30], rangeLabel: "7-8 · 9 · 10+" },
      { id: "star", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [7, 21.5, 74.5], rangeLabel: "6 · 7 · 8+" },
      { id: "seven", threshold: 5, tierIndex: (c) => (c >= 7 ? 2 : c === 6 ? 1 : 0), pay: [10.5, 31.5, 110.5], rangeLabel: "5 · 6 · 7+" },
    ],
  },
  "4x6": {
    baselineRtp: 0.924315378511,
    symbols: [
      { id: "dot", threshold: 11, tierIndex: (c) => (c >= 15 ? 2 : c >= 13 ? 1 : 0), pay: [0.5, 2, 6.5], rangeLabel: "11-12 · 13-14 · 15+" },
      { id: "square", threshold: 9, tierIndex: (c) => (c >= 13 ? 2 : c >= 11 ? 1 : 0), pay: [1, 3, 11], rangeLabel: "9-10 · 11-12 · 13+" },
      { id: "diamond", threshold: 9, tierIndex: (c) => (c >= 12 ? 2 : c === 11 ? 1 : 0), pay: [3.5, 11, 39], rangeLabel: "9-10 · 11 · 12+" },
      { id: "star", threshold: 7, tierIndex: (c) => (c >= 9 ? 2 : c === 8 ? 1 : 0), pay: [5, 14.5, 50.5], rangeLabel: "7 · 8 · 9+" },
      { id: "seven", threshold: 6, tierIndex: (c) => (c >= 8 ? 2 : c === 7 ? 1 : 0), pay: [11, 33, 116.5], rangeLabel: "6 · 7 · 8+" },
    ],
  },
};

function edgeScale(baselineRtp: number, houseEdge: number): number {
  return (1 - houseEdge) / baselineRtp;
}
function displayX(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

// Maps a win's raw count to the shared 3/4/5 CSS win-tier hooks
// (sl-win-tier-3/4/5). 2-tier boards (3x3, 3x4) skip the middle "BIG WIN"
// tier — their tier 0 maps to WIN (3), tier 1 straight to MEGA WIN (5).
// Full-board mode has no single shared tierIndex anymore — every
// qualifying symbol in `win.wins` is checked against its own symbol's
// tierIndex, and the banner shows whichever tier is highest across all of
// them (the payout amount itself is the sum of every qualifier's own-tier
// payout, computed server-side in payoutForFullBoard — this function only
// decides the banner's visual tier). Only ever called with a
// (boardSize, rewardMode) pair the server actually allows
// (ALLOWED_REWARD_MODES), so the lookups below should always find a table
// — FULL_BOARD_PAYTABLES simply has no 3x3/3x4 entry because full_board is
// never reachable on those sizes. Falling back to the 5x3 table (valid for
// both reward modes) rather than asserting non-null means a future
// prop-shape violation (e.g. a stale rewardMode mid re-render) degrades to
// a wrong-but-harmless tier instead of an uncaught render-time crash —
// this codebase has no error boundary, so that would white-screen the
// whole app, not just this modal. The fallback never affects the
// correct-path result.
function winTier(boardSize: SlotBoardSize, rewardMode: RewardMode, win: AnySlotWin): 3 | 4 | 5 {
  if (rewardMode === "full_board") {
    const table = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] ?? FULL_BOARD_PAYTABLES["5x3"];
    const { wins } = win as FullBoardSlotWin;
    let maxTier = 0;
    for (const w of wins) {
      const symbolConfig = table.symbols.find((s) => s.id === w.symbol);
      if (!symbolConfig) continue;
      const t = symbolConfig.tierIndex(w.count);
      if (t > maxTier) maxTier = t;
    }
    return maxTier >= 2 ? 5 : maxTier === 1 ? 4 : 3;
  }
  const table = SINGLE_ROW_PAYTABLES[boardSize] ?? SINGLE_ROW_PAYTABLES["5x3"]!;
  const tier = table.tierIndex((win as SlotWin).count);
  if (table.tierCount === 2) return tier >= 1 ? 5 : 3;
  return tier >= 2 ? 5 : tier === 1 ? 4 : 3;
}

const SYMBOL_DISPLAY_NAMES: Record<SlotSymbolId, string> = {
  dot: "Dot",
  square: "Square",
  diamond: "Diamond",
  star: "Star",
  seven: "Seven",
};

// Builds the info panel's title/description/rules from this instance's
// actual boardSize/rewardMode, reusing the same threshold/tierIndex data
// the paytable and winTier already read — no separate, hand-copied set of
// numbers to drift out of sync (see gameInfo.ts's generic "slots" fallback,
// which this replaces for the always-known-instance case).
function buildSlotsInfo(boardSize: SlotBoardSize, rewardMode: RewardMode): GameInfoEntry {
  const { rows, cols } = BOARD_DIMENSIONS[boardSize];
  if (rewardMode === "full_board") {
    const table = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] ?? FULL_BOARD_PAYTABLES["5x3"];
    return {
      title: "Slots",
      description: `A ${cols}-reel, ${rows}-row slot machine. Wins are counted across the whole board — rarer symbols need fewer matching cells to win than common ones, though common symbols still win more often overall.`,
      rules: table.symbols.map(
        (s) => `${SYMBOL_DISPLAY_NAMES[s.id]}: ${s.threshold}+ matching cells anywhere wins, with higher counts paying more.`
      ),
    };
  }
  const table = SINGLE_ROW_PAYTABLES[boardSize] ?? SINGLE_ROW_PAYTABLES["5x3"]!;
  return {
    title: "Slots",
    description: `A ${cols}-reel, ${rows}-row slot machine. Wins are counted on the middle row only.`,
    rules: [`${table.minCount}+ matching symbols anywhere on the middle row wins, with higher counts paying more.`],
  };
}

function randomSymbolId(): SlotSymbolId {
  const ids: SlotSymbolId[] = ["dot", "square", "diamond", "star", "seven"];
  return ids[Math.floor(Math.random() * ids.length)];
}

// Reel-drop timing: each reel starts REEL_STAGGER_MS after the previous one
// and takes REEL_DROP_MS to land — must match the CSS animation-duration /
// animation-delay values in SlotsStyles below. The true outcome (and the
// balance credit for any payout) isn't revealed until this has fully played.
const REEL_STAGGER_MS = 140;
const REEL_DROP_MS = 950;
const MAX_COLS = 6; // the widest board (3x6, 4x6)
const REVEAL_MS = (MAX_COLS - 1) * REEL_STAGGER_MS + REEL_DROP_MS + 140; // last reel's delay + duration + buffer

const PARTICLE_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const FILLER_COUNT = 15;

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Strip = FILLER_COUNT cosmetic filler symbols (never part of the real
// outcome, just motion-blur padding) followed by the server's actual
// column, top-to-bottom. The CSS drop animation always shifts up by
// exactly FILLER_COUNT cell-heights regardless of row count, which lands
// the strip's last `rows` cells in the reel's `rows`-cell-tall viewport —
// see SlotsStyles' slReelDrop keyframes.
function buildStrip(reel: SlotReel): SlotSymbolId[] {
  const filler = Array.from({ length: FILLER_COUNT }, () => randomSymbolId());
  return [...filler, ...reel];
}

interface Props {
  casinoId: string;
  gameId: string;
  rewardMode: RewardMode;
  boardSize: SlotBoardSize;
  houseEdge: number;
  design?: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Slots({
  casinoId,
  gameId,
  rewardMode,
  boardSize,
  houseEdge,
  design,
  balance: initialBalance,
  minBet,
  maxBet,
  onExit,
}: Props) {
  const { loading, error: spinError, spin: spinSlots } = useSlots(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const { rows, cols } = BOARD_DIMENSIONS[boardSize];
  const paylineRow = Math.floor(rows / 2);
  const [reels, setReels] = useState<SlotReel[]>(() =>
    Array.from({ length: cols }, () => Array.from({ length: rows }, randomSymbolId))
  );
  const [strips, setStrips] = useState<SlotSymbolId[][]>([]);
  const [win, setWin] = useState<AnySlotWin | null>(null);
  const [winId, setWinId] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showPaytable, setShowPaytable] = useState(true);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    };
  }, []);

  const activeDesign = useMemo(() => getSlotsDesign(design), [design]);
  const slotsInfo = useMemo(() => buildSlotsInfo(boardSize, rewardMode), [boardSize, rewardMode]);

  const busy = loading || spinning;
  const bet = Math.max(0, parseFloat(betText) || 0);
  const betValid = bet >= minBet && bet <= maxBet && bet <= localBalance;

  function adjustBet(mult: number) {
    setBetText(String(roundMoney(Math.max(0, bet * mult))));
  }

  async function handleSpin() {
    if (!betValid || busy) return;
    setFormError(null);
    const stake = bet;
    // The bet is lost the instant it's placed, win or lose — the reel drop
    // is cosmetic and must never gate this deduction.
    setLocalBalance((b) => b - stake);
    setWin(null);
    try {
      const res = await spinSlots(stake);
      // Bake the server's real outcome into the tail of each reel's strip,
      // then start the drop animation — this is what the player actually sees.
      setStrips(res.reels.map(buildStrip));
      setSpinning(true);
      revealTimeoutRef.current = setTimeout(() => {
        setReels(res.reels);
        setLocalBalance(res.balance);
        if (res.win) {
          setWinId((id) => id + 1);
          setWin({ ...res.win, amount: res.payout } as AnySlotWin);
          playWinChime();
        }
        setSpinning(false);
      }, REVEAL_MS);
    } catch (err) {
      setLocalBalance((b) => b + stake); // roll back the optimistic deduction
      setFormError(err instanceof Error ? err.message : "Spin failed");
    }
  }

  const activeSingleRowTable = SINGLE_ROW_PAYTABLES[boardSize];
  // 3x3/3x4 have no full-board table (full_board is never reachable there
  // per ALLOWED_REWARD_MODES) — this lookup is `undefined` for those two
  // sizes, so every consumer below must guard it rather than assume it
  // exists just because rewardMode happens to be checked elsewhere.
  const activeFullBoardTable = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] as
    | FullBoardClientPaytable
    | undefined;

  // Scaled to the game's actual configured house edge, so the displayed "x"
  // always matches what the server (supabase/functions/slots/index.ts) pays.
  // Both memos run on every render regardless of the current rewardMode
  // (hooks can't be conditional), so each must independently no-op when its
  // own table doesn't apply to this boardSize instead of assuming the other
  // one guards it.
  const scaledSingleRowPay = useMemo(() => {
    if (!activeSingleRowTable) return [];
    const scale = edgeScale(activeSingleRowTable.baselineRtp, houseEdge);
    return activeSingleRowTable.symbols.map((s) => ({ ...s, pay: s.pay.map((x) => x * scale) }));
  }, [activeSingleRowTable, houseEdge]);
  const scaledFullBoardPay = useMemo(() => {
    if (!activeFullBoardTable) return [];
    const scale = edgeScale(activeFullBoardTable.baselineRtp, houseEdge);
    return activeFullBoardTable.symbols.map((s) => ({ ...s, pay: s.pay.map((x) => x * scale) }));
  }, [activeFullBoardTable, houseEdge]);

  const tier = win ? winTier(boardSize, rewardMode, win) : null;
  const winMessage = tier === 5 ? "MEGA WIN" : tier === 4 ? "BIG WIN" : tier === 3 ? "WIN" : "";

  // Full-board wins light up cells on any row; build a lookup once per win
  // rather than re-scanning positions per cell.
  const fullBoardLit = useMemo(() => {
    if (!win || rewardMode !== "full_board") return null;
    const { wins } = win as FullBoardSlotWin;
    return new Set(wins.flatMap((w) => w.positions.map((p) => `${p.reel}:${p.row}`)));
  }, [win, rewardMode]);

  return (
    <div
      className="relative bg-card rounded-2xl overflow-hidden flex flex-col h-screen h-[var(--app-vvh,100dvh)] sm:h-[min(92vh,800px)]"
      style={{ width: "min(96vw, 1360px)" }}
    >
      <SlotsSkinStyles />
      <SlotsStyles />
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">{activeDesign.name}</p>
          <p className="text-xs text-muted-foreground">Balance: {formatChips(localBalance)} chips</p>
        </div>
        <div className="flex items-center gap-3">
          <BackdropToggleButton />
          <MuteButton />
          <GameInfoButton active={showInfo} onClick={() => setShowInfo((v) => !v)} />
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <X className="h-4 w-4" />
            Exit
          </button>
        </div>
      </div>

      {showInfo ? (
        <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
          <GameInfoPanel info={slotsInfo} onBack={() => setShowInfo(false)} />
        </div>
      ) : (
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-auto overscroll-contain">
        <div className="flex flex-col gap-3 p-4 md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border">
          <div>
            <label className="text-xs text-muted-foreground">Bet Amount</label>
            <input
              type="number"
              min={0}
              value={betText}
              onChange={(e) => setBetText(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => adjustBet(0.5)}
                disabled={busy}
                className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                ½
              </button>
              <button
                type="button"
                onClick={() => adjustBet(2)}
                disabled={busy}
                className="flex-1 rounded-md border border-border py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground"
              >
                2×
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Min {formatChips(minBet)} · Max {formatChips(maxBet)}
            </p>
          </div>

          <Button onClick={handleSpin} disabled={!betValid || busy} className="mt-1 h-11 text-base font-bold">
            {busy ? "Spinning…" : "Spin"}
          </Button>

          {(formError || spinError) && <p className="text-xs text-destructive">{formError ?? spinError}</p>}

          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {rewardMode === "full_board" ? "Paytable" : activeSingleRowTable?.label}
              </p>
              <button
                type="button"
                onClick={() => setShowPaytable((v) => !v)}
                aria-label={showPaytable ? "Hide paytable" : "Show paytable"}
                aria-pressed={showPaytable}
                className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPaytable ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {showPaytable &&
              rewardMode === "full_board" &&
              scaledFullBoardPay.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="sl-sym-mini">
                    <SlotSymbol design={activeDesign} id={s.id} />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-muted-foreground/70 font-mono text-[10px]">{s.rangeLabel}</span>
                    <span className="text-muted-foreground font-mono">
                      {s.pay.map((x) => `${displayX(x)}x`).join(" · ")}
                    </span>
                  </span>
                </div>
              ))}
            {showPaytable &&
              rewardMode !== "full_board" &&
              scaledSingleRowPay.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="sl-sym-mini">
                    <SlotSymbol design={activeDesign} id={s.id} />
                  </span>
                  <span className="text-muted-foreground font-mono">
                    {s.pay.map((x) => `${displayX(x)}x`).join(" · ")}
                  </span>
                </div>
              ))}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-5 min-w-0">
          <div
            className={`sl-reels-wrap ${activeDesign.themeClass}`}
            style={{ "--rows": rows, "--cols": cols } as CSSProperties}
          >
            {rewardMode === "single_row" && (
              <>
                <div
                  className="sl-payline-arrow sl-left"
                  style={{ top: `calc(14px + ${paylineRow + 0.5} * var(--cell))` }}
                />
                <div
                  className="sl-payline-arrow sl-right"
                  style={{ top: `calc(14px + ${paylineRow + 0.5} * var(--cell))` }}
                />
              </>
            )}
            <div className="sl-reels">
              {reels.map((reel, i) => {
                const strip = strips[i];
                return (
                  <div className="sl-reel" key={i}>
                    {spinning && strip ? (
                      <div className="sl-reel-strip sl-spin">
                        {strip.map((sym, k) => (
                          <div className="sl-cell" key={k}>
                            <SlotSymbol design={activeDesign} id={sym} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sl-reel-static">
                        {reel.map((symbol, row) => {
                          const isLit =
                            rewardMode === "full_board"
                              ? Boolean(fullBoardLit?.has(`${i}:${row}`))
                              : row === paylineRow && Boolean(win && (win as SlotWin).positions.includes(i));
                          return (
                            <div
                              className={`sl-cell ${row === paylineRow ? "sl-mid" : ""} ${isLit ? "sl-lit" : ""}`}
                              key={row}
                            >
                              <SlotSymbol design={activeDesign} id={symbol} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {win && (
              <div key={winId} className={`sl-win-tier-${tier}`}>
                <div className="sl-win-flash" />
                <div className="sl-win-banner">
                  <div className="sl-win-label">{winMessage}</div>
                  <div className="sl-win-amount">+{formatChips(win.amount)}</div>
                </div>
                <div className="sl-particles">
                  {PARTICLE_SLOTS.map((p) => (
                    <i className="sl-particle" key={p} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function SlotsStyles() {
  const nthChildRules = Array.from(
    { length: MAX_COLS },
    (_, i) =>
      `.sl-reel:nth-child(${i + 1}) .sl-reel-strip.sl-spin { animation-delay: ${i * REEL_STAGGER_MS}ms; }`
  ).join("\n      ");

  return (
    <style>{`
      /* Cell/symbol primitives, per-design icon art and theme chrome live in
         slotsSkin.tsx, shared with Tumble. Everything here is this game's own
         reel layout and spin animation. */
      .sl-reels-wrap {
        /* Grows with the viewport (not just the modal) so the reels visibly
           fill more of the popup's empty space on larger screens, floored
           for mobile and capped so cells stay proportioned at 4K. */
        --cell: clamp(64px, 6.5vw, 108px);
      }
      .sl-reels { display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); gap: 8px; }
      .sl-reel { width: var(--cell); height: calc(var(--rows) * var(--cell)); overflow: hidden; border-radius: 10px; position: relative; background: rgba(0,0,0,0.25); }
      .sl-reel-static, .sl-reel-strip { display: flex; flex-direction: column; }
      .sl-cell.sl-mid { position: relative; }

      @keyframes slReelDrop {
        0% { transform: translateY(0); filter: blur(6px); }
        70% { filter: blur(4px); }
        100% { transform: translateY(calc(-${FILLER_COUNT} * var(--cell))); filter: blur(0); }
      }
      .sl-reel-strip.sl-spin { animation: slReelDrop ${REEL_DROP_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
      ${nthChildRules}

      .sl-payline-arrow { position: absolute; width: 0; height: 0; transform: translateY(-50%); z-index: 1; }
      .sl-payline-arrow.sl-left { left: 2px; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left-width: 8px; border-left-style: solid; }
      .sl-payline-arrow.sl-right { right: 2px; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-right-width: 8px; border-right-style: solid; }

      .sl-win-flash { position: absolute; inset: 0; border-radius: 16px; pointer-events: none; opacity: 0; animation: slFlashPulse 900ms ease-out 2; }
      @keyframes slFlashPulse { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }

      /* .sl-win-banner / .sl-win-label / .sl-win-amount live in slotsSkin.tsx
         (shared with Tumble); only this game's extra top-tier sizing and
         shake are here. */
      .sl-win-tier-5 .sl-win-amount { font-size: 42px; }
      .sl-win-tier-5 .sl-reels-wrap { animation: slShake 520ms ease-in-out 1; }
      @keyframes slShake { 0%, 100% { transform: translate(0, 0); } 20% { transform: translate(-4px, 2px); } 40% { transform: translate(4px, -2px); } 60% { transform: translate(-3px, -2px); } 80% { transform: translate(3px, 2px); } }


      .sl-particles { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
      .sl-particle { position: absolute; left: 50%; top: 42%; width: 7px; height: 7px; border-radius: 2px; background: #ff5fd1; opacity: 0; animation: slBurst 1100ms ease-out forwards; }
      @keyframes slBurst { 0% { opacity: 0; transform: translate(-50%, -50%) rotate(0deg) translateX(0) scale(0.6); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--rot)) translateX(var(--dist)) scale(0.9); } }
      .sl-particle:nth-child(1) { --rot: 0deg; --dist: 100px; background: #33e6ff; animation-delay: 0ms; }
      .sl-particle:nth-child(2) { --rot: 30deg; --dist: 130px; background: #ff4fc3; animation-delay: 40ms; }
      .sl-particle:nth-child(3) { --rot: 60deg; --dist: 90px; background: #ffe066; animation-delay: 80ms; }
      .sl-particle:nth-child(4) { --rot: 90deg; --dist: 140px; background: #4bffb0; animation-delay: 20ms; }
      .sl-particle:nth-child(5) { --rot: 120deg; --dist: 100px; background: #c86bff; animation-delay: 100ms; }
      .sl-particle:nth-child(6) { --rot: 150deg; --dist: 120px; background: #33e6ff; animation-delay: 60ms; }
      .sl-particle:nth-child(7) { --rot: 180deg; --dist: 95px; background: #ff4fc3; animation-delay: 10ms; }
      .sl-particle:nth-child(8) { --rot: 210deg; --dist: 135px; background: #ffe066; animation-delay: 90ms; }
      .sl-particle:nth-child(9) { --rot: 240deg; --dist: 100px; background: #4bffb0; animation-delay: 50ms; }
      .sl-particle:nth-child(10) { --rot: 270deg; --dist: 125px; background: #c86bff; animation-delay: 30ms; }
      .sl-particle:nth-child(11) { --rot: 300deg; --dist: 90px; background: #33e6ff; animation-delay: 110ms; }
      .sl-particle:nth-child(12) { --rot: 330deg; --dist: 130px; background: #ff4fc3; animation-delay: 70ms; }

      @media (prefers-reduced-motion: reduce) {
        .sl-particle { display: none; }
        .sl-win-flash, .sl-win-banner { animation: none; opacity: 0; }
        .sl-reel-strip.sl-spin { animation-duration: 1ms; }
      }
    `}</style>
  );
}
