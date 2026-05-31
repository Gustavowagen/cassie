import { Link, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { useAuthStore } from "../stores/authStore";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, signOut } = useAuthStore();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b px-6 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold tracking-tight">
          OnlineCassie
        </Link>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-muted-foreground">
                {profile?.username ?? user.email}
              </span>
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
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
