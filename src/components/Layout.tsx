import { Link, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { useAuthStore } from "../stores/authStore";

// Stable gradient per username — hash to a hue.
function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 70% 55%), hsl(${h2} 70% 40%))`;
}

function initialsOf(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, signOut } = useAuthStore();
  const navigate = useNavigate();
  const displayName = profile?.username ?? user?.email ?? "";

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold tracking-tight">
          OnlineCassie
        </Link>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ background: avatarGradient(displayName) }}
                >
                  {initialsOf(displayName)}
                </div>
                <span className="text-sm text-muted-foreground hidden sm:inline">
                  {displayName}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => signOut().then(() => navigate("/"))}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => navigate("/auth")}>
              Sign in
            </Button>
          )}
        </div>
      </nav>
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
