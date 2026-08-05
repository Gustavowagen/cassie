import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Coins, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { MuteButton } from "../ui/MuteButton";
import { BackdropToggleButton } from "../ui/BackdropToggleButton";
import { GameInfoButton } from "../ui/GameInfoButton";
import { GameInfoPanel } from "../ui/GameInfoPanel";
import { GAME_INFO } from "../../lib/gameInfo";
import { useBlackjack } from "../../hooks/useBlackjack";
import { formatChips } from "../../lib/utils";
import { playCardFlick } from "../../lib/sound";
import { CHIPS_BY_TIER, formatChipLabel, roundMoney, TIER_LABELS, type ChipDef, type Tier } from "../../lib/stakeTiers";
import type { Card, Move, BlackjackOutcome, BlackjackState } from "../../types";

const SUIT_GLYPH: Record<Card["suit"], string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RED_SUITS: Card["suit"][] = ["H", "D"];

// Shared frosted-glass surface — same device as the homepage hero (Home.tsx).
const GLASS = "bg-white/5 backdrop-blur-xl border border-white/10";
const CTA_GRADIENT = "bg-gradient-to-r from-primary to-indigo-400 hover:opacity-90";
const GRADIENT_TEXT = "bg-gradient-to-r from-violet-300 via-indigo-300 to-violet-300 bg-clip-text text-transparent";

const ACTION_LABEL: Record<Move, string> = {
  hit: "Hit",
  stand: "Stand",
  double: "Double",
  split: "Split",
  insurance: "Insurance",
};

const OUTCOME_COPY: Record<BlackjackOutcome, { title: string; gradient: boolean; tone?: string }> = {
  blackjack: { title: "Blackjack!", gradient: true },
  win: { title: "You Win", gradient: true },
  push: { title: "Push", gradient: false, tone: "#cbd5e1" },
  lose: { title: "Dealer Wins", gradient: false, tone: "#fca5a5" },
};

type CardSize = "normal" | "sm" | "xs";

// Card width/overlap in px, matching the Tailwind classes in PlayingCard/
// DealerHoleCard exactly (w-20/w-24, -space-x-7/-8, w-[4rem]/-space-x-5,
// w-[3.25rem]/-space-x-4). Used to compute a row's natural width without
// needing a DOM measurement round-trip per candidate size.
const CARD_METRICS: Record<CardSize, { width: number; overlap: number; widthSm?: number; overlapSm?: number }> = {
  normal: { width: 80, overlap: 28, widthSm: 96, overlapSm: 32 },
  sm: { width: 64, overlap: 20 },
  xs: { width: 52, overlap: 16 },
};

const OVERLAP_CLASS: Record<CardSize, string> = {
  normal: "flex -space-x-7 sm:-space-x-8",
  sm: "flex -space-x-5",
  xs: "flex -space-x-4",
};

function rowWidthFor(count: number, size: CardSize, isSmUp: boolean): number {
  if (count <= 0) return 0;
  const m = CARD_METRICS[size];
  const width = isSmUp && m.widthSm ? m.widthSm : m.width;
  const overlap = isSmUp && m.overlapSm ? m.overlapSm : m.overlap;
  return width + (count - 1) * (width - overlap);
}

// Cards only shrink when they'd actually overflow the space available for
// their row — never just because a hand grew from hitting. Splitting or a
// narrow viewport reduce the available width, which is what can push a row
// down a size tier.
function pickCardSize(count: number, availableWidth: number, isSmUp: boolean): CardSize {
  const tiers: CardSize[] = ["normal", "sm", "xs"];
  for (const size of tiers) {
    if (rowWidthFor(count, size, isSmUp) <= availableWidth) return size;
  }
  return "xs";
}

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
      ? "h-20 w-[3.25rem]"
      : size === "sm"
      ? "h-24 w-[4rem]"
      : "h-28 w-20 sm:h-32 sm:w-24";
  const rankClass =
    size === "xs" ? "text-sm" : size === "sm" ? "text-base" : "text-lg sm:text-xl";
  const suitSmClass =
    size === "xs" ? "text-sm" : size === "sm" ? "text-base" : "text-lg sm:text-xl";
  const suitBigClass =
    size === "xs" ? "text-xl" : size === "sm" ? "text-2xl" : "text-3xl sm:text-4xl";
  return (
    <div
      className={`bj-card-deal relative ${sizeClass} shrink-0`}
      style={{ animationDelay: `${index * 110}ms` }}
    >
      {faceDown || !card ? (
        <div className="bj-card-back h-full w-full rounded-lg" />
      ) : (
        <div
          className="flex h-full w-full flex-col justify-between rounded-lg bg-white p-1.5 shadow-[0_6px_14px_-4px_rgba(0,0,0,0.5)] ring-1 ring-black/10"
          style={{ color: isRed ? "#e5484d" : "#14161c" }}
        >
          <div className="flex flex-col items-start leading-none">
            <span className={`${rankClass} font-bold`}>{card.rank}</span>
            <span className={suitSmClass}>{SUIT_GLYPH[card.suit]}</span>
          </div>
          <span className={`self-center ${suitBigClass}`}>{SUIT_GLYPH[card.suit]}</span>
        </div>
      )}
    </div>
  );
}

