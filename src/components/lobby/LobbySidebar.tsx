import { useState } from "react";
import { BookOpen, Check, Cherry, Copy, House, UserPlus, X, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SAMPLE_ONLINE, SAMPLE_ONLINE_TOTAL, type LobbyFilter } from "../../lib/lobby";
import { avatarGradient, cn, initialsOf } from "../../lib/utils";
import { Modal } from "../ui/modal";
import { ACCENT_SOFT, ACCENT_SOLID, ACCENT_TEXT, GLASS } from "./styles";

interface Props {
  filter: LobbyFilter;
  onFilter: (filter: LobbyFilter) => void;
  counts: Record<LobbyFilter, number>;
  joinCode: string;
  codeCopied: boolean;
  onCopyCode: () => void;
  rules: string | null;
  className?: string;
}

const FILTERS: { id: LobbyFilter; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "Lobby", icon: House },
  { id: "slots", label: "Slots", icon: Cherry },
  { id: "instant", label: "Instant", icon: Zap },
];

const ROW = "flex h-10 items-center gap-3 rounded-xl px-2.5 text-sm font-semibold transition-colors";
const ROW_ICON = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg";
const FOOT_ROW = "flex h-9 items-center gap-3 rounded-xl px-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground";

// Desktop-only category rail. Sticky, and sized to its own content so the
// whole sidebar is always visible without an internal scrollbar.
export function LobbySidebar({ filter, onFilter, counts, joinCode, codeCopied, onCopyCode, rules, className }: Props) {
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <aside
      className={cn(
        GLASS,
        "w-[232px] shrink-0 flex-col gap-3.5 rounded-2xl p-2.5 lg:sticky lg:top-6",
        className,
      )}
    >
      <nav className="flex flex-col gap-0.5">
        {FILTERS.map(({ id, label, icon: Icon }) => {
          const active = filter === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onFilter(id)}
              aria-pressed={active}
              className={cn(ROW, active ? cn(ACCENT_SOFT, "text-foreground") : "text-slate-300 hover:bg-white/5")}
            >
              <span className={cn(ROW_ICON, active ? ACCENT_SOLID : cn(ACCENT_SOFT, ACCENT_TEXT))}>
                <Icon className="h-4 w-4" />
              </span>
              {label}
              <span className={cn("ml-auto text-xs font-medium", active ? "text-slate-300" : "text-slate-500")}>
                {counts[id]}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mx-1.5 h-px shrink-0 bg-white/[0.08]" />

      {/* Sample content until presence exists — see SAMPLE_ONLINE. */}
      <div className="flex flex-col gap-3 px-2 py-0.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <span className="text-[13px] font-bold">Online now</span>
          <span className="ml-auto text-xs text-slate-500">{SAMPLE_ONLINE_TOTAL}</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {SAMPLE_ONLINE.map(({ user, activity }) => (
            <div key={user} className="flex items-center gap-2.5">
              <span
                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                style={{ background: avatarGradient(user) }}
              >
                {initialsOf(user)}
                <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_2px_hsl(var(--card))]" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold">{user}</span>
                <span className="truncate text-[11px] text-slate-500">{activity}</span>
              </div>
            </div>
          ))}
        </div>
        {/* No functionality yet. */}
        <button type="button" className={cn(ACCENT_TEXT, "self-start text-xs font-semibold hover:underline")}>
          See all {SAMPLE_ONLINE_TOTAL} →
        </button>
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 rounded-[14px] border border-white/[0.08] bg-[linear-gradient(160deg,rgb(var(--lobby-accent)/0.18),rgba(255,255,255,0.03))] p-3.5">
        <div className={cn(ACCENT_TEXT, "flex items-center gap-2")}>
          <UserPlus className="h-4 w-4" />
          <span className="text-sm font-bold text-foreground">Invite friends</span>
        </div>
        <p className="text-xs leading-[1.45] text-muted-foreground">
          Anyone with the code can join and gets the starting chips.
        </p>
        <div className="flex h-[38px] items-center justify-between rounded-[10px] border border-dashed border-white/[0.18] bg-black/25 pl-3 pr-[5px]">
          <span className="font-mono text-sm font-bold tracking-[0.12em]">{joinCode}</span>
          <button
            type="button"
            onClick={onCopyCode}
            aria-label="Copy join code"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08] text-slate-300 transition-colors hover:bg-white/15 hover:text-foreground"
          >
            {codeCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5">
        <button type="button" onClick={() => setRulesOpen(true)} className={FOOT_ROW}>
          <BookOpen className="h-4 w-4" />
          House rules
        </button>
      </div>

      {rulesOpen && (
        <Modal onClose={() => setRulesOpen(false)} size="md">
          <div className="flex flex-col max-h-full">
            <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
              <p className="font-semibold text-base">House Rules</p>
              <button
                type="button"
                onClick={() => setRulesOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto min-h-0">
              {rules ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{rules}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This casino hasn't posted house rules yet.
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </aside>
  );
}
