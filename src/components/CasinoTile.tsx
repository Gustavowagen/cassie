import { useNavigate } from "react-router-dom";
import { gradientFromColor } from "../lib/utils";
import type { Casino } from "../types";

interface Props {
  casino: Casino;
  isMember?: boolean;
}

// Subtle grain overlay — a tiny SVG noise tiled at low opacity to break up the gradient.
const GRAIN_DATA_URI =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>";

export function CasinoTile({ casino, isMember }: Props) {
  const navigate = useNavigate();
  const { theme, member_count, name, slug } = casino;
  const hasBg = Boolean(theme.backgroundUrl);
  const memberLabel =
    member_count === 0
      ? "Be the first to join"
      : `${member_count} member${member_count === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={() => navigate(`/casino/${slug}`)}
      className="group block w-full text-left overflow-hidden rounded-xl bg-card border border-border transition duration-150 hover:-translate-y-1 hover:shadow-[0_0_24px_rgba(255,255,255,0.06)] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
    >
      {/* Art area, 4:5 portrait */}
      <div
        className="relative aspect-[4/5] w-full"
        style={
          hasBg
            ? undefined
            : { background: gradientFromColor(theme.primaryColor) }
        }
      >
        {hasBg && (
          <img
            src={theme.backgroundUrl!}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {/* grain overlay */}
        <div
          aria-hidden
          className="absolute inset-0 mix-blend-overlay pointer-events-none"
          style={{ backgroundImage: `url("${GRAIN_DATA_URI}")` }}
        />
        {/* bottom gradient for legibility */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent"
        />

        {/* joined pill top-right */}
        {isMember && (
          <span className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-white/15 backdrop-blur px-2 py-0.5 text-white">
            Joined
          </span>
        )}

        {/* name bottom-left */}
        <div className="absolute bottom-2 left-3 right-3">
          <h3 className="text-white font-bold text-lg leading-tight line-clamp-2 drop-shadow">
            {name}
          </h3>
        </div>
      </div>

      {/* Footer strip */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
        />
        <span>{memberLabel}</span>
      </div>
    </button>
  );
}
