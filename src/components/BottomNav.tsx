import { useLocation, useNavigate } from "react-router-dom";
import { Home, Compass, User } from "lucide-react";
import { cn } from "../lib/utils";

const ITEMS = [
  { to: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { to: "/browse", label: "Browse", icon: Compass, match: (p: string) => p.startsWith("/browse") },
  { to: "/profile", label: "Profile", icon: User, match: (p: string) => p.startsWith("/profile") },
];

function NavItems({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  return (
    <>
      {ITEMS.map(({ to, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <button
            key={to}
            type="button"
            onClick={() => navigate(to)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 text-[10.5px] font-semibold transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground/80",
            )}
          >
            <Icon className={cn("h-[21px] w-[21px]", active && "text-primary")} strokeWidth={2} />
            {label}
          </button>
        );
      })}
    </>
  );
}

// Persistent app navigation — a fixed bottom tab bar on mobile, a floating
// pill on desktop. Replaces the old top nav bar (see Layout.tsx).
export function BottomNav() {
  const { pathname } = useLocation();

  return (
    <>
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 flex bg-card/90 backdrop-blur-xl border-t border-border pt-2.5 pb-3.5 px-1">
        <NavItems pathname={pathname} />
      </nav>

      <div className="hidden md:flex fixed inset-x-0 bottom-5 z-40 justify-center pointer-events-none">
        <nav className="pointer-events-auto flex w-80 justify-center gap-2 rounded-full border border-border bg-card/90 backdrop-blur-xl py-3 px-4 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
          <NavItems pathname={pathname} />
        </nav>
      </div>
    </>
  );
}
