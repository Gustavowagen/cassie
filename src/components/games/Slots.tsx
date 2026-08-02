import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { formatChips } from "../../lib/utils";
import { playWinChime } from "../../lib/sound";
import { useSlots } from "../../hooks/useSlots";
import type { SlotSymbolId, SlotReel, SlotWin, FullBoardSlotWin } from "../../types";

type RewardMode = "single_row" | "full_board";
type AnySlotWin = (SlotWin | FullBoardSlotWin) & { amount: number };

// Mirrors supabase/functions/slots/engine.ts's SYMBOLS — kept as a local,
// dependency-free copy (same pattern as Dice/Roulette) purely for rendering
// and the paytable display. The server never trusts anything from here; it
// recomputes the real outcome and payout itself.
interface ClientSymbol {
  id: SlotSymbolId;
  cls: string;
  label: string;
  pay: { 3: number; 4: number; 5: number };
}
const CLIENT_SYMBOLS: ClientSymbol[] = [
  { id: "dot", cls: "sl-sym-dot", label: "", pay: { 3: 1, 4: 3, 5: 33 } },
  { id: "square", cls: "sl-sym-square", label: "", pay: { 3: 1.5, 4: 4.5, 5: 48 } },
  { id: "diamond", cls: "sl-sym-diamond", label: "", pay: { 3: 2, 4: 6.5, 5: 70 } },
  { id: "star", cls: "sl-sym-star", label: "", pay: { 3: 2.5, 4: 11, 5: 115 } },
  { id: "seven", cls: "sl-sym-seven", label: "7", pay: { 3: 4.5, 4: 19, 5: 240 } },
];
const SYMBOL_BY_ID = Object.fromEntries(CLIENT_SYMBOLS.map((s) => [s.id, s])) as Record<SlotSymbolId, ClientSymbol>;

// Mirrors supabase/functions/slots/engine.ts's FULL_BOARD_SYMBOLS — pay at
// tier 0 (7-8 cells), tier 1 (9-10 cells), tier 2 (11-15 cells).
interface ClientFullBoardSymbol {
  id: SlotSymbolId;
  cls: string;
  label: string;
  pay: [number, number, number];
}
const CLIENT_FULL_BOARD_SYMBOLS: ClientFullBoardSymbol[] = [
  { id: "dot", cls: "sl-sym-dot", label: "", pay: [2, 6, 21] },
  { id: "square", cls: "sl-sym-square", label: "", pay: [3, 9, 32] },
  { id: "diamond", cls: "sl-sym-diamond", label: "", pay: [4, 12, 42] },
  { id: "star", cls: "sl-sym-star", label: "", pay: [6, 18, 63] },
  { id: "seven", cls: "sl-sym-seven", label: "7", pay: [10, 30, 105] },
];

// Maps a win's raw count to the existing 3/4/5 CSS win-tier hooks
// (sl-win-tier-3/4/5), so full-board reuses the same banner/shake styling
// as single-row without any new CSS.
function winTier(rewardMode: RewardMode, count: number): 3 | 4 | 5 {
  if (rewardMode === "full_board") {
    if (count >= 11) return 5;
    if (count >= 9) return 4;
    return 3;
  }
  return count >= 5 ? 5 : count === 4 ? 4 : 3;
}

function randomSymbolId(): SlotSymbolId {
  return CLIENT_SYMBOLS[Math.floor(Math.random() * CLIENT_SYMBOLS.length)].id;
}

// Reel-drop timing: each reel starts REEL_STAGGER_MS after the previous one
// and takes REEL_DROP_MS to land — must match the CSS animation-duration /
// animation-delay values in SlotsStyles below. The true outcome (and the
// balance credit for any payout) isn't revealed until this has fully played.
const REEL_STAGGER_MS = 140;
const REEL_DROP_MS = 950;
const REVEAL_MS = 4 * REEL_STAGGER_MS + REEL_DROP_MS + 140; // last reel's delay + duration + buffer

const PARTICLE_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// 18-cell strip: 15 cosmetic filler symbols (never part of the real outcome,
// just motion-blur padding) followed by the server's actual top/mid/bottom —
// the CSS drop animation lands exactly on those last 3 cells.
function buildStrip(reel: SlotReel): SlotSymbolId[] {
  const filler = Array.from({ length: 15 }, () => randomSymbolId());
  return [...filler, reel.top, reel.mid, reel.bottom];
}

interface Props {
  casinoId: string;
  gameId: string;
  rewardMode: RewardMode;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}

