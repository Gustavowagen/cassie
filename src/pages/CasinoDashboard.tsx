import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Copy, Check, Users, BarChart2, X, ChevronRight, Gamepad2, Settings, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { supabase } from "../lib/supabase";
import { DateRangePicker } from "../components/ui/datepicker";
import { useCasino } from "../hooks/useCasino";
import { useBalance } from "../hooks/useBalance";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import { useGames } from "../hooks/useGames";
import { formatChips, gradientFromColor } from "../lib/utils";
import type { CasinoMemberWithProfile, GameType, CasinoGame, Casino } from "../types";
import { Blackjack } from "../components/games/Blackjack";
import { Roulette } from "../components/games/Roulette";
import { Modal } from "../components/ui/modal";
import { GameTile } from "../components/GameTile";

const PLAYABLE_GAME_IDS = new Set(["blackjack", "roulette"]);
const MANAGED_GAME_IDS = ["blackjack", "slots", "roulette", "dice"];

type OwnerTab = "games" | "members" | "stats" | "settings";

function displayRole(member: CasinoMemberWithProfile, casinoOwnerId: string): "creator" | "admin" | "member" {
  if (member.user_id === casinoOwnerId) return "creator";
  if (member.role === "admin") return "admin";
  return "member";
}

function roleBadgeClass(role: "creator" | "admin" | "member"): string {
  if (role === "creator") return "bg-primary/20 text-primary";
  if (role === "admin") return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

export function CasinoDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getCasinoBySlug, joinCasino, getCasinoMembers, giveChips, setMemberRole, getMemberProfitLoss } = useCasino();
  const { currentCasino, membership, setCasino } = useCasinoStore();
  const { user } = useAuthStore();
  useBalance(currentCasino?.id);

  const [activeTab, setActiveTab] = useState<OwnerTab>("games");
  const [members, setMembers] = useState<CasinoMemberWithProfile[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [selectedMember, setSelectedMember] = useState<CasinoMemberWithProfile | null>(null);

  const { listGameTypes, listCasinoGames, createGame, deleteGame } = useGames();
  const [gameTypes, setGameTypes] = useState<GameType[]>([]);
  const [casinoGames, setCasinoGames] = useState<CasinoGame[]>([]);
  const [activeGame, setActiveGame] = useState<CasinoGame | null>(null);

  useEffect(() => {
    if (!currentCasino) return;
    listGameTypes().then(setGameTypes);
    listCasinoGames(currentCasino.id).then(setCasinoGames);
  }, [currentCasino?.id]);

  useEffect(() => {
    if (!slug) return;
    getCasinoBySlug(slug).then((c) => {
      if (!c) navigate("/");
      else setCasino(c);
    });
  }, [slug]);

  const isOwner = user?.id === currentCasino?.owner_id;
  const isAdmin = membership?.role === "admin";
  const canManageMembers = isOwner || isAdmin;

  useEffect(() => {
    if (!canManageMembers || !currentCasino || activeTab !== "members") return;
    setMembersLoading(true);
    getCasinoMembers(currentCasino.id)
      .then(setMembers)
      .finally(() => setMembersLoading(false));
  }, [isOwner, isAdmin, currentCasino?.id, activeTab, membership?.id]);

  async function handleJoin() {
    if (!currentCasino) return;
    try {
      await joinCasino(currentCasino.id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to join");
    }
  }

  function copyJoinCode() {
    if (!currentCasino) return;
    navigator.clipboard.writeText(currentCasino.join_code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }

  async function handleGiveChips(userId: string, amount: number) {
    if (!currentCasino) return;
    await giveChips(currentCasino.id, userId, amount);
    getCasinoMembers(currentCasino.id).then((updated) => {
      setMembers(updated);
      if (selectedMember) {
        const refreshed = updated.find((m) => m.user_id === userId);
        if (refreshed) setSelectedMember(refreshed);
      }
    });
  }

  async function handleRoleChange(userId: string, newRole: "member" | "admin") {
    if (!currentCasino) return;
    await setMemberRole(currentCasino.id, userId, newRole);
    getCasinoMembers(currentCasino.id).then((updated) => {
      setMembers(updated);
      if (selectedMember?.user_id === userId) {
        const refreshed = updated.find((m) => m.user_id === userId);
        if (refreshed) setSelectedMember(refreshed);
      }
    });
  }

  if (!currentCasino)
    return (
      <div className="text-center py-16 text-muted-foreground">
        Loading casino...
      </div>
    );

  const { theme, name, description, join_code, member_count } = currentCasino;
  const hasLogo = Boolean(theme.logoUrl);
  const isMember = Boolean(membership);

  const gameTypeMap = Object.fromEntries(gameTypes.map((g) => [g.id, g]));

  return (
    <div className="space-y-6">
      {/* Casino header */}
      <div
        className="rounded-2xl overflow-hidden border border-border"
        style={{ background: gradientFromColor(theme.primaryColor) }}
      >
        <div className="p-6 md:p-8 flex items-start gap-5">
          {hasLogo && (
            <img
              src={theme.logoUrl!}
              alt={name}
              className="h-20 w-20 rounded-xl object-cover border-2 border-white/20 shadow-lg shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow">
              {name}
            </h1>
            {description && (
              <p className="text-white/75 mt-1 text-sm md:text-base max-w-xl">
                {description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <span className="text-white/60 text-sm">
                {member_count === 0
                  ? "No members yet"
                  : `${member_count} member${member_count === 1 ? "" : "s"}`}
              </span>
              {(isMember || isOwner) && (
                <button
                  type="button"
                  onClick={copyJoinCode}
                  className="flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 px-3 py-1 text-xs font-mono font-semibold text-white transition-colors"
                >
                  <span>Code: {join_code}</span>
                  {codeCopied ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>
          </div>
          {membership && (
            <Badge className="shrink-0 text-sm px-3 py-1 bg-white/20 text-white border-white/30">
              {formatChips(membership.balance)} chips
            </Badge>
          )}
        </div>
      </div>

      {/* Not logged in */}
      {!user && (
        <div className="rounded-xl bg-card border border-border p-10 text-center space-y-4">
          <p className="text-muted-foreground">Sign in to join and play.</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      )}

      {/* Logged in, not a member */}
      {user && !isMember && !isOwner && (
        <div className="rounded-xl bg-card border border-border p-10 text-center space-y-4">
          <p className="text-muted-foreground">
            You haven't joined this casino yet.
          </p>
          <Button onClick={handleJoin}>
            Join Casino ({currentCasino.settings.startingBalance.toLocaleString()} starting chips)
          </Button>
        </div>
      )}

      {/* Management tabs — visible to creator and admins */}
      {canManageMembers && (
        <div>
          <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
            {(
              [
                { id: "games", label: "Games", icon: Gamepad2 },
                { id: "members", label: "Members", icon: Users },
                { id: "stats", label: "Statistics", icon: BarChart2 },
                { id: "settings", label: "Settings", icon: Settings },
              ] as { id: OwnerTab; label: string; icon: React.ElementType }[]
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                  activeTab === id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {activeTab === "games" && (
            <GameOverview
              casinoGames={casinoGames}
              onPlay={(instance) => setActiveGame(instance)}
              canAdmin={canManageMembers}
            />
          )}
          {activeTab === "members" && (
            <MembersTab
              members={members}
              loading={membersLoading}
              casinoOwnerId={currentCasino.owner_id}
              onSelectMember={setSelectedMember}
            />
          )}
          {activeTab === "stats" && <StatsTab casinoId={currentCasino.id} />}
          {activeTab === "settings" && (
            <SettingsTab
              casinoId={currentCasino.id}
              casino={currentCasino}
              casinoGames={casinoGames}
              managedGameTypes={gameTypes.filter((g) => MANAGED_GAME_IDS.includes(g.id))}
              onCreate={async (typeId, customName) => {
                const newGame = await createGame(currentCasino.id, typeId, customName);
                setCasinoGames((prev) => [...prev, newGame]);
              }}
              onDelete={async (id) => {
                await deleteGame(id);
                setCasinoGames((prev) => prev.filter((g) => g.id !== id));
              }}
            />
          )}
        </div>
      )}

      {/* Game section — shown for regular members who don't have the tab bar */}
      {isMember && !canManageMembers && (
        <GameOverview
          casinoGames={casinoGames}
          onPlay={(instance) => setActiveGame(instance)}
          canAdmin={false}
        />
      )}

      {/* Game modal */}
      {activeGame && currentCasino && (
        <Modal onClose={() => setActiveGame(null)} size="xl">
          {activeGame.game_type_id === "blackjack" && (
            <Blackjack
              casinoId={currentCasino.id}
              balance={membership?.balance ?? 0}
              minBet={gameTypeMap["blackjack"]?.min_bet ?? 1}
              maxBet={gameTypeMap["blackjack"]?.max_bet ?? 100000}
              onExit={() => setActiveGame(null)}
            />
          )}
          {activeGame.game_type_id === "roulette" && (
            <Roulette
              casinoId={currentCasino.id}
              balance={membership?.balance ?? 0}
              minBet={gameTypeMap["roulette"]?.min_bet ?? 100}
              maxBet={gameTypeMap["roulette"]?.max_bet ?? 100000}
              onExit={() => setActiveGame(null)}
            />
          )}
        </Modal>
      )}

      {/* Member popup */}
      {selectedMember && currentCasino && (
        <Modal onClose={() => setSelectedMember(null)} size="md">
          <MemberPopup
            member={selectedMember}
            casinoId={currentCasino.id}
            casinoOwnerId={currentCasino.owner_id}
            isCreator={isOwner}
            onClose={() => setSelectedMember(null)}
            onGiveChips={handleGiveChips}
            onRoleChange={handleRoleChange}
            getMemberProfitLoss={getMemberProfitLoss}
          />
        </Modal>
      )}
    </div>
  );
}

function GameOverview({
  casinoGames,
  onPlay,
  canAdmin,
}: {
  casinoGames: CasinoGame[];
  onPlay: (instance: CasinoGame) => void;
  canAdmin?: boolean;
}) {
  if (casinoGames.length === 0)
    return (
      <div className="rounded-xl bg-card border border-border p-10 text-center text-muted-foreground space-y-3">
        <p>No games available yet.</p>
        {canAdmin && (
          <p className="text-sm text-primary hover:underline cursor-pointer">
            Add games from the Settings tab →
          </p>
        )}
      </div>
    );
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Games</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
        {casinoGames.map((g) => (
          <GameTile
            key={g.id}
            game={g}
            playable={PLAYABLE_GAME_IDS.has(g.game_type_id)}
            onPlay={() => onPlay(g)}
          />
        ))}
      </div>
    </div>
  );
}

const SETTINGS_GAME_ART: Record<string, string> = {
  blackjack: "/games/blackjack.svg",
  slots: "/games/slots.svg",
  roulette: "/games/roulette.svg",
  dice: "/games/dice.svg",
};

function SettingsTab({
  casinoId: _casinoId,
  casino,
  casinoGames,
  managedGameTypes,
  onCreate,
  onDelete,
}: {
  casinoId: string;
  casino: Casino;
  casinoGames: CasinoGame[];
  managedGameTypes: GameType[];
  onCreate: (typeId: string, customName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [addingType, setAddingType] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [description, setDescription] = useState(casino.description ?? "");
  const [primaryColor, setPrimaryColor] = useState(casino.theme.primaryColor);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null);

  function countForType(typeId: string) {
    return casinoGames.filter((g) => g.game_type_id === typeId).length;
  }

  function startAdding(gt: GameType) {
    setAddingType(gt.id);
    setNewName(gt.name);
    setSaveError(null);
  }

  async function handleCreate() {
    if (!addingType || !newName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onCreate(addingType, newName.trim());
      setAddingType(null);
      setNewName("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to add game");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveDetails() {
    setDetailsSaving(true);
    setDetailsMessage(null);
    try {
      await supabase
        .from("casinos")
        .update({ description, theme: { ...casino.theme, primaryColor } })
        .eq("id", casino.id);
      setDetailsMessage("Saved!");
      setTimeout(() => setDetailsMessage(null), 2000);
    } catch (err) {
      setDetailsMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setDetailsSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Games section */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-base">Available Games</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Up to 5 instances per game type.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {managedGameTypes.map((gt) => {
            const count = countForType(gt.id);
            const atMax = count >= 5;
            const isAdding = addingType === gt.id;
            const instances = casinoGames.filter((g) => g.game_type_id === gt.id);
            const playable = PLAYABLE_GAME_IDS.has(gt.id);
            const art = SETTINGS_GAME_ART[gt.id];

            return (
              <div key={gt.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                  {art && (
                    <div className="h-10 w-10 rounded-lg overflow-hidden shrink-0 border border-border">
                      <img src={art} alt="" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-sm">{gt.name}</p>
                      {!playable && (
                        <span className="text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                          soon
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{count}/5 active</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={atMax || isAdding}
                    onClick={() => startAdding(gt)}
                    className="shrink-0 text-xs h-7 px-2.5"
                  >
                    + Add
                  </Button>
                </div>

                {(instances.length > 0 || isAdding) && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                    {instances.map((inst) => (
                      <div key={inst.id} className="flex items-center justify-between">
                        <span className="text-sm">{inst.custom_name}</span>
                        <button
                          type="button"
                          disabled={deletingId === inst.id}
                          onClick={() => handleDelete(inst.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}

                    {isAdding && (
                      <div className="space-y-1.5 pt-1 border-t border-border">
                        <div className="flex gap-2 items-center">
                          <Input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Game name"
                            className="flex-1 h-8 text-sm"
                            autoFocus
                            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                          />
                          <Button size="sm" onClick={handleCreate} disabled={saving || !newName.trim()} className="h-8 px-3 text-xs">
                            {saving ? "…" : "Create"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setAddingType(null); setSaveError(null); }}
                            className="h-8 px-2 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Casino details section */}
      <div className="space-y-3">
        <h3 className="font-semibold text-base">Casino Details</h3>
        <div className="rounded-xl border border-border p-4 space-y-4">
          <div>
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your casino..."
              maxLength={200}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Primary Color</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-16 cursor-pointer rounded border"
              />
              <span className="text-sm text-muted-foreground font-mono">{primaryColor}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleSaveDetails} disabled={detailsSaving}>
              {detailsSaving ? "Saving..." : "Save Details"}
            </Button>
            {detailsMessage && (
              <p className="text-sm text-muted-foreground">{detailsMessage}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type TimeseriesRow = { bucket: string; daily_amount: number };
type DateMode = "all" | "custom";

function ProfitLossChart({ data }: { data: TimeseriesRow[] }) {
  if (!data.length) {
    return (
      <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">
        No game transactions in this period
      </div>
    );
  }

  let cumulative = 0;
  const points = data.map((d) => {
    cumulative += -d.daily_amount;
    return { date: d.bucket, value: cumulative };
  });

  const W = 600, H = 176;
  const PAD = { top: 16, right: 24, bottom: 36, left: 68 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const pad = (rawMax - rawMin) * 0.08 || 10;
  const minVal = rawMin - pad;
  const maxVal = rawMax + pad;
  const valueRange = maxVal - minVal;

  const xScale = (i: number) =>
    PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yScale = (v: number) =>
    PAD.top + innerH - ((v - minVal) / valueRange) * innerH;

  const zeroY = yScale(0);
  const isProfit = (points[points.length - 1]?.value ?? 0) >= 0;
  const accent = isProfit ? "#22c55e" : "#ef4444";

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(p.value).toFixed(1)}`)
    .join(" ");

  const areaPath =
    linePath +
    ` L${xScale(points.length - 1).toFixed(1)},${zeroY.toFixed(1)}` +
    ` L${xScale(0).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const xLabelCount = Math.min(5, points.length);
  const xLabels = Array.from({ length: xLabelCount }, (_, i) => {
    const idx = xLabelCount === 1 ? 0 : Math.round((i / (xLabelCount - 1)) * (points.length - 1));
    return { i: idx, date: points[idx].date };
  });

  const yTicks = [0, 0.33, 0.67, 1].map((t) => {
    const v = minVal + t * valueRange;
    return { v, y: yScale(v) };
  });

  const fmtDate = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      <defs>
        <linearGradient id="plFillDash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity={0.25} />
          <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
        </linearGradient>
        <clipPath id="chartClipDash">
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
        </clipPath>
      </defs>

      {yTicks.map(({ y }, i) => (
        <line key={i} x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y} stroke="currentColor" opacity={0.08} />
      ))}

      <line x1={PAD.left} y1={zeroY} x2={PAD.left + innerW} y2={zeroY} stroke="currentColor" opacity={0.25} strokeDasharray="5 4" />

      <path d={areaPath} fill="url(#plFillDash)" clipPath="url(#chartClipDash)" />
      <path d={linePath} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath="url(#chartClipDash)" />

      {points.length <= 30 && points.map((p, i) => (
        <circle key={i} cx={xScale(i)} cy={yScale(p.value)} r={3} fill={accent} />
      ))}

      {yTicks.map(({ v, y }, i) => (
        <text key={i} x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="currentColor" opacity={0.5}>
          {formatChips(Math.round(v))}
        </text>
      ))}

      {xLabels.map(({ i, date }) => (
        <text key={i} x={xScale(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.5}>
          {fmtDate(date)}
        </text>
      ))}

      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="currentColor" opacity={0.15} />
    </svg>
  );
}

function StatsTab({ casinoId }: { casinoId: string }) {
  const [dateMode, setDateMode] = useState<DateMode>("all");
  const [fromDate, setFromDate] = useState(daysAgoStr(30));
  const [toDate, setToDate] = useState(todayStr());
  const [playerPl, setPlayerPl] = useState<number | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params: Record<string, string | undefined> = { p_casino_id: casinoId };
    if (dateMode === "custom") {
      params.p_from = new Date(fromDate).toISOString();
      params.p_to = new Date(toDate + "T23:59:59").toISOString();
    }

    setLoading(true);
    Promise.all([
      supabase.rpc("get_casino_stats", params),
      supabase.rpc("get_casino_profit_loss_timeseries", params),
    ]).then(([statsRes, tsRes]) => {
      if (statsRes.data) setPlayerPl(Number(statsRes.data.player_profit_loss));
      if (tsRes.data) setTimeseries(tsRes.data as TimeseriesRow[]);
    }).finally(() => setLoading(false));
  }, [casinoId, dateMode, fromDate, toDate]);

  const casinoProfit = playerPl !== null ? -playerPl : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setDateMode("all")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            dateMode === "all" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          All time
        </button>
        <button
          type="button"
          onClick={() => setDateMode("custom")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            dateMode === "custom" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Custom
        </button>
      </div>

      {dateMode === "custom" && (
        <DateRangePicker
          from={fromDate}
          to={toDate}
          onFromChange={setFromDate}
          onToChange={setToDate}
          maxTo={todayStr()}
        />
      )}

      <div className="rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Casino Profit / Loss</p>
        {loading || casinoProfit === null ? (
          <div className="h-8 w-36 animate-pulse rounded bg-muted" />
        ) : (
          <p className={`text-2xl font-bold tabular-nums font-mono ${casinoProfit >= 0 ? "text-green-500" : "text-red-500"}`}>
            {casinoProfit >= 0 ? "+" : ""}{formatChips(casinoProfit)} chips
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <ProfitLossChart data={timeseries} />
        )}
      </div>
    </div>
  );
}

function MembersTab({
  members,
  loading,
  casinoOwnerId,
  onSelectMember,
}: {
  members: CasinoMemberWithProfile[];
  loading: boolean;
  casinoOwnerId: string;
  onSelectMember: (member: CasinoMemberWithProfile) => void;
}) {
  if (loading)
    return <p className="text-muted-foreground text-sm">Loading members...</p>;

  if (members.length === 0)
    return <p className="text-muted-foreground text-sm">No members yet.</p>;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Player</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Role</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Balance</th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Joined</th>
            <th className="px-4 py-3 w-8" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const role = displayRole(m, casinoOwnerId);
            return (
              <tr
                key={m.id}
                onClick={() => onSelectMember(m)}
                className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3 font-medium">{m.profile?.username ?? "Unknown"}</td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${roleBadgeClass(role)}`}>
                    {role}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatChips(m.balance)}</td>
                <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">
                  {new Date(m.joined_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  <ChevronRight className="h-4 w-4 ml-auto" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type StatPeriod = "all" | "30d" | "7d" | "custom";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function MemberPopup({
  member,
  casinoId,
  casinoOwnerId,
  isCreator,
  onClose,
  onGiveChips,
  onRoleChange,
  getMemberProfitLoss,
}: {
  member: CasinoMemberWithProfile;
  casinoId: string;
  casinoOwnerId: string;
  isCreator: boolean;
  onClose: () => void;
  onGiveChips: (userId: string, amount: number) => Promise<void>;
  onRoleChange: (userId: string, newRole: "member" | "admin") => Promise<void>;
  getMemberProfitLoss: (casinoId: string, userId: string, from?: Date, to?: Date) => Promise<number>;
}) {
  const [profitLoss, setProfitLoss] = useState<number | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [period, setPeriod] = useState<StatPeriod>("all");
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo, setCustomTo] = useState(todayStr());

  const [chipAmount, setChipAmount] = useState("");
  const [giving, setGiving] = useState(false);
  const [giveError, setGiveError] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const role = displayRole(member, casinoOwnerId);
  const isCreatorMember = member.user_id === casinoOwnerId;

  useEffect(() => {
    let from: Date | undefined;
    let to: Date | undefined;
    if (period === "7d") from = new Date(Date.now() - 7 * 86_400_000);
    else if (period === "30d") from = new Date(Date.now() - 30 * 86_400_000);
    else if (period === "custom") {
      if (customFrom) from = new Date(customFrom);
      if (customTo) to = new Date(customTo + "T23:59:59");
    }

    setStatsLoading(true);
    setProfitLoss(null);
    getMemberProfitLoss(casinoId, member.user_id, from, to)
      .then(setProfitLoss)
      .catch(() => setProfitLoss(null))
      .finally(() => setStatsLoading(false));
  }, [casinoId, member.user_id, period, customFrom, customTo]);

  async function handleGive() {
    const amount = parseFloat(chipAmount);
    if (!amount || amount <= 0) { setGiveError("Enter a positive amount"); return; }
    setGiving(true);
    setGiveError(null);
    try {
      await onGiveChips(member.user_id, amount);
      setChipAmount("");
    } catch (err) {
      setGiveError(err instanceof Error ? err.message : "Failed to give chips");
    } finally {
      setGiving(false);
    }
  }

  async function handleRoleChange(newRole: "member" | "admin") {
    setChangingRole(true);
    setRoleError(null);
    try {
      await onRoleChange(member.user_id, newRole);
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "Failed to change role");
    } finally {
      setChangingRole(false);
    }
  }

  const profitPositive = profitLoss !== null && profitLoss >= 0;
  const profitDisplay = statsLoading
    ? "..."
    : profitLoss === null
    ? "—"
    : `${profitPositive ? "+" : ""}${formatChips(profitLoss)}`;

  const PERIODS: { id: StatPeriod; label: string }[] = [
    { id: "all", label: "All time" },
    { id: "30d", label: "30d" },
    { id: "7d", label: "7d" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="bg-card rounded-2xl overflow-hidden">
      <div className="flex items-start justify-between p-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg select-none">
            {(member.profile?.username ?? "?")[0].toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-base leading-tight">
              {member.profile?.username ?? "Unknown"}
            </p>
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold mt-0.5 ${roleBadgeClass(role)}`}>
              {role}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg p-1"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/40 px-3 py-2.5">
            <p className="text-xs text-muted-foreground mb-0.5">Joined</p>
            <p className="text-sm font-medium">{new Date(member.joined_at).toLocaleDateString()}</p>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2.5">
            <p className="text-xs text-muted-foreground mb-0.5">Last played</p>
            <p className="text-sm font-medium">
              {member.last_played_at
                ? new Date(member.last_played_at).toLocaleDateString()
                : "Never"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Current balance</p>
          <p className="text-sm font-medium font-mono">{formatChips(member.balance)} chips</p>
        </div>

        <div className="rounded-lg border border-border px-3 py-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-muted-foreground font-medium">Profit / Loss</p>
            <div className="flex gap-1">
              {PERIODS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPeriod(id)}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                    period === id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {period === "custom" && (
            <div className="pt-1">
              <DateRangePicker
                from={customFrom}
                to={customTo}
                onFromChange={setCustomFrom}
                onToChange={setCustomTo}
                maxTo={todayStr()}
              />
            </div>
          )}

          <p className={`text-xl font-bold font-mono tabular-nums ${
            statsLoading || profitLoss === null
              ? "text-muted-foreground"
              : profitPositive
              ? "text-green-500"
              : "text-red-500"
          }`}>
            {profitDisplay}
          </p>
        </div>

        {isCreator && !isCreatorMember && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Role</p>
            <div className="flex gap-2">
              {(["member", "admin"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={member.role === r || changingRole}
                  onClick={() => handleRoleChange(r)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    member.role === r
                      ? r === "admin"
                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 cursor-default"
                        : "bg-muted text-foreground cursor-default"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {roleError && <p className="text-xs text-destructive mt-1">{roleError}</p>}
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground mb-2">Give chips</p>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              placeholder="Amount"
              value={chipAmount}
              onChange={(e) => setChipAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGive()}
              className="w-32 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button size="sm" onClick={handleGive} disabled={giving}>
              {giving ? "Sending…" : "Send"}
            </Button>
          </div>
          {giveError && <p className="text-xs text-destructive mt-1">{giveError}</p>}
        </div>
      </div>
    </div>
  );
}
