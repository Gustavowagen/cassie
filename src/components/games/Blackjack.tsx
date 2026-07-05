import { useState } from "react";
import { ArrowLeft, Coins, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { useBlackjack } from "../../hooks/useBlackjack";
import { formatChips } from "../../lib/utils";
import { CHIPS_BY_TIER, formatChipLabel, roundMoney, TIER_LABELS, type ChipDef, type Tier } from "../../lib/stakeTiers";
import type { Card, Move, BlackjackOutcome } from "../../types";

const SUIT_GLYPH: Record<Card["suit"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED_SUITS: Card["suit"][] = ["H", "D"];

const ACTION_LABEL: Record<Move, string> = {
  hit: "Hit",
  stand: "Stand",
  double: "Double",
  split: "Split",
  insurance: "Insurance",
};

const OUTCOME_COPY: Record<BlackjackOutcome, { title: string; tone: string }> = {
  blackjack: { title: "Blackjack!", tone: "#fbbf24" },
  win: { title: "You Win", tone: "#fbbf24" },
  push: { title: "Push", tone: "#cbd5e1" },
  lose: { title: "Dealer Wins", tone: "#fca5a5" },
};

type CardSize = "normal" | "sm" | "xs";

// ---------------------------------------------------------------------------
// Playing card
// ---------------------------------------------------------------------------
function PlayingCard({
  card,
  faceDown,
  index,
  size = "normal",
}: {
  card?: Card;
  faceDown?: boolean;
  index: number;
  size?: CardSize;
}) {
  const isRed = card ? RED_SUITS.includes(card.suit) : false;
  const sizeClass =
    size === "xs"
      ? "h-16 w-[2.75rem]"
      : size === "sm"
      ? "h-20 w-[3.5rem]"
      : "h-24 w-[4.25rem] sm:h-28 sm:w-20";
  const rankClass =
    size === "xs" ? "text-xs" : size === "sm" ? "text-sm" : "text-base sm:text-lg";
  const suitSmClass =
    size === "xs" ? "text-xs" : size === "sm" ? "text-sm" : "text-base sm:text-lg";
  const suitBigClass =
    size === "xs" ? "text-lg" : size === "sm" ? "text-xl" : "text-2xl sm:text-3xl";
  return (
    <div
      className={`bj-card-deal relative ${sizeClass} shrink-0`}
      style={{ animationDelay: `${index * 110}ms` }}
    >
      {faceDown || !card ? (
        <div className="bj-card-back flex h-full w-full items-center justify-center rounded-lg">
          <div className="bj-card-back-emblem" />
        </div>
      ) : (
        <div
          className="flex h-full w-full flex-col justify-between rounded-lg bg-gradient-to-b from-white to-[#eef1f6] p-1.5 shadow-[0_6px_14px_-4px_rgba(0,0,0,0.55)] ring-1 ring-black/10"
          style={{ color: isRed ? "#c0192b" : "#16181d" }}
        >
          <div className="flex flex-col items-start leading-none">
            <span className={`${rankClass} font-bold`} style={{ fontFamily: "'Cinzel', serif" }}>
              {card.rank}
            </span>
            <span className={suitSmClass}>{SUIT_GLYPH[card.suit]}</span>
          </div>
          <span className={`self-center ${suitBigClass}`}>{SUIT_GLYPH[card.suit]}</span>
        </div>
      )}
    </div>
  );
}

function Chip({
  chip,
  onClick,
  disabled,
}: {
  chip: ChipDef;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="bj-chip group relative h-16 w-16 rounded-full transition-transform duration-150 enabled:hover:-translate-y-1.5 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-30 sm:h-[4.5rem] sm:w-[4.5rem]"
      style={{
        background: `radial-gradient(circle at 50% 38%, ${chip.face}, ${chip.ring})`,
        boxShadow: "0 6px 12px -3px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.12)",
      }}
      aria-label={`Add ${chip.value} chips`}
    >
      <span
        className="absolute inset-1.5 rounded-full border-2 border-dashed"
        style={{ borderColor: "rgba(255,255,255,0.35)" }}
      />
      <span
        className="relative text-sm font-bold tracking-tight"
        style={{ color: chip.text, fontFamily: "'Cinzel', serif" }}
      >
        {formatChipLabel(chip.value)}
      </span>
    </button>
  );
}

// A simple stacked-chip visual representing the current wager.
function ChipStack({ amount }: { amount: number }) {
  const layers = Math.min(12, Math.max(1, Math.round(amount / 500)));
  return (
    <div className="relative h-20 w-16">
      {Array.from({ length: layers }).map((_, i) => (
        <div
          key={i}
          className="absolute left-1/2 h-3.5 w-14 -translate-x-1/2 rounded-full"
          style={{
            bottom: `${i * 6}px`,
            background: "linear-gradient(180deg,#fbbf24,#b45309)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.35)",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Blackjack({
  casinoId,
  balance,
  minBet,
  maxBet,
  onExit,
}: {
  casinoId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}) {
  const { state, loading, error, start, act, reset } = useBlackjack(casinoId);
  const [bet, setBet] = useState(0);
  const [tier, setTier] = useState<Tier>("medium");

  const roundActive = state !== null && state.status !== "complete";
  const isComplete = state !== null && state.status === "complete";
  const displayBalance = state ? state.balance : balance;
  const availableBalance = displayBalance;

  const addChip = (value: number) => {
    setBet((b) => roundMoney(Math.min(maxBet, Math.min(availableBalance, b + value))));
  };

  const betValid = bet >= minBet && bet <= maxBet && bet <= availableBalance;

  const handleDeal = async () => {
    if (!betValid) return;
    try {
      if (isComplete) reset();
      await start(bet);
    } catch {
      /* error surfaced via hook state */
    }
  };

  const handleAction = async (move: Move) => {
    try {
      await act(move);
    } catch {
      /* error surfaced via hook state */
    }
  };

  return (
    <div className="bj-root relative h-[92vh] min-h-[700px] max-h-[900px] w-full overflow-hidden text-white">
      <BlackjackStyles />

      {/* Atmosphere: felt, vignette, grain */}
      <div className="bj-felt absolute inset-0" />
      <div className="bj-vignette absolute inset-0" />
      <div className="bj-grain absolute inset-0" />

      <div className="relative z-10 mx-auto flex h-full max-w-3xl flex-col overflow-hidden px-4 pb-5 pt-4">
        {/* Top bar */}
        <header className="flex shrink-0 items-center justify-between">
          <button
            type="button"
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-black/30 px-3 py-1.5 text-sm text-amber-100/90 backdrop-blur transition-colors hover:bg-black/50"
          >
            <ArrowLeft className="h-4 w-4" />
            Leave
          </button>
          <div className="flex items-center gap-2 rounded-full border border-amber-300/40 bg-black/40 px-4 py-1.5 backdrop-blur">
            <Coins className="h-4 w-4 text-amber-300" />
            <span className="font-semibold tracking-wide text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>
              {formatChips(displayBalance)}
            </span>
          </div>
        </header>

        {/* Title arch */}
        <div className="mt-2 shrink-0 text-center">
          <h1
            className="text-2xl font-bold uppercase tracking-[0.3em] text-amber-200 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] sm:text-3xl"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            Blackjack
          </h1>
          <p className="mt-0.5 text-[0.7rem] uppercase tracking-[0.35em] text-amber-100/50">
            Dealer stands on 17 &middot; Pays 3:2
          </p>
        </div>

        {/* The felt table */}
        <div className="bj-table relative mt-4 flex min-h-0 flex-1 flex-col rounded-[2rem] border border-amber-300/25 p-3 sm:p-4">
          {/* Dealer area */}
          <section className="flex shrink-0 flex-col items-center">
            <LabelTag>Dealer</LabelTag>
            {state ? (
              <>
                <div className="mt-3 flex items-end gap-[-1rem]">
                  <div className="flex -space-x-6 sm:-space-x-7">
                    {state.dealer.cards.map((c, i) => (
                      <PlayingCard key={`d-${i}`} card={c} index={i} />
                    ))}
                    {state.dealer.hidden && (
                      <PlayingCard faceDown index={state.dealer.cards.length} />
                    )}
                  </div>
                </div>
                <ValuePill
                  value={state.dealer.hidden ? null : state.dealer.value}
                  soft={!state.dealer.hidden && state.dealer.soft}
                />
              </>
            ) : (
              <div className="mt-3 flex -space-x-6">
                <div className="bj-card-back h-24 w-[4.25rem] rounded-lg opacity-40 sm:h-28 sm:w-20">
                  <div className="bj-card-back-emblem" />
                </div>
                <div className="bj-card-back h-24 w-[4.25rem] rounded-lg opacity-40 sm:h-28 sm:w-20">
                  <div className="bj-card-back-emblem" />
                </div>
              </div>
            )}
          </section>

          {/* Center divider with table arc text */}
          <div className="relative my-3 flex shrink-0 items-center justify-center">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-300/30 to-transparent" />
            <span className="px-4 text-center text-[0.6rem] uppercase tracking-[0.3em] text-amber-100/40">
              Insurance pays 2 to 1
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-300/30 to-transparent" />
          </div>

          {/* Player area */}
          <section className="flex min-h-0 flex-1 flex-col items-center justify-end">
            {state ? (
              (() => {
                const handCount = state.hands.length;
                const cardSize: CardSize =
                  handCount >= 3 ? "xs" : handCount >= 2 ? "sm" : "normal";
                const overlapClass =
                  handCount >= 3
                    ? "flex -space-x-3"
                    : handCount >= 2
                    ? "flex -space-x-4"
                    : "flex -space-x-6 sm:-space-x-7";
                return (
                  <div className="flex w-full flex-col items-center gap-2">
                    <div className="flex w-full flex-wrap items-end justify-center gap-3">
                      {state.hands.map((hand, hi) => {
                        const isActive =
                          state.status === "player_turn" && hi === state.activeHand;
                        return (
                          <div
                            key={`h-${hi}`}
                            className={[
                              "flex flex-col items-center rounded-2xl px-2 py-2 transition-all duration-300",
                              isActive
                                ? "bj-active-hand bg-amber-300/10"
                                : "opacity-80",
                            ].join(" ")}
                          >
                            <div className={overlapClass}>
                              {hand.cards.map((c, i) => (
                                <PlayingCard
                                  key={`h-${hi}-${i}`}
                                  card={c}
                                  index={i}
                                  size={cardSize}
                                />
                              ))}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <ValuePill value={hand.value} soft={hand.soft} />
                              {hand.doubled && (
                                <span className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[0.6rem] uppercase tracking-widest text-amber-200">
                                  Doubled
                                </span>
                              )}
                            </div>
                            <span className="mt-1 text-[0.65rem] uppercase tracking-widest text-amber-100/60">
                              Bet {formatChips(hand.bet)}
                            </span>
                            {isComplete && hand.outcome && (
                              <HandOutcome outcome={hand.outcome} payout={hand.payout} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {isComplete && <ResultBanner state={state} />}
                  </div>
                );
              })()
            ) : (
              <div className="flex flex-col items-center pb-2">
                {bet > 0 && <ChipStack amount={bet} />}
                <div
                  className="mt-2 rounded-full border-2 border-dashed border-amber-300/40 px-6 py-2 text-sm uppercase tracking-[0.25em] text-amber-100/70"
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  Place your bet
                </div>
              </div>
            )}
          </section>
        </div>

        {error && (
          <div className="mt-2 shrink-0 rounded-lg border border-red-400/40 bg-red-950/50 px-4 py-2 text-center text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Control deck */}
        <div className="mt-3 shrink-0">
          {roundActive ? (
            <ActionBar
              actions={state.legalActions}
              loading={loading}
              onAction={handleAction}
            />
          ) : (
            <BettingControls
              bet={bet}
              minBet={minBet}
              maxBet={maxBet}
              availableBalance={availableBalance}
              betValid={betValid}
              loading={loading}
              isComplete={isComplete}
              tier={tier}
              onTierChange={setTier}
              onAddChip={addChip}
              onClear={() => setBet(0)}
              onDeal={handleDeal}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------
function LabelTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-full border border-amber-300/30 bg-black/30 px-3 py-0.5 text-[0.65rem] uppercase tracking-[0.3em] text-amber-100/70"
      style={{ fontFamily: "'Cinzel', serif" }}
    >
      {children}
    </span>
  );
}

function ValuePill({ value, soft }: { value: number | null; soft?: boolean }) {
  const display =
    value === null ? "?" : soft ? `${value - 10}/${value}` : String(value);
  return (
    <div className="mt-2 flex h-7 min-w-[2.5rem] items-center justify-center rounded-full border border-amber-300/40 bg-black/50 px-3 text-sm font-semibold text-amber-100 backdrop-blur">
      {display}
    </div>
  );
}

function HandOutcome({
  outcome,
  payout,
}: {
  outcome: BlackjackOutcome;
  payout?: number;
}) {
  if (outcome === "lose") return null;
  const copy = OUTCOME_COPY[outcome];
  return (
    <div className="mt-2 flex flex-col items-center">
      <span
        className="text-sm font-bold uppercase tracking-[0.2em]"
        style={{ color: copy.tone, fontFamily: "'Cinzel', serif" }}
      >
        {copy.title}
      </span>
      {typeof payout === "number" && payout > 0 && (
        <span className="text-xs text-amber-200/80">+{formatChips(payout)}</span>
      )}
    </div>
  );
}

function ResultBanner({ state }: { state: import("../../types").BlackjackState }) {
  const totalPayout = state.hands.reduce((sum, h) => sum + (h.payout ?? 0), 0);
  const anyWin = state.hands.some(
    (h) => h.outcome === "win" || h.outcome === "blackjack"
  );
  const allLose = state.hands.every((h) => h.outcome === "lose");

  if (allLose) return null;

  const title = anyWin ? "Winner" : "Push";
  const tone = anyWin ? "#fbbf24" : "#cbd5e1";

  return (
    <div className="bj-banner mt-2 flex w-full items-center justify-center rounded-xl border border-amber-300/40 bg-gradient-to-b from-black/60 to-black/30 py-2 backdrop-blur">
      <div className="flex flex-col items-center">
        <span
          className="text-xl font-bold uppercase tracking-[0.35em]"
          style={{ color: tone, fontFamily: "'Cinzel', serif" }}
        >
          {title}
        </span>
        {totalPayout > 0 && (
          <span className="text-sm text-amber-200/90">
            Returned {formatChips(totalPayout)} chips
          </span>
        )}
      </div>
    </div>
  );
}

function ActionBar({
  actions,
  loading,
  onAction,
}: {
  actions: Move[];
  loading: boolean;
  onAction: (m: Move) => void;
}) {
  const order: Move[] = ["hit", "stand", "double", "split", "insurance"];
  const ordered = order.filter((m) => actions.includes(m));
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {ordered.map((move) => {
        const primary = move === "hit" || move === "stand";
        return (
          <button
            key={move}
            type="button"
            disabled={loading}
            onClick={() => onAction(move)}
            className={[
              "bj-action min-w-[5.5rem] flex-1 rounded-xl px-5 py-3 text-sm font-bold uppercase tracking-[0.15em] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40",
              primary
                ? "bj-action-primary text-emerald-950"
                : "border border-amber-300/40 bg-black/40 text-amber-100 hover:bg-black/60",
            ].join(" ")}
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            {ACTION_LABEL[move]}
          </button>
        );
      })}
    </div>
  );
}

function BettingControls({
  bet,
  minBet,
  maxBet,
  availableBalance,
  betValid,
  loading,
  isComplete,
  tier,
  onTierChange,
  onAddChip,
  onClear,
  onDeal,
}: {
  bet: number;
  minBet: number;
  maxBet: number;
  availableBalance: number;
  betValid: boolean;
  loading: boolean;
  isComplete: boolean;
  tier: Tier;
  onTierChange: (t: Tier) => void;
  onAddChip: (v: number) => void;
  onClear: () => void;
  onDeal: () => void;
}) {
  const chips = CHIPS_BY_TIER[tier];
  return (
    <div className="flex flex-col gap-2">
      {/* Stake tier selector */}
      <div className="flex items-center justify-center gap-1">
        {(["low", "medium", "high"] as Tier[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTierChange(t)}
            className={[
              "rounded-lg px-4 py-1 text-xs font-bold uppercase tracking-[0.2em] transition-all duration-150",
              tier === t
                ? "bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/50"
                : "text-amber-100/40 hover:text-amber-100/70",
            ].join(" ")}
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            {TIER_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Chip buttons */}
      <div className="flex items-center justify-center gap-3">
        {chips.map((chip) => {
          const wouldExceed = roundMoney(bet + chip.value) > maxBet;
          const tooPoor = chip.value > availableBalance;
          return (
            <Chip
              key={chip.value}
              chip={chip}
              disabled={loading || wouldExceed || tooPoor}
              onClick={() => onAddChip(chip.value)}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[0.65rem] uppercase tracking-[0.25em] text-amber-100/50">
            Current bet
          </span>
          <span
            className="text-2xl font-bold text-amber-200"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            {formatChips(bet)}
          </span>
          <span className="text-[0.65rem] text-amber-100/40">
            Min {formatChips(minBet)} &middot; Max {formatChips(maxBet)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={loading || bet === 0}
            className="flex items-center gap-1.5 rounded-xl border border-amber-300/30 bg-black/40 px-4 py-3 text-sm text-amber-100 transition-colors hover:bg-black/60 disabled:opacity-30"
          >
            <RotateCcw className="h-4 w-4" />
            Clear
          </button>
          <Button
            onClick={onDeal}
            disabled={!betValid || loading}
            className="bj-deal h-auto rounded-xl px-8 py-3 text-base font-bold uppercase tracking-[0.2em] text-emerald-950"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            {loading ? "Dealing…" : isComplete ? "New hand" : "Deal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoped styles: felt, grain, animations, fonts
// ---------------------------------------------------------------------------
function BlackjackStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&display=swap');

      .bj-root { background: #06140d; }

      .bj-felt {
        background:
          radial-gradient(ellipse at 50% 22%, #1f6b45 0%, #115233 42%, #0a3a22 72%, #062012 100%);
      }
      .bj-felt::after {
        content: "";
        position: absolute; inset: 0;
        background-image:
          repeating-linear-gradient(45deg, rgba(255,255,255,0.012) 0 2px, transparent 2px 4px),
          repeating-linear-gradient(-45deg, rgba(0,0,0,0.05) 0 2px, transparent 2px 4px);
      }
      .bj-vignette {
        background: radial-gradient(ellipse at 50% 40%, transparent 45%, rgba(0,0,0,0.55) 100%);
        pointer-events: none;
      }
      .bj-grain {
        opacity: 0.05; pointer-events: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }

      .bj-table {
        background:
          radial-gradient(ellipse at 50% 35%, rgba(46,140,90,0.55) 0%, rgba(10,58,34,0.35) 70%, transparent 100%);
        box-shadow:
          inset 0 0 60px rgba(0,0,0,0.45),
          inset 0 0 0 6px rgba(212,175,55,0.08),
          0 30px 60px -30px rgba(0,0,0,0.8);
      }

      .bj-card-back {
        background:
          repeating-linear-gradient(45deg, #7a1020 0 6px, #5e0c19 6px 12px);
        border: 2px solid #d4af37;
        box-shadow: 0 6px 14px -4px rgba(0,0,0,0.6);
        position: relative;
      }
      .bj-card-back-emblem {
        position: absolute; inset: 6px;
        border: 1px solid rgba(212,175,55,0.7);
        border-radius: 4px;
        background:
          radial-gradient(circle at 50% 50%, rgba(212,175,55,0.35) 0%, transparent 60%);
      }

      .bj-active-hand {
        box-shadow: 0 0 0 1px rgba(251,191,36,0.5), 0 0 26px -4px rgba(251,191,36,0.45);
      }

      .bj-action-primary {
        background: linear-gradient(180deg, #fde68a, #f0b429 55%, #c8890f);
        box-shadow: 0 6px 16px -6px rgba(240,180,41,0.7), inset 0 1px 0 rgba(255,255,255,0.5);
      }
      .bj-action-primary:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
      .bj-action:active:not(:disabled) { transform: translateY(1px); }

      .bj-deal {
        background: linear-gradient(180deg, #fde68a, #f0b429 55%, #c8890f) !important;
        box-shadow: 0 8px 20px -6px rgba(240,180,41,0.7), inset 0 1px 0 rgba(255,255,255,0.5);
      }
      .bj-deal:hover:not(:disabled) { filter: brightness(1.06); }

      .bj-banner { animation: bjBannerIn 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      @keyframes bjBannerIn {
        from { opacity: 0; transform: translateY(10px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      .bj-card-deal { animation: bjDeal 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
      @keyframes bjDeal {
        from { opacity: 0; transform: translateY(-34px) rotate(-9deg) scale(0.9); }
        to   { opacity: 1; transform: translateY(0) rotate(0) scale(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .bj-card-deal, .bj-banner { animation: none; }
      }
    `}</style>
  );
}