export function Slots({ casinoId, gameId, rewardMode, balance: initialBalance, minBet, maxBet, onExit }: Props) {
  const { loading, error: spinError, spin: spinSlots } = useSlots(casinoId, gameId);
  const [localBalance, setLocalBalance] = useState(initialBalance);
  const [betText, setBetText] = useState(String(minBet));
  const [formError, setFormError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reels, setReels] = useState<SlotReel[]>(() =>
    Array.from({ length: 5 }, () => ({ top: randomSymbolId(), mid: randomSymbolId(), bottom: randomSymbolId() }))
  );
  const [strips, setStrips] = useState<SlotSymbolId[][]>([]);
  const [win, setWin] = useState<AnySlotWin | null>(null);
  const [winId, setWinId] = useState(0);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    };
  }, []);

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

  const tier = win ? winTier(rewardMode, win.count) : null;
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
      className="relative bg-card rounded-2xl overflow-hidden flex flex-col"
      style={{ width: "min(96vw, 1360px)", height: "min(92vh, 800px)" }}
    >
      <SlotsStyles />
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div>
          <p className="font-bold text-base">Neon Rush</p>
          <p className="text-xs text-muted-foreground">Balance: {formatChips(localBalance)} chips</p>
        </div>
        <div className="flex items-center gap-3">
          <BackdropToggleButton />
          <MuteButton />
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

      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-auto">
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
            <p className="text-xs text-muted-foreground">
              {rewardMode === "full_board" ? "Paytable (7-8 · 9-10 · 11+)" : "Paytable (3× · 4× · 5×)"}
            </p>
            {rewardMode === "full_board"
              ? CLIENT_FULL_BOARD_SYMBOLS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="sl-sym-mini">
                      <span className={`sl-sym ${s.cls}`}>{s.label}</span>
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {s.pay[0]}x · {s.pay[1]}x · {s.pay[2]}x
                    </span>
                  </div>
                ))
              : CLIENT_SYMBOLS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="sl-sym-mini">
                      <span className={`sl-sym ${s.cls}`}>{s.label}</span>
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {s.pay[3]}x · {s.pay[4]}x · {s.pay[5]}x
                    </span>
                  </div>
                ))}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-5 min-w-0">
          <div className="sl-reels-wrap">
            <div className="sl-payline-arrow sl-left" />
            <div className="sl-payline-arrow sl-right" />
            <div className="sl-reels">
              {reels.map((reel, i) => {
                const isLitTop = rewardMode === "full_board" && Boolean(fullBoardLit?.has(`${i}:top`));
                const isLitMid =
                  rewardMode === "full_board"
                    ? Boolean(fullBoardLit?.has(`${i}:mid`))
                    : Boolean(win && (win as SlotWin).positions.includes(i));
                const isLitBottom = rewardMode === "full_board" && Boolean(fullBoardLit?.has(`${i}:bottom`));
                const strip = strips[i];
                return (
                  <div className="sl-reel" key={i}>
                    {spinning && strip ? (
                      <div className="sl-reel-strip sl-spin">
                        {strip.map((sym, k) => (
                          <div className="sl-cell" key={k}>
                            <span className={`sl-sym ${SYMBOL_BY_ID[sym].cls}`}>{SYMBOL_BY_ID[sym].label}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sl-reel-static">
                        <div className={`sl-cell ${isLitTop ? "sl-lit" : ""}`}>
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.top].cls}`}>{SYMBOL_BY_ID[reel.top].label}</span>
                        </div>
                        <div className={`sl-cell sl-mid ${isLitMid ? "sl-lit" : ""}`}>
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.mid].cls}`}>{SYMBOL_BY_ID[reel.mid].label}</span>
                        </div>
                        <div className={`sl-cell ${isLitBottom ? "sl-lit" : ""}`}>
                          <span className={`sl-sym ${SYMBOL_BY_ID[reel.bottom].cls}`}>{SYMBOL_BY_ID[reel.bottom].label}</span>
                        </div>
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
    </div>
  );
}

function SlotsStyles() {
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
        background: linear-gradient(160deg, #1b1530 0%, #120e22 100%);
        border: 1px solid rgba(217, 111, 255, 0.28);
        box-shadow: 0 0 0 1px rgba(217, 111, 255, 0.12), 0 20px 50px -20px rgba(120, 30, 200, 0.55);
      }
      .sl-reels { display: grid; grid-template-columns: repeat(5, var(--cell)); gap: 8px; }
      .sl-reel { width: var(--cell); height: calc(3 * var(--cell)); overflow: hidden; border-radius: 10px; position: relative; background: rgba(0,0,0,0.25); }
      .sl-reel-static, .sl-reel-strip { display: flex; flex-direction: column; }
      .sl-cell { width: var(--cell); height: var(--cell); display: flex; align-items: center; justify-content: center; flex: none; }
      .sl-cell.sl-mid { position: relative; }
      .sl-cell.sl-lit { background: rgba(255, 224, 130, 0.14); box-shadow: inset 0 0 0 2px #ff5fd1; }

      .sl-sym { width: 56%; height: 56%; display: flex; align-items: center; justify-content: center; position: relative; font-weight: 700; font-size: 24px; }
      .sl-sym-mini { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; }
      .sl-sym-mini .sl-sym { width: 100%; height: 100%; font-size: 12px; }
      .sl-sym-dot { --sc: #33e6ff; }
      .sl-sym-square { --sc: #4bffb0; }
      .sl-sym-diamond { --sc: #c86bff; }
      .sl-sym-star { --sc: #ff4fc3; }
      .sl-sym-seven { --sc: #ffe066; color: var(--sc); text-shadow: 0 0 14px var(--sc); }
      .sl-sym-dot::before { content: ""; width: 62%; height: 62%; border-radius: 50%; background: var(--sc); box-shadow: 0 0 14px var(--sc); }
      .sl-sym-square::before { content: ""; width: 64%; height: 64%; border-radius: 6px; background: var(--sc); box-shadow: 0 0 14px var(--sc); }
      .sl-sym-diamond::before { content: ""; width: 54%; height: 54%; transform: rotate(45deg); border-radius: 4px; background: var(--sc); box-shadow: 0 0 14px var(--sc); }
      .sl-sym-star { background: var(--sc); clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); box-shadow: 0 0 16px var(--sc); }

      @keyframes slReelDrop {
        0% { transform: translateY(0); filter: blur(6px); }
        70% { filter: blur(4px); }
        100% { transform: translateY(calc(-15 * var(--cell))); filter: blur(0); }
      }
      .sl-reel-strip.sl-spin { animation: slReelDrop ${REEL_DROP_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
      .sl-reel:nth-child(1) .sl-reel-strip.sl-spin { animation-delay: 0ms; }
      .sl-reel:nth-child(2) .sl-reel-strip.sl-spin { animation-delay: ${REEL_STAGGER_MS}ms; }
      .sl-reel:nth-child(3) .sl-reel-strip.sl-spin { animation-delay: ${REEL_STAGGER_MS * 2}ms; }
      .sl-reel:nth-child(4) .sl-reel-strip.sl-spin { animation-delay: ${REEL_STAGGER_MS * 3}ms; }
      .sl-reel:nth-child(5) .sl-reel-strip.sl-spin { animation-delay: ${REEL_STAGGER_MS * 4}ms; }

      .sl-payline-arrow { position: absolute; top: calc(14px + 1.5 * var(--cell)); width: 0; height: 0; transform: translateY(-50%); z-index: 1; }
      .sl-payline-arrow.sl-left { left: 2px; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 8px solid #ff5fd1; }
      .sl-payline-arrow.sl-right { right: 2px; border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-right: 8px solid #ff5fd1; }

      .sl-win-flash { position: absolute; inset: 0; border-radius: 16px; pointer-events: none; background: radial-gradient(60% 60% at 50% 50%, rgba(255, 95, 209, 0.45), transparent 70%); opacity: 0; animation: slFlashPulse 900ms ease-out 2; }
      @keyframes slFlashPulse { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }

      .sl-win-banner { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%) scale(0.7); text-align: center; pointer-events: none; opacity: 0; animation: slBannerIn 2400ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards; z-index: 3; }
      @keyframes slBannerIn {
        0% { opacity: 0; transform: translate(-50%, -35%) scale(0.6); }
        12% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
        22% { transform: translate(-50%, -50%) scale(1); }
        82% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -56%) scale(1); }
      }
      .sl-win-label { font-weight: 800; letter-spacing: 0.12em; font-size: 15px; color: #ff5fd1; text-shadow: 0 0 18px rgba(255, 95, 209, 0.7); }
      .sl-win-amount { font-weight: 800; font-size: 34px; color: #fdf7ff; text-shadow: 0 2px 18px rgba(255, 95, 209, 0.55); }
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
