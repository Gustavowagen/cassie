import type { SlotsDesign } from "../../lib/slotsDesigns";
import type { SlotSymbolId } from "../../types";

// Visual skin shared by every game that renders slot symbols — currently
// Slots and Tumble. Holds only what is design-dependent (the per-design icon
// art and theme chrome) plus the cell/symbol primitives those rules hang off.
// Each game keeps its own layout and animation CSS: Slots owns the reel-drop
// strip, Tumble owns the cascade. Extracted so adding a design means editing
// slotsDesigns.ts and this file, never both games.

// Renders one symbol using the active design's icon spec — a themed shape
// (`className`) optionally built from absolutely-positioned sub-shapes
// (`parts`, e.g. a cherry's two stems/leaf/balls) or literal glyph text
// (`text`, the two designs whose top symbol is a glowing "7"). See
// SlotsSkinStyles for the CSS each className/part hooks into.
export function SlotSymbol({ design, id }: { design: SlotsDesign; id: SlotSymbolId }) {
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

// Consumers size their own cells by setting --cell on (or above) the
// .sl-reels-wrap element; nothing here assumes a board shape.
export function SlotsSkinStyles() {
  return (
    <style>{`
      .sl-reels-wrap { position: relative; padding: 14px; border-radius: 16px; }
      .sl-cell { width: var(--cell); height: var(--cell); display: flex; align-items: center; justify-content: center; flex: none; }

      .sl-sym { width: 56%; height: 56%; display: flex; align-items: center; justify-content: center; position: relative; font-weight: 700; font-size: 24px; }
      .sl-sym-mini { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; }
      .sl-sym-mini .sl-sym { width: 100%; height: 100%; font-size: 12px; }
      /* .sl-ic is the themed icon's own box — always fills its .sl-sym
         wrapper, so every design's shapes (and any of their part elements,
         positioned absolutely against it) scale the same way at both the
         main board size and the paytable's 22px mini size. */
      .sl-ic { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }

      /* Win banner — shared because the theme chrome below colors its label
         and amount per design. Each game positions it inside its own
         .sl-reels-wrap. */
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

      /* ================= THEME CHROME =================
         Each design scopes its reels-wrap gradient/border, payline arrow
         color, lit-cell glow, win-flash tint, and win banner colors under
         its own .sl-theme-<id> class (applied to .sl-reels-wrap) — every
         other rule here is shared structure, not appearance. */
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
    `}</style>
  );
}
