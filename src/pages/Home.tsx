import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { CasinoCard } from "../components/CasinoCard";
import { useCasino } from "../hooks/useCasino";
import { useAuthStore } from "../stores/authStore";
import type { Casino } from "../types";

export function Home() {
  const [casinos, setCasinos] = useState<Casino[]>([]);
  const [loading, setLoading] = useState(true);
  const { listCasinos } = useCasino();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    listCasinos()
      .then(setCasinos)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Online Casinos</h1>
          <p className="text-muted-foreground mt-1">
            Join a free play-money casino or create your own
          </p>
        </div>
        {user && (
          <Button onClick={() => navigate("/create")}>Create Casino</Button>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading casinos...</p>
      ) : casinos.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground text-lg">No casinos yet.</p>
          {user && (
            <Button className="mt-4" onClick={() => navigate("/create")}>
              Be the first!
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {casinos.map((c) => (
            <CasinoCard key={c.id} casino={c} />
          ))}
        </div>
      )}
    </div>
  );
}
