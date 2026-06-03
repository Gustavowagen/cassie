import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Copy, Check, Users, BarChart2, Gamepad2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useCasino } from "../hooks/useCasino";
import { useBalance } from "../hooks/useBalance";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import { formatChips, gradientFromColor } from "../lib/utils";
import type { CasinoMemberWithProfile, GameType, CasinoGame } from "../types";
import { useGames } from "../hooks/useGames";
import { Blackjack } from "../components/games/Blackjack";

type OwnerTab = "games" | "members" | "stats";

export function CasinoDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getCasinoBySlug, joinCasino, getCasinoMembers } = useCasino();
  const { currentCasino, membership, setCasino } = useCasinoStore();
  const { user } = useAuthStore();
  useBalance(currentCasino?.id);

  const [activeTab, setActiveTab] = useState<OwnerTab>("games");
  const [members, setMembers] = useState<CasinoMemberWithProfile[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const { listGameTypes, listCasinoGames, enableGame, disableGame } = useGames();
  const [gameTypes, setGameTypes] = useState<GameType[]>([]);
  const [casinoGames, setCasinoGames] = useState<CasinoGame[]>([]);
  const [activeGame, setActiveGame] = useState<string | null>(null);

  useEffect(() => {
    if (!currentCasino) return;
    listGameTypes().then(setGameTypes);
    listCasinoGames(currentCasino.id).then(setCasinoGames);
  }, [currentCasino?.id]);

  const enabledIds = new Set(casinoGames.map((g) => g.game_type_id));

  async function toggleGame(id: string, enabled: boolean) {
    if (!currentCasino) return;
    if (enabled) await disableGame(currentCasino.id, id);
    else await enableGame(currentCasino.id, id);
    setCasinoGames(await listCasinoGames(currentCasino.id));
  }

  useEffect(() => {
    if (!slug) return;
    getCasinoBySlug(slug).then((c) => {
      if (!c) navigate("/");
      else setCasino(c);
    });
  }, [slug]);

  const isOwner = user?.id === currentCasino?.owner_id;

  useEffect(() => {
    if (!isOwner || !currentCasino || activeTab !== "members") return;
    setMembersLoading(true);
    getCasinoMembers(currentCasino.id)
      .then(setMembers)
      .finally(() => setMembersLoading(false));
  }, [isOwner, currentCasino?.id, activeTab]);

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

  if (!currentCasino)
    return (
      <div className="text-center py-16 text-muted-foreground">
        Loading casino...
      </div>
    );

  const { theme, name, description, join_code, member_count } = currentCasino;
  const hasLogo = Boolean(theme.logoUrl);
  const isMember = Boolean(membership);

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
            Join Casino (
            {currentCasino.settings.startingBalance.toLocaleString()} starting
            chips)
          </Button>
        </div>
      )}

      {/* Owner view with tabs */}
      {isOwner && (
        <div>
          <div className="flex gap-1 border-b border-border mb-6">
            {(
              [
                { id: "games", label: "Games", icon: Gamepad2 },
                { id: "members", label: "Members", icon: Users },
                { id: "stats", label: "Statistics", icon: BarChart2 },
              ] as { id: OwnerTab; label: string; icon: React.ElementType }[]
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
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
            <OwnerGamesTab
              gameTypes={gameTypes}
              enabledIds={enabledIds}
              onToggle={toggleGame}
            />
          )}
          {activeTab === "members" && (
            <MembersTab members={members} loading={membersLoading} />
          )}
          {activeTab === "stats" && <StatsPlaceholder />}
        </div>
      )}

      {/* Member (non-owner) view */}
      {isMember && !isOwner && (
        activeGame === "blackjack" && currentCasino ? (
          <Blackjack
            casinoId={currentCasino.id}
            balance={membership?.balance ?? 0}
            minBet={gameTypes.find((g) => g.id === "blackjack")?.min_bet ?? 500}
            maxBet={gameTypes.find((g) => g.id === "blackjack")?.max_bet ?? 100000}
            onExit={() => setActiveGame(null)}
          />
        ) : (
          <MemberGamesTab
            gameTypes={gameTypes.filter((g) => enabledIds.has(g.id))}
            onPlay={(id) => setActiveGame(id)}
          />
        )
      )}
    </div>
  );
}

function OwnerGamesTab({
  gameTypes, enabledIds, onToggle,
}: {
  gameTypes: GameType[];
  enabledIds: Set<string>;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  if (gameTypes.length === 0)
    return <p className="text-muted-foreground text-sm">Loading games...</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {gameTypes.map((g) => {
        const on = enabledIds.has(g.id);
        return (
          <div key={g.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold">{g.name}</p>
              <p className="text-sm text-muted-foreground">{g.description}</p>
            </div>
            <Button variant={on ? "secondary" : "default"} size="sm" onClick={() => onToggle(g.id, on)}>
              {on ? "Enabled" : "Enable"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function MemberGamesTab({
  gameTypes, onPlay,
}: {
  gameTypes: GameType[];
  onPlay: (id: string) => void;
}) {
  if (gameTypes.length === 0)
    return (
      <div className="rounded-xl bg-card border border-border p-10 text-center text-muted-foreground">
        No games yet — check back after the owner enables them.
      </div>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {gameTypes.map((g) => (
        <button
          key={g.id}
          onClick={() => g.id === "blackjack" && onPlay(g.id)}
          disabled={g.id !== "blackjack"}
          className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary transition-colors disabled:opacity-50"
        >
          <p className="font-semibold">{g.name}</p>
          <p className="text-sm text-muted-foreground">{g.description}</p>
          <span className="text-xs text-primary mt-2 inline-block">
            {g.id === "blackjack" ? "Play now →" : "Coming soon"}
          </span>
        </button>
      ))}
    </div>
  );
}

function StatsPlaceholder() {
  return (
    <div className="rounded-xl bg-card border border-border p-10 text-center text-muted-foreground">
      Statistics coming soon.
    </div>
  );
}

function MembersTab({
  members,
  loading,
}: {
  members: CasinoMemberWithProfile[];
  loading: boolean;
}) {
  if (loading)
    return <p className="text-muted-foreground text-sm">Loading members...</p>;

  if (members.length === 0)
    return (
      <p className="text-muted-foreground text-sm">No members yet.</p>
    );

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">
              Player
            </th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">
              Role
            </th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground">
              Balance
            </th>
            <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">
              Joined
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr
              key={m.id}
              className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
            >
              <td className="px-4 py-3 font-medium">
                {m.profile?.username ?? "Unknown"}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    m.role === "owner"
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {m.role}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono">
                {formatChips(m.balance)}
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">
                {new Date(m.joined_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
