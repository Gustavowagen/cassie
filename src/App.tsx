import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthListener } from "./hooks/useAuth";
import { Layout } from "./components/Layout";
import { AuthGuard } from "./components/AuthGuard";
import { Home } from "./pages/Home";
import { Auth } from "./pages/Auth";
import { CreateCasino } from "./pages/CreateCasino";
import { BrowseCasinos } from "./pages/BrowseCasinos";
import { Profile } from "./pages/Profile";
import { CasinoDashboard } from "./pages/CasinoDashboard";
import { CasinoGame } from "./pages/CasinoGame";
import { ConfirmEmail } from "./pages/ConfirmEmail";
import { SetupNickname } from "./pages/SetupNickname";
import { NotFound } from "./pages/NotFound";
import { OlympusShowcase } from "./pages/OlympusShowcase";

function AppRoutes() {
  useAuthListener();
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/confirm-email" element={<ConfirmEmail />} />
      <Route path="/setup-nickname" element={<SetupNickname />} />
      <Route
        path="/create"
        element={
          <AuthGuard>
            <CreateCasino />
          </AuthGuard>
        }
      />
      <Route
        path="/browse"
        element={
          <AuthGuard>
            <BrowseCasinos />
          </AuthGuard>
        }
      />
      <Route path="/casino/:slug" element={<CasinoDashboard />} />
      {/* Big games (Gates of Olympus onward) play fullscreen on their own
          route instead of in the dashboard modal the quick games use. */}
      <Route path="/casino/:slug/play/:gameId" element={<CasinoGame />} />
      <Route path="/profile" element={<Profile />} />
      {/* Design showcase — no auth, no casino, nothing wagered. */}
      <Route path="/showcase/olympus" element={<OlympusShowcase />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <AppRoutes />
      </Layout>
    </BrowserRouter>
  );
}
