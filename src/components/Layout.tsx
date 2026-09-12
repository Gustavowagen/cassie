import { useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";

// Routes that happen before someone is "in" the app — no tab bar chrome.
const NO_NAV_ROUTES = ["/auth", "/confirm-email", "/setup-nickname"];

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const showNav =
    !NO_NAV_ROUTES.includes(pathname) &&
    !pathname.startsWith("/casino/") &&
    !pathname.startsWith("/showcase/");
  // Design showcases and the fullscreen big-game route paint their own
  // edge-to-edge scene, so they opt out of the centred content container as
  // well as the tab bar (which /casino/ already drops).
  const fullBleed =
    pathname.startsWith("/showcase/") || /^\/casino\/[^/]+\/play\//.test(pathname);

  return (
    <div className="min-h-screen bg-background">
      <main
        className={
          fullBleed ? "" : `container mx-auto px-4 py-6 ${showNav ? "pb-28 md:pb-24" : ""}`
        }
      >
        {children}
      </main>
      {showNav && <BottomNav />}
    </div>
  );
}
