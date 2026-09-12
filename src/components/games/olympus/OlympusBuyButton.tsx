// The showcase's feature buy: a smaller gold coin beside the spin medallion.
// Deliberately quieter than the spin button — same metal and enamel so the
// two read as a set, but no wreath and no lightning, so the medallion stays
// the one thing on the controls bar that asks to be pressed.

export function OlympusBuyButton({
  spins,
  price,
  disabled,
  onBuy,
}: {
  spins: number;
  /**
   * Preformatted price of one batch, shown under the coin. Absent in the
   * showcase, where nothing is charged.
   */
  price?: string;
  disabled: boolean;
  onBuy: () => void;
}) {
  return (
    <button
      type="button"
      className="oly-buy"
      onClick={onBuy}
      disabled={disabled}
      aria-label={price ? `Buy ${spins} free spins for ${price} chips` : `Buy ${spins} free spins`}
    >
      <BuyStyles />
      <svg className="oly-buy-art" viewBox="-50 -50 100 100" aria-hidden focusable="false">
        <defs>
          <linearGradient id="olyBuyBezel" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#fdf3c4" />
            <stop offset="20%" stopColor="#f6c95f" />
            <stop offset="45%" stopColor="#d78a2c" />
            <stop offset="60%" stopColor="#8b4415" />
            <stop offset="80%" stopColor="#f6c95f" />
            <stop offset="100%" stopColor="#fdf3c4" />
          </linearGradient>
          <radialGradient id="olyBuyFace" cx="0.5" cy="0.38" r="0.64">
            <stop offset="0%" stopColor="#8a2a2a" />
            <stop offset="50%" stopColor="#5c0f10" />
            <stop offset="100%" stopColor="#2a0507" />
          </radialGradient>
          <linearGradient id="olyBuyNumber" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff7d6" />
            <stop offset="45%" stopColor="#ffd968" />
            <stop offset="100%" stopColor="#e08a14" />
          </linearGradient>
        </defs>
        <circle r="48" fill="url(#olyBuyBezel)" stroke="#4d2110" strokeWidth="1.2" />
        <circle r="40" fill="url(#olyBuyFace)" stroke="#fdf3c4" strokeOpacity="0.65" strokeWidth="1.2" />
        <ellipse cx="0" cy="-22" rx="24" ry="9" fill="#fff" opacity="0.09" />
        <text
          y="8"
          textAnchor="middle"
          fontFamily="'Barlow Semi Condensed', system-ui, sans-serif"
          fontWeight="800"
          fontSize="34"
          fill="url(#olyBuyNumber)"
          stroke="#5a2408"
          strokeWidth="0.8"
        >
          {spins}
        </text>
        <text
          y="24"
          textAnchor="middle"
          fontFamily="Cinzel, Georgia, serif"
          fontWeight="700"
          fontSize="8.6"
          letterSpacing="0.6"
          fill="#f2c877"
        >
          Free spins
        </text>
      </svg>
      {/* The price rides under the coin rather than on its face: the face is
          already carrying the spin count, and a five- or six-figure chip
          amount would not fit inside the enamel at any readable size. */}
      {price && <span className="oly-buy-price">{price}</span>}
    </button>
  );
}

function BuyStyles() {
  return (
    <style>{`
      /* aspect-ratio is on the art, not the button: with a price label below
         it the button is taller than it is wide, and forcing it square would
         squash the coin. */
      .oly-buy { position: relative; width: clamp(54px, 5.2vw, 88px); padding: 0; border: none;
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        background: none; cursor: pointer; -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease, filter 160ms ease, opacity 200ms ease; }
      .oly-buy-art { display: block; width: 100%; aspect-ratio: 1; filter: drop-shadow(0 6px 12px rgba(12,2,20,0.55)); }
      .oly-buy-price { max-width: 100%; font-family: 'Barlow Semi Condensed', system-ui, sans-serif; font-weight: 700;
        font-size: clamp(9px, 0.85vw, 13px); line-height: 1; letter-spacing: 0.02em; color: #f2c877;
        text-shadow: 0 1px 3px rgba(20,4,0,0.95); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      @media (hover: hover) {
        .oly-buy:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.1); }
      }
      .oly-buy:active:not(:disabled) { transform: scale(0.95); }
      .oly-buy:focus-visible { outline: 3px solid #fff3c8; outline-offset: 4px; border-radius: 12px; }
      .oly-buy:disabled { cursor: default; opacity: 0.45; filter: saturate(0.6); }
      @media (prefers-reduced-motion: reduce) {
        .oly-buy:hover:not(:disabled) { transform: none; }
      }
    `}</style>
  );
}
