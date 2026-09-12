import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Check, Copy, Plus, Search, SlidersHorizontal, Users } from "lucide-react";
import {
  avatarGradient,
  avatarPresetKeyFromUrl,
  cn,
  findAvatarPreset,
  formatChips,
  gradientFromColor,
  initialsOf,
} from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import type { Casino } from "../../types";
import { ChipIcon } from "./LobbyArt";
import { EMERALD_CTA, GLASS } from "./styles";

interface Props {
  casino: Casino;
  balance: number;
  query: string;
  onQueryChange: (value: string) => void;
  onBack: () => void;
  codeCopied: boolean;
  onCopyCode: () => void;
  onOpenGetChips: () => void;
}

// Casino identity, search, balance and account controls. Below `lg` the
// search moves to its own row and the bell/avatar drop out.
export function LobbyTopBar({ casino, balance, query, onQueryChange, onBack, codeCopied, onCopyCode, onOpenGetChips }: Props) {
  const memberLabel =
    casino.member_count === 0
      ? "No members yet"
      : `${casino.member_count} member${casino.member_count === 1 ? "" : "s"}`;

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2.5 lg:gap-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:w-[232px] lg:flex-none">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to casinos"
            className={cn(
              GLASS,
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 hover:text-foreground",
            )}
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
          <span
            className="hidden h-9 w-9 shrink-0 overflow-hidden rounded-[10px] border border-white/10 sm:block"
            style={casino.theme.backgroundUrl ? undefined : { background: gradientFromColor(casino.theme.primaryColor) }}
          >
            {casino.theme.backgroundUrl && (
              <img
                src={casino.theme.backgroundUrl}
                alt=""
                className="h-full w-full object-cover"
                style={{ objectPosition: "50% 35%" }}
              />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold tracking-tight">{casino.name}</p>
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">{memberLabel}</span>
              {/* Phones: the balance pill leaves no room for the full label. */}
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:hidden" aria-label={memberLabel}>
                <Users className="h-3 w-3" />
                {casino.member_count}
              </span>
              {/* The sidebar's invite card carries the code on desktop. */}
              <button
                type="button"
                onClick={onCopyCode}
                aria-label="Copy join code"
                className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-200 transition-colors hover:bg-white/15 lg:hidden"
              >
                {casino.join_code}
                {codeCopied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
              </button>
            </div>
          </div>
        </div>

        <SearchField value={query} onChange={onQueryChange} className="hidden w-[380px] lg:flex" />
        <div className="hidden flex-1 lg:block" />

        <div className={cn(GLASS, "flex h-9 shrink-0 items-center gap-2 rounded-full pl-2.5 pr-[3px] lg:h-10 lg:gap-2.5 lg:pl-3 lg:pr-1")}>
          <ChipIcon className="h-[18px] w-[18px] shrink-0 lg:h-5 lg:w-5" />
          <span className="font-mono text-[13px] font-semibold tabular-nums lg:text-sm">{formatChips(balance)}</span>
          <button
            type="button"
            onClick={onOpenGetChips}
            aria-label="Get chips"
            className={cn(
              EMERALD_CTA,
              "flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold shadow-[0_4px_14px_rgba(16,185,129,0.35)] lg:h-8 lg:w-auto lg:gap-1.5 lg:pl-[11px] lg:pr-3.5",
            )}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.8} />
            <span className="hidden lg:inline">Get chips</span>
          </button>
        </div>

        {/* No functionality yet. */}
        <button
          type="button"
          aria-label="Notifications"
          className={cn(GLASS, "hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 lg:flex")}
        >
          <Bell className="h-[18px] w-[18px]" />
        </button>

        <ProfileButton />
      </header>

      <div className="flex gap-2.5 lg:hidden">
        <SearchField value={query} onChange={onQueryChange} className="flex-1" />
        {/* No functionality yet. */}
        <button
          type="button"
          aria-label="Filters"
          className={cn(GLASS, "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-300")}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}

function SearchField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        GLASS,
        "flex h-11 min-w-0 items-center gap-2.5 rounded-xl px-3.5 text-slate-500 transition-colors focus-within:border-white/25 lg:h-10",
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search games…"
        aria-label="Search games"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-slate-500 focus:outline-none"
      />
    </label>
  );
}

function ProfileButton() {
  const navigate = useNavigate();
  const { profile } = useAuthStore();
  const name = profile?.username ?? "?";
  const presetKey = avatarPresetKeyFromUrl(profile?.avatar_url);
  const preset = presetKey ? findAvatarPreset(presetKey) : undefined;

  return (
    <button
      type="button"
      onClick={() => navigate("/profile")}
      aria-label="Profile"
      className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-opacity hover:opacity-90 lg:flex"
      style={{ background: preset?.gradient ?? avatarGradient(name) }}
    >
      {preset ? preset.emoji : initialsOf(name)}
    </button>
  );
}
