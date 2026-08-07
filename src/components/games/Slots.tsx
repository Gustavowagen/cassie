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
import { getSlotsDesign, type SlotsDesign } from "../../lib/slotsDesigns";
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

// Mirrors supabase/functions/slots/engine.ts's FULL_BOARD_TABLES.
const FULL_BOARD_PAYTABLES: Record<"5x3" | "3x6" | "4x6", ClientPaytable> = {
  "5x3": {
    baselineRtp: 0.984280455592317,
    tierCount: 3,
    tierIndex: (count) => (count >= 11 ? 2 : count >= 9 ? 1 : 0),
    minCount: 7,
    label: "Paytable (7-8 · 9-10 · 11+)",
    symbols: [
      { id: "dot", pay: [2, 6, 21] },
      { id: "square", pay: [3, 9, 32] },
      { id: "diamond", pay: [4, 12, 42] },
      { id: "star", pay: [6, 18, 63] },
      { id: "seven", pay: [10, 30, 105] },
    ],
  },
  "3x6": {
    baselineRtp: 0.942909367367,
    tierCount: 3,
    tierIndex: (count) => (count >= 12 ? 2 : count >= 10 ? 1 : 0),
    minCount: 8,
    label: "Paytable (8-9 · 10-11 · 12+)",
    symbols: [
      { id: "dot", pay: [1.5, 5, 18.5] },
      { id: "square", pay: [2.5, 8, 27.5] },
      { id: "diamond", pay: [3.5, 10.5, 36.5] },
      { id: "star", pay: [5, 15.5, 55] },
      { id: "seven", pay: [8.5, 26, 92] },
    ],
  },
  "4x6": {
    baselineRtp: 0.972684972884,
    tierCount: 3,
    tierIndex: (count) => (count >= 17 ? 2 : count >= 13 ? 1 : 0),
    minCount: 10,
    label: "Paytable (10-12 · 13-16 · 17+)",
    symbols: [
      { id: "dot", pay: [2, 5.5, 19] },
      { id: "square", pay: [2.5, 8, 29] },
      { id: "diamond", pay: [3.5, 11, 38.5] },
      { id: "star", pay: [5.5, 16.5, 57.5] },
      { id: "seven", pay: [9, 27.5, 96] },
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
// Only ever called with a (boardSize, rewardMode) pair the server actually
// allows (ALLOWED_REWARD_MODES), so the lookups below should always find a
// table — FULL_BOARD_PAYTABLES simply has no 3x3/3x4 entry because
// full_board is never reachable on those sizes. Falling back to the 5x3
// table (valid for both reward modes) rather than asserting non-null means
// a future prop-shape violation (e.g. a stale rewardMode mid re-render)
// degrades to a wrong-but-harmless tier instead of an uncaught render-time
// crash — this codebase has no error boundary, so that would white-screen
// the whole app, not just this modal. The fallback never affects the
// correct-path result.
function winTier(boardSize: SlotBoardSize, rewardMode: RewardMode, count: number): 3 | 4 | 5 {
  const table =
    rewardMode === "full_board"
      ? (FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] ?? FULL_BOARD_PAYTABLES["5x3"])
      : (SINGLE_ROW_PAYTABLES[boardSize] ?? SINGLE_ROW_PAYTABLES["5x3"]!);
  const tier = table.tierIndex(count);
  if (table.tierCount === 2) return tier >= 1 ? 5 : 3;
  return tier >= 2 ? 5 : tier === 1 ? 4 : 3;
}

// Builds the info panel's title/description/rules from this instance's
// actual boardSize/rewardMode, reusing the same minCount/tierIndex data
// the paytable and winTier already read — no separate, hand-copied set of
// numbers to drift out of sync (see gameInfo.ts's generic "slots" fallback,
// which this replaces for the always-known-instance case).
function buildSlotsInfo(boardSize: SlotBoardSize, rewardMode: RewardMode): GameInfoEntry {
  const { rows, cols } = BOARD_DIMENSIONS[boardSize];
  if (rewardMode === "full_board") {
    const table = FULL_BOARD_PAYTABLES[boardSize as "5x3" | "3x6" | "4x6"] ?? FULL_BOARD_PAYTABLES["5x3"];
    return {
      title: "Slots",
      description: `A ${cols}-reel, ${rows}-row slot machine. Wins are counted across the whole board.`,
      rules: [
        `${table.minCount}+ matching cells anywhere across all ${rows * cols} visible cells wins, with higher counts paying more.`,
      ],
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

// Renders one symbol using the active design's icon spec — a themed shape
// (`className`) optionally built from absolutely-positioned sub-shapes
// (`parts`, e.g. a cherry's two stems/leaf/balls) or literal glyph text
// (`text`, the two designs whose top symbol is a glowing "7"). See
// SlotsThemeStyles for the CSS each className/part hooks into.
function SlotSymbol({ design, id }: { design: SlotsDesign; id: SlotSymbolId }) {
  const spec = design.icons[id];
  return (
    <span className="sl-sym">
      <span className={`sl-ic ${spec.className}`}>
        {spec.parts?.map((cls, i) => <i className={cls} key={i} />)}
        {spec.text}
      </span>
    </span>
  );
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
    | ClientPaytable
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

  const tier = win ? winTier(boardSize, rewardMode, win.count) : null;
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
                {rewardMode === "full_board" ? activeFullBoardTable?.label : activeSingleRowTable?.label}
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
              (rewardMode === "full_board" ? scaledFullBoardPay : scaledSingleRowPay).map((s) => (
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
      .sl-reels-wrap {
        /* Grows with the viewport (not just the modal) so the reels visibly
           fill more of the popup's empty space on larger screens, floored
           for mobile and capped so cells stay proportioned at 4K. */
        --cell: clamp(64px, 6.5vw, 108px);
        position: relative;
        padding: 14px;
        border-radius: 16px;
      }
      .sl-reels { display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); gap: 8px; }
      .sl-reel { width: var(--cell); height: calc(var(--rows) * var(--cell)); overflow: hidden; border-radius: 10px; position: relative; background: rgba(0,0,0,0.25); }
      .sl-reel-static, .sl-reel-strip { display: flex; flex-direction: column; }
      .sl-cell { width: var(--cell); height: var(--cell); display: flex; align-items: center; justify-content: center; flex: none; }
      .sl-cell.sl-mid { position: relative; }

      .sl-sym { width: 56%; height: 56%; display: flex; align-items: center; justify-content: center; position: relative; font-weight: 700; font-size: 24px; }
      .sl-sym-mini { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; }
      .sl-sym-mini .sl-sym { width: 100%; height: 100%; font-size: 12px; }
      /* .sl-ic is the themed icon's own box — always fills its .sl-sym
         wrapper, so every design's shapes (and any of their part elements,
         positioned absolutely against it) scale the same way at both the
         main reel size and the paytable's 22px mini size. */
      .sl-ic { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }

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

      .sl-win-banner { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%) scale(0.7); text-align: center; pointer-events: none; opacity: 0; animation: slBannerIn 2400ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards; z-index: 3; }
      @keyframes slBannerIn {
        0% { opacity: 0; transform: translate(-50%, -35%) scale(0.6); }
        12% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
        22% { transform: translate(-50%, -50%) scale(1); }
        82% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -56%) scale(1); }
      }
      .sl-win-label { font-weight: 800; letter-spacing: 0.12em; font-size: 15px; }
      .sl-win-amount { font-weight: 800; font-size: 34px; }
      .sl-win-tier-5 .sl-win-amount { font-size: 42px; }
      .sl-win-tier-5 .sl-reels-wrap { animation: slShake 520ms ease-in-out 1; }
      @keyframes slShake { 0%, 100% { transform: translate(0, 0); } 20% { transform: translate(-4px, 2px); } 40% { transform: translate(4px, -2px); } 60% { transform: translate(-3px, -2px); } 80% { transform: translate(3px, 2px); } }

      /* ================= THEME CHROME =================
         Each design scopes its reels-wrap gradient/border, payline arrow
         color, lit-cell glow, win-flash tint, and win banner colors under
         its own .sl-theme-<id> class (applied to .sl-reels-wrap) — every
         other rule above is shared structure, not appearance. */
      .sl-reels-wrap.sl-theme-default { background: linear-gradient(160deg, #1b1530 0%, #120e22 100%); border: 1px solid rgba(217, 111, 255, 0.28); box-shadow: 0 0 0 1px rgba(217, 111, 255, 0.12), 0 20px 50px -20px rgba(120, 30, 200, 0.55); }
      .sl-theme-default .sl-cell.sl-lit { background: rgba(255, 224, 130, 0.14); box-shadow: inset 0 0 0 2px #ff5fd1; }
      .sl-theme-default .sl-payline-arrow.sl-left { border-left-color: #ff5fd1; }
      .sl-theme-default .sl-payline-arrow.sl-right { border-right-color: #ff5fd1; }
      .sl-theme-default .sl-win-flash { background: radial-gradient(60% 60% at 50% 50%, rgba(255, 95, 209, 0.45), transparent 70%); }
      .sl-theme-default .sl-win-label { color: #ff5fd1; text-shadow: 0 0 18px rgba(255, 95, 209, 0.7); }
      .sl-theme-default .sl-win-amount { color: #fdf7ff; text-shadow: 0 2px 18px rgba(255, 95, 209, 0.55); }

      .sl-reels-wrap.sl-theme-fruit { background: linear-gradient(165deg, oklch(0.19 0.05 30) 0%, oklch(0.12 0.04 25) 100%); border: 1px solid oklch(0.55 0.13 70 / 0.3); box-shadow: 0 0 0 1px oklch(0.55 0.13 70 / 0.12), 0 20px 50px -20px oklch(0.2 0.08 25 / 0.6); }
      .sl-theme-fruit .sl-cell.sl-lit { background: color-mix(in oklch, oklch(0.75 0.15 70) 16%, transparent); box-shadow: inset 0 0 0 2px oklch(0.75 0.15 70); }
      .sl-theme-fruit .sl-payline-arrow.sl-left { border-left-color: oklch(0.75 0.15 70); }
      .sl-theme-fruit .sl-payline-arrow.sl-right { border-right-color: oklch(0.75 0.15 70); }
      .sl-theme-fruit .sl-win-flash { background: radial-gradient(60% 60% at 50% 50%, oklch(0.75 0.15 70 / 0.45), transparent 70%); }
      .sl-theme-fruit .sl-win-label { color: oklch(0.75 0.15 70); text-shadow: 0 0 16px oklch(0.6 0.16 40 / 0.7); }
      .sl-theme-fruit .sl-win-amount { color: oklch(0.96 0.02 70); text-shadow: 0 2px 16px oklch(0.6 0.18 30 / 0.6); }

      .sl-reels-wrap.sl-theme-egypt { background: linear-gradient(165deg, oklch(0.15 0.03 210) 0%, oklch(0.09 0.02 215) 100%); border: 1px solid oklch(0.68 0.12 85 / 0.28); box-shadow: 0 0 0 1px oklch(0.68 0.12 85 / 0.12), 0 20px 50px -20px oklch(0.1 0.03 210 / 0.65); }
      .sl-theme-egypt .sl-cell.sl-lit { background: color-mix(in oklch, oklch(0.72 0.13 85) 16%, transparent); box-shadow: inset 0 0 0 2px oklch(0.72 0.13 85); }
      .sl-theme-egypt .sl-payline-arrow.sl-left { border-left-color: oklch(0.72 0.13 85); }
      .sl-theme-egypt .sl-payline-arrow.sl-right { border-right-color: oklch(0.72 0.13 85); }
      .sl-theme-egypt .sl-win-flash { background: radial-gradient(60% 60% at 50% 50%, oklch(0.72 0.13 85 / 0.4), transparent 70%); }
      .sl-theme-egypt .sl-win-label { color: oklch(0.72 0.13 85); text-shadow: 0 0 16px oklch(0.6 0.11 195 / 0.7); }
      .sl-theme-egypt .sl-win-amount { color: oklch(0.95 0.03 85); text-shadow: 0 2px 16px oklch(0.68 0.12 85 / 0.6); }

      .sl-reels-wrap.sl-theme-sea { background: linear-gradient(165deg, oklch(0.15 0.045 255) 0%, oklch(0.08 0.03 258) 100%); border: 1px solid oklch(0.6 0.1 195 / 0.3); box-shadow: 0 0 0 1px oklch(0.6 0.1 195 / 0.12), 0 20px 50px -20px oklch(0.1 0.06 255 / 0.65); }
      .sl-theme-sea .sl-cell.sl-lit { background: color-mix(in oklch, oklch(0.72 0.12 195) 16%, transparent); box-shadow: inset 0 0 0 2px oklch(0.72 0.12 195); }
      .sl-theme-sea .sl-payline-arrow.sl-left { border-left-color: oklch(0.72 0.12 195); }
      .sl-theme-sea .sl-payline-arrow.sl-right { border-right-color: oklch(0.72 0.12 195); }
      .sl-theme-sea .sl-win-flash { background: radial-gradient(60% 60% at 50% 50%, oklch(0.72 0.12 195 / 0.4), transparent 70%); }
      .sl-theme-sea .sl-win-label { color: oklch(0.72 0.12 195); text-shadow: 0 0 16px oklch(0.65 0.15 40 / 0.6); }
      .sl-theme-sea .sl-win-amount { color: oklch(0.95 0.02 200); text-shadow: 0 2px 16px oklch(0.72 0.12 195 / 0.6); }

      /* ================= DEFAULT (NEON RUSH) ICONS ================= */
      .sl-sym-dot { --sc: #33e6ff; }
      .sl-sym-square { --sc: #4bffb0; }
      .sl-sym-diamond { --sc: #c86bff; }
      .sl-sym-star { --sc: #ff4fc3; }
      .sl-sym-seven { --sc: #ffe066; color: var(--sc); text-shadow: 0 0 14px var(--sc); }
      .sl-sym-dot::before { content: ""; width: 62%; height: 62%; border-radius: 50%; background: var(--sc); box-shadow: 0 0 14px var(--sc); }
      .sl-sym-square::before { content: ""; width: 64%; height: 64%; border-radius: 6px; background: var(--sc); box-shadow: 0 0 14px var(--sc); }
      .sl-sym-diamond::before { content: ""; width: 54%; height: 54%; transform: rotate(45deg); border-radius: 4px; background: var(--sc); box-shadow: 0 0 14px var(--sc); }
      .sl-sym-star { background: var(--sc); clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); box-shadow: 0 0 16px var(--sc); }

      /* ================= GOLDEN HARVEST (FRUIT) ICONS ================= */
      .sl-fr-cherry .sl-ball { position: absolute; bottom: 0; width: 42%; height: 42%; border-radius: 50%; background: oklch(0.55 0.19 25); box-shadow: 0 0 10px oklch(0.55 0.19 25 / 0.8); }
      .sl-fr-cherry .sl-ball.sl-l { left: 2%; }
      .sl-fr-cherry .sl-ball.sl-r { left: 40%; bottom: 6%; }
      .sl-fr-cherry .sl-stem { position: absolute; width: 2.5px; height: 52%; background: oklch(0.62 0.13 145); top: 0; border-radius: 2px; }
      .sl-fr-cherry .sl-stem.sl-l { left: 40%; transform: rotate(24deg); transform-origin: bottom center; }
      .sl-fr-cherry .sl-stem.sl-r { left: 55%; transform: rotate(-6deg); transform-origin: bottom center; }
      .sl-fr-cherry .sl-leaf { position: absolute; top: -6%; left: 58%; width: 34%; height: 22%; background: oklch(0.62 0.13 145); clip-path: polygon(0% 50%, 100% 0%, 100% 100%); box-shadow: 0 0 6px oklch(0.62 0.13 145 / 0.7); }

      .sl-fr-lemon .sl-body { width: 78%; height: 56%; border-radius: 50%; background: radial-gradient(circle at 35% 30%, oklch(0.92 0.15 100), oklch(0.78 0.16 90) 70%); transform: rotate(-28deg); box-shadow: 0 0 10px oklch(0.78 0.16 90 / 0.7); }

      .sl-fr-orange .sl-body { width: 74%; height: 74%; border-radius: 50%; background: radial-gradient(circle at 35% 30%, oklch(0.83 0.16 55), oklch(0.68 0.17 45) 75%); box-shadow: 0 0 10px oklch(0.68 0.17 45 / 0.7); }
      .sl-fr-orange .sl-leaf { position: absolute; top: 2%; right: 14%; width: 26%; height: 18%; background: oklch(0.62 0.13 145); clip-path: polygon(0% 0%, 100% 50%, 0% 100%); }

      .sl-fr-bell .sl-body { width: 62%; height: 60%; background: linear-gradient(180deg, oklch(0.82 0.14 80), oklch(0.65 0.13 70)); clip-path: polygon(50% 0%, 78% 12%, 92% 70%, 100% 82%, 0% 82%, 8% 70%, 22% 12%); box-shadow: 0 0 10px oklch(0.75 0.15 70 / 0.6); }
      .sl-fr-bell .sl-clap { position: absolute; bottom: 6%; left: 44%; width: 12%; height: 12%; border-radius: 50%; background: oklch(0.65 0.13 70); }

      .sl-fr-seven { font-weight: 800; color: oklch(0.58 0.19 25); text-shadow: 0 0 4px oklch(0.85 0.14 80), 0 0 14px oklch(0.58 0.19 25 / 0.8); }

      /* ================= PHARAOH'S FORTUNE (EGYPT) ICONS ================= */
      .sl-eg-ankh .sl-loop { position: absolute; top: 0; left: 27%; width: 46%; height: 40%; border-radius: 50%; border: 5px solid oklch(0.75 0.13 80); box-shadow: 0 0 8px oklch(0.75 0.13 80 / 0.6); }
      .sl-eg-ankh .sl-stem { position: absolute; top: 34%; left: 46%; width: 8%; height: 62%; background: oklch(0.75 0.13 80); }
      .sl-eg-ankh .sl-bar { position: absolute; top: 54%; left: 22%; width: 56%; height: 8%; background: oklch(0.75 0.13 80); }

      .sl-eg-scarab .sl-body { position: absolute; left: 16%; top: 22%; width: 68%; height: 66%; border-radius: 50%; background: linear-gradient(160deg, oklch(0.62 0.11 195), oklch(0.4 0.09 200)); box-shadow: 0 0 8px oklch(0.6 0.1 195 / 0.6); }
      .sl-eg-scarab .sl-spine { position: absolute; left: 50%; top: 26%; width: 3px; height: 58%; background: oklch(0.78 0.14 80); border-radius: 2px; box-shadow: 0 0 4px oklch(0.78 0.14 80 / 0.6); }
      .sl-eg-scarab .sl-head { position: absolute; left: 32%; top: 6%; width: 36%; height: 22%; border-radius: 50%; background: oklch(0.78 0.14 80); box-shadow: 0 0 6px oklch(0.78 0.14 80 / 0.5); }

      .sl-eg-pyramid .sl-body { position: absolute; inset: 6% 4% 0 4%; clip-path: polygon(50% 0%, 100% 100%, 0% 100%); background: linear-gradient(120deg, oklch(0.8 0.13 82), oklch(0.6 0.11 75)); box-shadow: 0 0 8px oklch(0.72 0.13 85 / 0.6); }
      .sl-eg-pyramid .sl-shade { position: absolute; inset: 20% 4% 0 50%; clip-path: polygon(0% 0%, 100% 100%, 0% 100%); background: oklch(0.45 0.08 70 / 0.55); }

      .sl-eg-eye .sl-almond { position: absolute; left: 4%; top: 36%; width: 92%; height: 30%; border-radius: 50%; background: oklch(0.75 0.13 80); }
      .sl-eg-eye .sl-pupil { position: absolute; left: 41%; top: 38%; width: 22%; height: 26%; border-radius: 50%; background: oklch(0.45 0.09 200); }
      .sl-eg-eye .sl-brow { position: absolute; left: 10%; top: 20%; width: 80%; height: 4px; border-radius: 2px; background: oklch(0.6 0.1 195); transform: rotate(-6deg); }
      .sl-eg-eye .sl-tail { position: absolute; left: 10%; top: 64%; width: 4px; height: 24%; background: oklch(0.75 0.13 80); border-radius: 2px; transform: rotate(35deg); transform-origin: top center; }
      .sl-eg-eye .sl-curl { position: absolute; left: -2%; top: 82%; width: 16%; height: 16%; border: 3px solid oklch(0.75 0.13 80); border-top: none; border-right: none; border-radius: 0 0 0 100%; }

      .sl-eg-sun .sl-disc { position: absolute; inset: 14%; border-radius: 50%; background: radial-gradient(circle at 35% 30%, oklch(0.88 0.14 85), oklch(0.68 0.15 75)); box-shadow: 0 0 6px oklch(0.85 0.14 82), 0 0 22px oklch(0.72 0.15 78 / 0.85), 0 0 40px oklch(0.65 0.13 70 / 0.5); }
      .sl-eg-sun .sl-ring { position: absolute; inset: 6%; border-radius: 50%; border: 2px solid oklch(0.75 0.13 80 / 0.6); }

      /* ================= ABYSSAL RICHES (DEEP SEA) ICONS ================= */
      .sl-sea-pearl .sl-body { position: absolute; inset: 12%; border-radius: 50%; background: radial-gradient(circle at 32% 28%, oklch(0.97 0.01 220), oklch(0.78 0.05 210) 75%); box-shadow: 0 0 10px oklch(0.78 0.08 200 / 0.6); }
      .sl-sea-pearl .sl-glint { position: absolute; top: 22%; left: 30%; width: 18%; height: 18%; border-radius: 50%; background: oklch(0.99 0 0 / 0.9); }

      .sl-sea-shell .sl-body { position: absolute; left: 6%; top: 20%; width: 88%; height: 66%; border-radius: 50% 50% 8% 8% / 60% 60% 10% 10%; background: linear-gradient(180deg, oklch(0.7 0.15 30), oklch(0.55 0.15 25)); box-shadow: 0 0 8px oklch(0.65 0.16 30 / 0.6); }
      .sl-sea-shell .sl-rib { position: absolute; bottom: 20%; width: 2px; height: 50%; background: oklch(0.85 0.08 50 / 0.7); transform-origin: bottom center; }
      .sl-sea-shell .sl-rib.sl-r1 { left: 30%; transform: rotate(-18deg); }
      .sl-sea-shell .sl-rib.sl-r2 { left: 49%; }
      .sl-sea-shell .sl-rib.sl-r3 { left: 66%; transform: rotate(18deg); }

      .sl-sea-anchor .sl-ring { position: absolute; top: 0; left: 32%; width: 36%; height: 26%; border-radius: 50%; border: 4px solid oklch(0.72 0.12 195); }
      .sl-sea-anchor .sl-stem { position: absolute; top: 24%; left: 47%; width: 6%; height: 60%; background: oklch(0.72 0.12 195); }
      .sl-sea-anchor .sl-bar { position: absolute; top: 40%; left: 18%; width: 64%; height: 6%; background: oklch(0.72 0.12 195); }
      .sl-sea-anchor .sl-arm { position: absolute; bottom: 6%; width: 34%; height: 34%; border: 6px solid oklch(0.72 0.12 195); border-top: none; border-right: none; border-radius: 0 0 0 100%; }
      .sl-sea-anchor .sl-arm.sl-l { left: 8%; }
      .sl-sea-anchor .sl-arm.sl-r { right: 8%; transform: scaleX(-1); }

      .sl-ic.sl-sea-star { clip-path: polygon(50% 4%, 62% 36%, 96% 36%, 68% 56%, 79% 90%, 50% 68%, 21% 90%, 32% 56%, 4% 36%, 38% 36%); background: linear-gradient(160deg, oklch(0.75 0.15 45), oklch(0.6 0.16 35)); box-shadow: 0 0 10px oklch(0.68 0.16 40 / 0.7); }

      .sl-sea-chest .sl-lid { position: absolute; top: 4%; left: 10%; width: 80%; height: 30%; border-radius: 10px 10px 3px 3px; background: linear-gradient(160deg, oklch(0.72 0.13 80), oklch(0.55 0.11 70)); }
      .sl-sea-chest .sl-body { position: absolute; bottom: 4%; left: 6%; width: 88%; height: 52%; border-radius: 4px; background: linear-gradient(160deg, oklch(0.5 0.1 60), oklch(0.34 0.07 50)); box-shadow: 0 0 10px oklch(0.72 0.13 80 / 0.55); }
      .sl-sea-chest .sl-lock { position: absolute; bottom: 18%; left: 42%; width: 16%; height: 16%; border-radius: 4px; background: oklch(0.78 0.14 82); box-shadow: 0 0 8px oklch(0.78 0.14 82 / 0.8); }

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
