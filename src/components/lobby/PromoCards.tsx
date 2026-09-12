import { useState } from "react";
import type { ReactNode } from "react";
import { Clock, Crown, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { GiftArt, TrophyArt, WheelArt } from "./LobbyArt";
import { ACCENT_CTA, EMERALD_CTA, GLASS, SWIPE_ROW } from "./styles";
import { useDailySpin } from "../../hooks/useDailySpin";
import { DailySpinWheel } from "../DailySpinWheel";
import { Modal } from "../ui/modal";
import type { Casino } from "../../types";

const BUTTON = "mt-auto flex h-[30px] items-center rounded-lg px-3.5 text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50 xl:h-[34px] xl:rounded-[9px] xl:px-4 xl:text-[13px]";

// Daily spin is live and owner-configured (Settings -> Special Features); it
// hides itself entirely when the owner has it switched off. Daily bonus and
// Leaderboard do not exist yet, so their buttons are still inert.
export function PromoCards({
  casino,
  lastSpinAt,
}: {
  casino: Casino;
  lastSpinAt: string | null | undefined;
}) {
  const { config, available, readyIn, spinning, spin } = useDailySpin(casino, lastSpinAt);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={cn(SWIPE_ROW, "gap-2.5 md:mx-0 md:px-0 xl:grid xl:gap-4 xl:overflow-visible", config.enabled ? "xl:grid-cols-3" : "xl:grid-cols-2")}>
        {config.enabled && (
          <PromoCard
            title={config.title}
            subtitle={config.subtitle}
            icon={Sparkles}
            glow="rgba(236,72,153,0.32)"
            action={
              <button
                type="button"
                disabled={!available}
                onClick={() => setOpen(true)}
                className={cn(ACCENT_CTA, BUTTON)}
              >
                {/* readyIn is null both once available and while the membership
                    row hasn't loaded yet (cooldown status unknown) — the label
                    must tell those apart, or an unavailable-but-no-countdown
                    button would render the nonsensical "Ready in null". */}
                {available ? "Spin now" : readyIn ? `Ready in ${readyIn}` : "Loading…"}
              </button>
            }
            art={<WheelArt className="-bottom-6 -right-3 h-[112px] w-[112px] -rotate-[14deg] xl:-bottom-[30px] xl:-right-3.5 xl:h-[150px] xl:w-[150px]" />}
          />
        )}
        <PromoCard
          title="Daily bonus"
          subtitle="Free chips every day"
          icon={Clock}
          glow="rgba(16,185,129,0.30)"
          action={<button type="button" className={cn(EMERALD_CTA, BUTTON)}>Claim</button>}
          art={<GiftArt className="-bottom-2.5 -right-0.5 h-[104px] w-[104px] xl:-bottom-3.5 xl:h-[140px] xl:w-[140px]" />}
        />
        <PromoCard
          title="Leaderboard"
          subtitle="See who’s on top this week"
          icon={Crown}
          glow="rgba(245,158,11,0.28)"
          action={<button type="button" className={cn(GLASS, BUTTON, "text-slate-200 hover:bg-white/10")}>View ranks</button>}
          art={<TrophyArt className="-bottom-2 right-0 h-[100px] w-[100px] xl:-bottom-2.5 xl:h-[136px] xl:w-[136px]" />}
        />
      </div>

      {open && (
        <Modal onClose={() => setOpen(false)} size="md">
          <DailySpinWheel
            config={config}
            spinning={spinning}
            readyIn={readyIn}
            onClose={() => setOpen(false)}
            onSpin={spin}
          />
        </Modal>
      )}
    </>
  );
}

function PromoCard({
  title,
  subtitle,
  icon: Icon,
  glow,
  action,
  art,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  glow: string;
  action: ReactNode;
  art: ReactNode;
}) {
  return (
    <div
      className="relative flex h-[118px] w-[260px] shrink-0 snap-start flex-col items-start gap-1 overflow-hidden rounded-2xl border border-white/10 p-4 md:w-[280px] xl:h-[148px] xl:w-auto xl:gap-1.5 xl:p-5"
      style={{
        background: `radial-gradient(circle at 84% 78%, ${glow}, transparent 55%), linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 drop-shadow-[0_10px_20px_rgba(0,0,0,0.45)] [&>svg]:absolute">{art}</div>
      <span className="relative text-base font-extrabold tracking-tight xl:text-lg">{title}</span>
      <span className="relative flex max-w-[62%] items-center gap-1.5 text-[11px] text-muted-foreground xl:text-xs">
        <Icon className="h-3 w-3 shrink-0 xl:h-[13px] xl:w-[13px]" />
        {subtitle}
      </span>
      <div className="relative mt-auto">{action}</div>
    </div>
  );
}
