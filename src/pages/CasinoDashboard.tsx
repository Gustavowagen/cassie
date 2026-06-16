import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Copy, Check, Users, BarChart2, Gift } from "lucide-react";
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
import { Modal } from "../components/ui/modal";
import { GameTile } from "../components/GameTile";

// Game types with a real playable UI. Others can be enabled by the owner
// but won't show on this page until they're implemented.
const PLAYABLE_GAME_IDS = new Set(["blackjack"]);

type OwnerTab = "members" | "stats";

export function CasinoDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getCasinoBySlug, joinCasino, getCasinoMembers, giveChips } = useCasino();
  const { currentCasino, membership, setCasino } = useCasinoStore();
  const { user } = useAuthStore();
  useBalance(currentCasino?.id);

  const [activeTab, setActiveTab] = useState<OwnerTab>("members");
  const [members, setMembers] = useState<CasinoMemberWithProfile[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const { listGameTypes, listCasinoGames } = useGames();
  const [gameTypes, setGameTypes] = useState<GameType[]>([]);
  const [casinoGames, setCasinoGames] = useState<CasinoGame[]>([]);
  const [activeGame, setActiveGame] = useState<string | null>(null);

  useEffect(() => {
    if (!currentCasino) return;
    listGameTypes().then(setGameTypes);
    listCasinoGames(currentCasino.id).then(setCasinoGames);
  }, [currentCasino?.id]);

  const enabledIds = new Set(casinoGames.map((g) => g.game_type_id));

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
  }, [isOwner, currentCasino?.id, activeTab, membership?.id]);

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
            Join Casino ({currentCasino.settings.startingBalance.toLocaleString()} starting chips)
          </Button>
        </div>
      )}

      {/* Owner management tabs */}
      {isOwner && (
        <div>
          <div className="flex gap-1 border-b border-border mb-6">
            {(
              [
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

          {activeTab === "members" && (
            <MembersTab
              members={members}
              loading={membersLoading}
              casinoId={currentCasino.id}
              onGiveChips={async (userId, amount) => {
                await giveChips(currentCasino.id, userId, amount);
                getCasinoMembers(currentCasino.id).then(setMembers);
              }}
            />
          )}
          {activeTab === "stats" && <StatsPlaceholder />}
        </div>
      )}

      {/* Game section — shown for members and owners */}
      {(isMember || isOwner) && (
        <GameOverview
          gameTypes={gameTypes.filter(
            (g) => enabledIds.has(g.id) && PLAYABLE_GAME_IDS.has(g.id)
          )}
          onPlay={(id) => setActiveGame(id)}
          isOwner={isOwner}
          slug={slug}
        />
      )}

      {activeGame === "blackjack" && currentCasino && (
        <Modal onClose={() => setActiveGame(null)}>
          <Blackjack
            casinoId={currentCasino.id}
            balance={membership?.balance ?? 0}
            minBet={gameTypes.find((g) => g.id === "blackjack")?.min_bet ?? 1}
            maxBet={gameTypes.find((g) => g.id === "blackjack")?.max_bet ?? 100000}
            onExit={() => setActiveGame(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function GameOverview({
  gameTypes, onPlay, isOwner, slug,
}: {
  gameTypes: GameType[];
  onPlay: (id: string) => void;
  isOwner?: boolean;
  slug?: string;
}) {
  if (gameTypes.length === 0)
    return (
      <div className="rounded-xl bg-card border border-border p-10 text-center text-muted-foreground space-y-3">
        <p>No games available yet.</p>
        {isOwner && (
          <Link
            to={`/casino/${slug}/admin`}
            className="text-sm text-primary hover:underline"
          >
            Enable games from the admin page →
          </Link>
        )}
      </div>
    );
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Games</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
        {gameTypes.map((g) => (
          <GameTile key={g.id} game={g} onPlay={onPlay} />
        ))}
      </div>
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
  casinoId: _casinoId,
  onGiveChips,
}: {
  members: CasinoMemberWithProfile[];
  loading: boolean;
  casinoId: string;
  onGiveChips: (userId: string, amount: number) => Promise<void>;
}) {
  const [givingTo, setGivingTo] = useState<string | null>(null);
  const [chipAmount, setChipAmount] = useState("");
  const [giving, setGiving] = useState(false);
  const [giveError, setGiveError] = useState<string | null>(null);

  async function handleGive(userId: string) {
    const amount = parseInt(chipAmount, 10);
    if (!amount || amount <= 0) { setGiveError("Enter a positive amount"); return; }
    setGiving(true);
    setGiveError(null);
    try {
      await onGiveChips(userId, amount);
      setGivingTo(null);
      setChipAmount("");
    } catch (err) {
      setGiveError(err instanceof Error ? err.message : "Failed to give chips");
    } finally {
      setGiving(false);
    }
  }

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
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <>
              <tr
                key={m.id}
                className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
              >
                <td className="px-4 py-3 font-medium">{m.profile?.username ?? "Unknown"}</td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    m.role === "owner" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  }`}>
                    {m.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatChips(m.balance)}</td>
                <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">
                  {new Date(m.joined_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setGivingTo(givingTo === m.user_id ? null : m.user_id);
                      setChipAmount("");
                      setGiveError(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    <Gift className="h-3 w-3" />
                    Give chips
                  </button>
                </td>
              </tr>
              {givingTo === m.user_id && (
                <tr key={`${m.id}-give`} className="border-b border-border bg-muted/10">
                  <td colSpan={5} className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="number"
                        min={1}
                        placeholder="Amount"
                        value={chipAmount}
                        onChange={(e) => setChipAmount(e.target.value)}
                        className="w-32 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        onKeyDown={(e) => e.key === "Enter" && handleGive(m.user_id)}
                      />
                      <Button size="sm" onClick={() => handleGive(m.user_id)} disabled={giving}>
                        {giving ? "Sending…" : "Send"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => { setGivingTo(null); setGiveError(null); }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                      {giveError && <span className="text-xs text-destructive">{giveError}</span>}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