// The dealer's hole card: a real 3D flip from back to face the instant the
// server reveals it (`hidden` flips false), rather than a swap-in-place.
function DealerHoleCard({
  card,
  revealed,
  index,
  size = "normal",
}: {
  card?: Card;
  revealed: boolean;
  index: number;
  size?: CardSize;
}) {
  const isRed = card ? RED_SUITS.includes(card.suit) : false;
  const sizeClass =
    size === "xs"
      ? "h-20 w-[3.25rem]"
      : size === "sm"
      ? "h-24 w-[4rem]"
      : "h-28 w-20 sm:h-32 sm:w-24";
  const rankClass =
    size === "xs" ? "text-sm" : size === "sm" ? "text-base" : "text-lg sm:text-xl";
  const suitSmClass =
    size === "xs" ? "text-sm" : size === "sm" ? "text-base" : "text-lg sm:text-xl";
  const suitBigClass =
    size === "xs" ? "text-xl" : size === "sm" ? "text-2xl" : "text-3xl sm:text-4xl";
  return (
    <div
      className={`bj-flip-outer bj-card-deal relative ${sizeClass} shrink-0`}
      style={{ animationDelay: `${index * 110}ms` }}
    >
      <div className={`bj-flip-inner ${revealed ? "bj-flipped" : ""}`}>
        <div className="bj-flip-face">
          <div className="bj-card-back h-full w-full rounded-lg" />
        </div>
        <div className="bj-flip-face bj-flip-face-front">
          <div
            className="flex h-full w-full flex-col justify-between rounded-lg bg-white p-1.5 shadow-[0_6px_14px_-4px_rgba(0,0,0,0.5)] ring-1 ring-black/10"
            style={{ color: isRed ? "#e5484d" : "#14161c" }}
          >
            {card && (
              <>
                <div className="flex flex-col items-start leading-none">
                  <span className={`${rankClass} font-bold`}>{card.rank}</span>
                  <span className={suitSmClass}>{SUIT_GLYPH[card.suit]}</span>
                </div>
                <span className={`self-center ${suitBigClass}`}>{SUIT_GLYPH[card.suit]}</span>
              </>
            )}
          </div>
        </div>
      </div>
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
      className="bj-chip group relative h-14 w-14 rounded-full transition-transform duration-150 enabled:hover:-translate-y-1.5 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-30 sm:h-16 sm:w-16"
      style={{
        background: `radial-gradient(circle at 35% 30%, ${chip.face}, ${chip.ring} 75%)`,
        boxShadow: "0 6px 12px -3px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.12)",
      }}
      aria-label={`Add ${chip.value} chips`}
    >
      <span
        className="absolute inset-1.5 rounded-full border-2 border-dashed"
        style={{ borderColor: "rgba(255,255,255,0.35)" }}
      />
      <span className="relative text-xs font-bold tracking-tight sm:text-sm" style={{ color: chip.text }}>
        {formatChipLabel(chip.value)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Blackjack({
  casinoId,
  gameId,
  balance,
  minBet,
  maxBet,
  onExit,
}: {
  casinoId: string;
  gameId: string;
  balance: number;
  minBet: number;
  maxBet: number;
  onExit: () => void;
}) {
  const { state, loading, error, start, act, reset } = useBlackjack(casinoId, gameId);
  const [bet, setBet] = useState(0);
  const [tier, setTier] = useState<Tier>("medium");
  const [showInfo, setShowInfo] = useState(false);
  const prevStateRef = useRef<BlackjackState | null>(null);

  // The table's content (dealer cards, divider, player hands, outcome text,
  // result banner) can outgrow the space left after the header/title/control
  // deck — especially with split hands or a blackjack payout line. Rather
  // than scroll (a scrollbar inside a felt table reads as broken) or clip,
  // measure the table's natural content height against the space actually
  // available and scale the whole thing down to fit exactly — it never needs
  // to scroll, on any screen size, hand count, or outcome text length.
  const tableBoxRef = useRef<HTMLDivElement>(null);
  const tableContentRef = useRef<HTMLDivElement>(null);
  const [tableScale, setTableScale] = useState(1);
  // Natural (unscaled) width available to a card row — used to decide when
  // a hand/dealer row actually needs to step down a card size, rather than
  // shrinking on card count alone. `transform: scale` (tableScale above)
  // doesn't affect clientWidth, so this stays accurate even while scaled.
  const [rowAvailWidth, setRowAvailWidth] = useState<number | null>(null);
  const [isSmUp, setIsSmUp] = useState(() => window.matchMedia("(min-width: 640px)").matches);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 640px)");
    const onChange = () => setIsSmUp(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useLayoutEffect(() => {
    const box = tableBoxRef.current;
    const content = tableContentRef.current;
    if (!box || !content) return;

    const recompute = () => {
      const available = box.clientHeight;
      const needed = content.scrollHeight;
      setTableScale(needed > available ? Math.max(available / needed, 0) : 1);
      setRowAvailWidth(content.clientWidth);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(box);
    ro.observe(content);
    return () => ro.disconnect();
  }, [state]);

  // Diff against the previous round state to figure out what just happened —
  // the server returns each new state atomically, so "new card" / "dealer
  // flip" / "dealer draw" are inferred from what changed rather than pushed
  // as discrete events. The hole-card reveal and a dealer draw sound
  // identical (same physical motion), so both just count as new dealer
  // cards. Sounds are staggered to roughly track the felt's per-card deal
  // animation (bj-card-deal, 110ms stagger).
  useEffect(() => {
    const prev = prevStateRef.current;
    if (state) {
      const prevPlayerCards = prev ? prev.hands.reduce((s, h) => s + h.cards.length, 0) : 0;
      const newPlayerCards = state.hands.reduce((s, h) => s + h.cards.length, 0);
      const playerCardsAdded = Math.max(0, newPlayerCards - prevPlayerCards);

      const prevDealerVisible = prev?.dealer.cards.length ?? 0;
      const dealerNewCards = Math.max(0, state.dealer.cards.length - prevDealerVisible);

      let step = 0;
      for (let i = 0; i < playerCardsAdded; i++) playCardFlick({ delay: step++ * 0.12 });
      for (let i = 0; i < dealerNewCards; i++) playCardFlick({ delay: step++ * 0.13 });
    }
    prevStateRef.current = state;
  }, [state]);

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
    <div className="bj-root relative isolate w-full h-screen h-[var(--app-vvh,100dvh)] sm:h-[92vh] sm:h-[92dvh] overflow-hidden bg-background text-white">
      <BlackjackStyles />

      {/* Ambient glow — same device as the homepage hero */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute top-24 -right-20 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
      </div>
      <div className="bj-grain pointer-events-none absolute inset-0" />

      <div className="relative z-10 mx-auto flex h-full max-w-3xl flex-col overflow-hidden px-4 pb-5 pt-4">
        {/* Top bar */}
        <header className="flex shrink-0 items-center justify-between">
          <button
            type="button"
            onClick={onExit}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white/85 transition-colors hover:bg-white/10 ${GLASS}`}
          >
            <ArrowLeft className="h-4 w-4" />
            Leave
          </button>
          <div className="flex items-center gap-2">
            <BackdropToggleButton className={`rounded-full p-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white ${GLASS}`} />
            <MuteButton className={`rounded-full p-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white ${GLASS}`} />
            <GameInfoButton
              active={showInfo}
              onClick={() => setShowInfo((v) => !v)}
              className={`rounded-full p-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white ${GLASS}`}
            />
            <div className={`flex items-center gap-2 rounded-full px-4 py-1.5 ${GLASS}`}>
              <Coins className="h-4 w-4 text-violet-300" />
              <span className="font-bold tracking-wide text-white">{formatChips(displayBalance)}</span>
            </div>
          </div>
        </header>

        {showInfo ? (
          <div className="mt-2 min-h-0 flex-1 overflow-hidden rounded-[2rem]">
            <GameInfoPanel info={GAME_INFO.blackjack} onBack={() => setShowInfo(false)} />
          </div>
        ) : (
        <>
        {/* Title */}
        <div className="mt-2 shrink-0 text-center">
          <h1 className={`text-2xl font-extrabold uppercase tracking-[0.3em] sm:text-3xl ${GRADIENT_TEXT}`}>
            Blackjack
          </h1>
          <p className="mt-0.5 text-[0.7rem] uppercase tracking-[0.35em] text-white/40">
            Dealer stands on 17 &middot; Pays 3:2
          </p>
        </div>

        {/* The table */}
        <div
          ref={tableBoxRef}
          className="bj-table relative mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] p-3 sm:p-4"
        >
        <div
          ref={tableContentRef}
          className="flex min-h-0 w-full flex-1 flex-col"
          style={tableScale < 1 ? { transform: `scale(${tableScale})`, transformOrigin: "top center" } : undefined}
        >
          {/* Dealer area */}
          <section className="flex shrink-0 flex-col items-center">
            <LabelTag>Dealer</LabelTag>
            {state ? (
              (() => {
                const dealerCardCount = state.dealer.cards.length + (state.dealer.hidden ? 1 : 0);
                const dealerAvailWidth = rowAvailWidth ?? Infinity;
                const dealerSize: CardSize = pickCardSize(dealerCardCount, dealerAvailWidth, isSmUp);
                const dealerOverlap = OVERLAP_CLASS[dealerSize];
                return (
                  <>
                    <div className={`mt-3 ${dealerOverlap}`}>
                      {state.dealer.cards[0] && (
                        <PlayingCard card={state.dealer.cards[0]} index={0} size={dealerSize} />
                      )}
                      <DealerHoleCard
                        card={state.dealer.cards[1]}
                        revealed={!state.dealer.hidden}
                        index={1}
                        size={dealerSize}
                      />
                      {state.dealer.cards.slice(2).map((c, i) => (
                        <PlayingCard key={`d-extra-${i}`} card={c} index={i + 2} size={dealerSize} />
                      ))}
                    </div>
                    <ValuePill
                      value={state.dealer.hidden ? null : state.dealer.value}
                      soft={!state.dealer.hidden && state.dealer.soft}
                    />
                  </>
                );
              })()
            ) : (
              <div className="mt-3 flex -space-x-7">
                <div className="bj-card-back h-28 w-20 rounded-lg opacity-40 sm:h-32 sm:w-24" />
                <div className="bj-card-back h-28 w-20 rounded-lg opacity-40 sm:h-32 sm:w-24" />
              </div>
            )}
          </section>

          {/* Center divider */}
          <div className="relative my-3 flex shrink-0 items-center justify-center">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            <span className="px-4 text-center text-[0.6rem] uppercase tracking-[0.3em] text-white/35">
              Insurance pays 2 to 1
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          </div>

          {/* Player area */}
          <section className="flex min-h-0 flex-1 flex-col items-center overflow-hidden">
            {state ? (
              (() => {
                return (
                  <div className="mt-auto flex w-full flex-col items-center gap-2">
                    <div className="flex w-full flex-wrap items-end justify-center gap-3">
                      {state.hands.map((hand, hi) => {
                        const isActive =
                          state.status === "player_turn" && hi === state.activeHand;
                        // Sized off the width actually available for this
                        // hand's row, not raw card count — hitting alone
                        // never shrinks the cards. Crowding from multiple
                        // hands is handled by flex-wrap (extra hands drop to
                        // a new row) and the table's own auto-scale-to-fit;
                        // a hand only steps down a size tier when its own
                        // row would otherwise overflow (e.g. a split hand
                        // sharing a row, or a narrow viewport).
                        const handAvailWidth = Math.max((rowAvailWidth ?? Infinity) - 16, 0);
                        const cardSize: CardSize = pickCardSize(hand.cards.length, handAvailWidth, isSmUp);
                        const overlapClass = OVERLAP_CLASS[cardSize];
                        return (
                          <div
                            key={`h-${hi}`}
                            className={[
                              "flex flex-col items-center rounded-2xl px-2 py-2 transition-all duration-300",
                              isActive ? "bj-active-hand bg-primary/10" : "opacity-80",
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
                              <ValuePill
                                value={hand.value}
                                soft={hand.soft}
                                loss={isComplete && hand.outcome === "lose"}
                              />
                              {hand.doubled && (
                                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] uppercase tracking-widest text-white/70">
                                  Doubled
                                </span>
                              )}
                            </div>
                            <span className="mt-1 text-[0.65rem] uppercase tracking-widest text-white/40">
                              Bet {formatChips(hand.bet)}
                            </span>
                            {isComplete && hand.outcome && (
                              <HandOutcome outcome={hand.outcome} payout={hand.payout} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {isComplete && <ResultBanner key={state.roundId} state={state} />}
                  </div>
                );
              })()
            ) : (
              <div className="mt-auto flex flex-col items-center pb-2">
                <div className={`rounded-full px-6 py-2 text-sm uppercase tracking-[0.25em] text-white/60 ${bet > 0 ? "border border-primary/40 bg-primary/10" : "border border-dashed border-white/15"}`}>
                  {bet > 0 ? `Bet ${formatChips(bet)}` : "Place your bet"}
                </div>
              </div>
            )}
          </section>
        </div>
        </div>
        </>
        )}

        {error && (
          <div className={`mt-2 shrink-0 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-center text-sm text-red-200 ${GLASS}`}>
            {error}
          </div>
        )}

        {/* Control deck */}
        <div className={`mt-3 shrink-0 rounded-2xl p-3 sm:p-4 ${GLASS}`}>
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
    <span className={`rounded-full px-3 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-white/60 ${GLASS}`}>
      {children}
    </span>
  );
}

function ValuePill({ value, soft, loss }: { value: number | null; soft?: boolean; loss?: boolean }) {
  const display = value === null ? "?" : soft ? `${value - 10}/${value}` : String(value);
  const hot = value === 21;
  return (
    <div
      className={[
        "bj-value-pill mt-2 flex h-7 min-w-[2.5rem] items-center justify-center rounded-full border px-3 text-sm font-bold backdrop-blur",
        hot ? "bj-value-pill-hot" : "border-white/15 bg-black/30 text-white/90",
        loss ? "bj-pulse-loss" : "",
      ].join(" ")}
    >
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
        className={`text-sm font-bold uppercase tracking-[0.2em] ${copy.gradient ? GRADIENT_TEXT : ""}`}
        style={copy.gradient ? undefined : { color: copy.tone }}
      >
        {copy.title}
      </span>
      {typeof payout === "number" && payout > 0 && (
        <span className="text-xs text-white/60">+{formatChips(payout)}</span>
      )}
    </div>
  );
}

const WIN_PARTICLES = Array.from({ length: 12 }, (_, i) => {
  const angle = (360 / 12) * i;
  return {
    angle,
    dist: 60 + (i % 3) * 26,
    delay: (i % 5) * 35,
    color: i % 3 === 0 ? "#a78bfa" : i % 3 === 1 ? "#818cf8" : "#fde68a",
  };
});

function ResultBanner({ state }: { state: import("../../types").BlackjackState }) {
  const totalPayout = state.hands.reduce((sum, h) => sum + (h.payout ?? 0), 0);
  const anyWin = state.hands.some(
    (h) => h.outcome === "win" || h.outcome === "blackjack"
  );
  const allLose = state.hands.every((h) => h.outcome === "lose");

  if (allLose) return null;

  const title = anyWin ? "Winner" : "Push";

  return (
    <div className={`bj-banner relative mt-2 flex w-full items-center justify-center overflow-hidden rounded-xl px-6 py-2 ${GLASS}`}>
      {anyWin &&
        WIN_PARTICLES.map((p, i) => (
          <span
            key={i}
            className="bj-particle"
            style={{
              "--bj-rot": `${p.angle}deg`,
              "--bj-dist": `-${p.dist}px`,
              animationDelay: `${p.delay}ms`,
              background: p.color,
            } as React.CSSProperties}
          />
        ))}
      <div className="relative flex flex-col items-center">
        <span className={`text-xl font-extrabold uppercase tracking-[0.35em] ${anyWin ? GRADIENT_TEXT : "text-white/70"}`}>
          {title}
        </span>
        {totalPayout > 0 && (
          <span className="text-sm text-white/70">
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
        const primary = move === "hit";
        const secondary = move === "stand";
        return (
          <button
            key={move}
            type="button"
            disabled={loading}
            onClick={() => onAction(move)}
            className={[
              "bj-action min-w-[5.5rem] flex-1 rounded-xl px-5 py-3 text-sm font-bold uppercase tracking-[0.15em] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40",
              primary
                ? "bj-action-hit text-emerald-950"
                : secondary
                ? "border border-amber-300/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
                : "border border-white/12 bg-white/5 text-white/85 hover:bg-white/10",
            ].join(" ")}
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
                ? "bg-primary/25 text-violet-200 ring-1 ring-primary/50"
                : "text-white/40 hover:text-white/70",
            ].join(" ")}
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
          <span className="text-[0.65rem] uppercase tracking-[0.25em] text-white/45">
            Current bet
          </span>
          <span className="text-2xl font-extrabold text-white">{formatChips(bet)}</span>
          <span className="text-[0.65rem] text-white/35">
            Min {formatChips(minBet)} &middot; Max {formatChips(maxBet)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={loading || bet === 0}
            className="flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white/85 transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            <RotateCcw className="h-4 w-4" />
            Clear
          </button>
          <Button
            onClick={onDeal}
            disabled={!betValid || loading}
            className={`h-auto rounded-xl px-8 py-3 text-base font-bold uppercase tracking-[0.2em] text-white ${CTA_GRADIENT}`}
          >
            {loading ? "Dealing…" : isComplete ? "New hand" : "Deal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoped styles: gradients, grain, flip mechanics, animations
// ---------------------------------------------------------------------------
function BlackjackStyles() {
  return (
    <style>{`
      .bj-grain {
        opacity: 0.04;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }

      .bj-table {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: inset 0 0 50px rgba(0,0,0,0.35);
      }

      .bj-card-back {
        background: linear-gradient(155deg, #6d28d9, #4338ca 60%, #3730a3);
        box-shadow: 0 6px 14px -4px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.12);
        position: relative;
        overflow: hidden;
      }
      .bj-card-back::after {
        content: "";
        position: absolute; inset: 8px;
        border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.2);
        background: repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 6px, transparent 6px 12px);
      }

      /* Dealer hole-card flip: a real 3D turn, not a swap-in-place */
      .bj-flip-outer { perspective: 700px; }
      .bj-flip-inner {
        position: relative; width: 100%; height: 100%;
        transform-style: preserve-3d;
        transition: transform 480ms cubic-bezier(0.4,0.15,0.2,1);
      }
      .bj-flip-inner.bj-flipped { transform: rotateY(180deg); }
      .bj-flip-face {
        position: absolute; inset: 0; border-radius: 0.5rem;
        backface-visibility: hidden; -webkit-backface-visibility: hidden;
      }
      .bj-flip-face-front { transform: rotateY(180deg); }

      .bj-value-pill-hot {
        box-shadow: 0 0 0 1px rgba(251,191,36,0.55), 0 0 18px 2px rgba(251,191,36,0.35);
        color: #fde68a;
      }
      .bj-pulse-loss { animation: bjLossPulse 560ms ease-out; }
      @keyframes bjLossPulse {
        0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.65); }
        100% { box-shadow: 0 0 0 14px rgba(239,68,68,0); }
      }

      .bj-active-hand {
        box-shadow: 0 0 0 1px rgba(167,139,250,0.5), 0 0 26px -4px rgba(167,139,250,0.45);
      }

      .bj-action-hit {
        background: linear-gradient(180deg, #6ee7b7, #10b981);
        box-shadow: 0 8px 20px -6px rgba(16,185,129,0.55);
      }
      .bj-action-hit:hover:not(:disabled) { filter: brightness(1.06); }
      .bj-action:active:not(:disabled) { transform: translateY(1px); }

      .bj-banner { animation: bjBannerIn 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      @keyframes bjBannerIn {
        from { opacity: 0; transform: translateY(10px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      .bj-particle {
        position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; border-radius: 2px;
        animation: bjParticleBurst 850ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      }
      @keyframes bjParticleBurst {
        0%   { opacity: 1; transform: translate(-50%, -50%) rotate(var(--bj-rot)) translateY(0) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--bj-rot)) translateY(var(--bj-dist)) scale(0.4); }
      }

      .bj-card-deal { animation: bjDeal 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
      @keyframes bjDeal {
        from { opacity: 0; transform: translateY(-30px) rotate(-8deg) scale(0.9); }
        to   { opacity: 1; transform: translateY(0) rotate(0) scale(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .bj-card-deal, .bj-banner, .bj-particle, .bj-pulse-loss { animation: none; }
        .bj-flip-inner { transition: none; }
      }
    `}</style>
  );
}
