// The cabinet's bet control: the Bet readout with a small gold coin either
// side of it, stepping through a fixed ladder of stakes the way the original
// cabinet does rather than taking a typed amount. The ladder itself comes from
// the game (Olympus.tsx's stakeLadderFor, bounded by the instance's bet
// limits); this control only walks it.
//
// Quieter metal than the spin medallion — the same gold band and dark enamel
// as the feature-buy coin, with no wreath and no lightning — so the medallion
// stays the one thing on the controls bar that asks to be pressed.

export function OlympusBetStepper({
  value,
  atMin,
  atMax,
  disabled,
  onStep,
}: {
  /** Preformatted by the machine, so this readout and the plaque agree to the digit. */
  value: string;
  atMin: boolean;
  atMax: boolean;
  disabled: boolean;
  onStep: (dir: -1 | 1) => void;
}) {
  return (
    <div className="oly-bet">
      <BetStyles />

      <button
        type="button"
        className="oly-bet-coin"
        onClick={() => onStep(-1)}
        disabled={disabled || atMin}
        aria-label="Lower bet"
      >
        <span className="oly-bet-glyph" aria-hidden>
          −
        </span>
      </button>

      {/* .oly-readout is shared with the multiplier counter beside it — see
          OlympusMachine's styles. */}
      <div className="oly-readout">
        <span className="oly-readout-label">Bet</span>
        <span className="oly-readout-value" aria-live="polite">
          {value}
        </span>
      </div>

      <button
        type="button"
        className="oly-bet-coin"
        onClick={() => onStep(1)}
        disabled={disabled || atMax}
        aria-label="Raise bet"
      >
        <span className="oly-bet-glyph" aria-hidden>
          +
        </span>
      </button>
    </div>
  );
}

function BetStyles() {
  return (
    <style>{`
      /* Sits where the static Bet readout used to, so the bar keeps its
         rhythm: feature coin, bet, multiplier, spin. */
      .oly-bet { display: flex; align-items: center; gap: clamp(5px, 0.6vw, 11px); }

      /* Drawn in CSS rather than SVG, unlike the other two coins: two of these
         render side by side, and a pair of inline SVGs would put two copies of
         the same gradient ids in the document. */
      .oly-bet-coin { position: relative; width: clamp(30px, 3vw, 48px); aspect-ratio: 1; padding: 0; border: none; border-radius: 50%;
        display: grid; place-items: center; cursor: pointer; -webkit-tap-highlight-color: transparent;
        background: linear-gradient(150deg, #fdf3c4 0%, #f6c95f 20%, #d78a2c 45%, #8b4415 60%, #f6c95f 80%, #fdf3c4 100%);
        box-shadow: 0 0 0 1px #4d2110, 0 5px 10px rgba(12,2,20,0.5);
        transition: transform 160ms ease, filter 160ms ease, opacity 200ms ease; }
      /* The enamel face, inset inside the gold band. */
      .oly-bet-coin::before { content: ""; position: absolute; inset: 15%; border-radius: 50%;
        background: radial-gradient(circle at 50% 38%, #8a2a2a, #5c0f10 52%, #2a0507 100%);
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.6), 0 0 0 1px rgba(253,243,196,0.5); }
      /* Gold glyph over the enamel. Clipped gradient text, so it takes its
         shadow from a filter — a text-shadow would paint over the clip. */
      .oly-bet-glyph { position: relative; font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 800;
        font-size: clamp(18px, 1.8vw, 28px); line-height: 1;
        background: linear-gradient(180deg, #fff7d6 0%, #ffd968 45%, #e08a14 100%);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        filter: drop-shadow(0 1px 1px rgba(90,36,8,0.9)); }

      @media (hover: hover) {
        .oly-bet-coin:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.1); }
      }
      .oly-bet-coin:active:not(:disabled) { transform: scale(0.92); }
      .oly-bet-coin:focus-visible { outline: 3px solid #fff3c8; outline-offset: 3px; }
      /* Same treatment as the feature coin: dimmed at the ends of the ladder
         and for as long as a round is playing. */
      .oly-bet-coin:disabled { cursor: default; opacity: 0.4; filter: saturate(0.55); }

      @media (max-width: 640px) {
        /* The bar carries four items on a 375px screen, so the coins and the
           gaps either side of the readout give up what they can. */
        .oly-bet { gap: 3px; }
        .oly-bet-coin { width: 28px; }
        .oly-bet-glyph { font-size: 17px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .oly-bet-coin:hover:not(:disabled) { transform: none; }
      }
    `}</style>
  );
}
