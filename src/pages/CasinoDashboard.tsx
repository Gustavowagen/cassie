import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useCasino } from "../hooks/useCasino";
import { useBalance } from "../hooks/useBalance";
import { useCasinoStore } from "../stores/casinoStore";
import { useAuthStore } from "../stores/authStore";
import { formatChips } from "../lib/utils";

export function CasinoDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { getCasinoBySlug, joinCasino } = useCasino();
  const { currentCasino, membership, setCasino } = useCasinoStore();
  const { user } = useAuthStore();
  useBalance(currentCasino?.id);

  useEffect(() => {
    if (!slug) return;
    getCasinoBySlug(slug).then((c) => {
      if (!c) navigate("/");
      else setCasino(c);
    });
  }, [slug]);

  if (!currentCasino)
    return (
      <div className="text-center py-16 text-muted-foreground">
        Loading casino...
      </div>
    );

  const isOwner = user?.id === currentCasino.owner_id;

  async function handleJoin() {
    if (!currentCasino) return;
    try {
      await joinCasino(currentCasino.id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to join");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{currentCasino.name}</h1>
          {currentCasino.description && (
            <p className="text-muted-foreground mt-1">
              {currentCasino.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {membership && (
            <Badge className="text-base px-3 py-1">
              {formatChips(membership.balance)} chips
            </Badge>
          )}
          {isOwner && (
            <Button
              variant="outline"
              onClick={() => navigate(`/casino/${slug}/admin`)}
            >
              Admin
            </Button>
          )}
        </div>
      </div>

      {!user && (
        <div className="text-center py-16">
          <p className="mb-4 text-muted-foreground">
            Sign in to join and play.
          </p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      )}

      {user && !membership && (
        <div className="text-center py-16">
          <p className="mb-4 text-muted-foreground">
            You haven't joined this casino yet.
          </p>
          <Button onClick={handleJoin}>
            Join Casino (
            {currentCasino.settings.startingBalance.toLocaleString()} starting
            chips)
          </Button>
        </div>
      )}

      {membership && (
        <div className="py-8 text-center text-muted-foreground">
          Games coming soon — check back after the owner enables them.
        </div>
      )}
    </div>
  );
}
