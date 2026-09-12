import { useNavigate } from "react-router-dom";
import { Info, Play, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import { ACCENT_CTA, GLASS } from "./styles";

// Promo banner for Gates of Olympus. On mobile the copy sits at the bottom
// over an upward fade; from `md` it moves left over a sideways fade.
export function FeaturedBanner() {
  const navigate = useNavigate();
  const playNow = () => navigate("/showcase/olympus");

  return (
    <section className="relative h-[228px] overflow-hidden rounded-2xl border border-white/10 shadow-[0_8px_32px_rgb(var(--lobby-accent)/0.15)] sm:h-[260px] md:h-[320px]">
      <img
        src="/olympus/gates-bg.webp"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[55%_30%] md:object-[50%_30%]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/65 to-background/5 md:bg-[linear-gradient(90deg,rgba(13,18,28,0.96)_0%,rgba(13,18,28,0.82)_30%,rgba(13,18,28,0.25)_58%,rgba(13,18,28,0)_76%)]"
      />
      <div aria-hidden className="absolute inset-0 hidden bg-gradient-to-t from-background/55 to-transparent to-40% md:block" />

      <div className="relative flex h-full flex-col items-start justify-end gap-2 p-4 sm:p-6 md:justify-start md:gap-3 md:px-10 md:py-[34px]">
        <span className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-200 md:text-[11px]">
          <Sparkles className="h-3 w-3" />
          New game
        </span>
        <h2 className="text-[28px] font-black leading-none tracking-[-0.025em] sm:text-[34px] md:max-w-[460px] md:text-[46px]">
          Gates of Olympus
        </h2>
        <div className="flex w-full items-center gap-2.5 md:w-auto">
          <span className="rounded-[9px] bg-gradient-to-r from-pink-600 to-pink-400 px-2.5 py-[5px] text-[13px] font-extrabold shadow-[0_6px_20px_rgba(219,39,119,0.4)] md:rounded-xl md:px-3.5 md:py-1.5 md:text-xl">
            <span className="md:hidden">Orbs up to 50×</span>
            <span className="hidden md:inline">Multiplier orbs up to 50×</span>
          </span>
          <PlayButton onClick={playNow} className="ml-auto h-9 px-4 text-[13px] md:hidden" />
        </div>
        <p className="hidden max-w-[410px] text-sm leading-normal text-white/75 md:block">
          Land 8 or more of a symbol anywhere on the 6×5 board. Wins tumble away, and every orb that drops adds to
          the round’s multiplier.
        </p>
        <div className="mt-auto hidden gap-2.5 md:flex">
          <PlayButton onClick={playNow} className="h-[42px] pl-[18px] pr-[22px] text-sm" />
          {/* No functionality yet. */}
          <button
            type="button"
            className={cn(
              GLASS,
              "flex h-[42px] items-center gap-2 rounded-[10px] pl-3.5 pr-[18px] text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10",
            )}
          >
            <Info className="h-4 w-4" />
            How it plays
          </button>
        </div>
      </div>

      {/* Carousel dots — a single slide for now, so they do nothing. */}
      <div className="absolute right-3.5 top-3.5 flex gap-1.5 md:bottom-[22px] md:right-6 md:top-auto">
        <button type="button" aria-label="Slide 1" className="h-[5px] w-[18px] rounded-full bg-white md:h-1.5 md:w-[22px]" />
        <button type="button" aria-label="Slide 2" className="h-[5px] w-[5px] rounded-full bg-white/40 md:h-1.5 md:w-1.5" />
        <button type="button" aria-label="Slide 3" className="h-[5px] w-[5px] rounded-full bg-white/40 md:h-1.5 md:w-1.5" />
      </div>
    </section>
  );
}

function PlayButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        ACCENT_CTA,
        "flex items-center gap-2 rounded-[10px] font-bold shadow-[0_8px_24px_rgb(var(--lobby-accent)/0.35)] transition-opacity hover:opacity-90",
        className,
      )}
    >
      <Play className="h-3.5 w-3.5 fill-current" />
      Play now
    </button>
  );
}
