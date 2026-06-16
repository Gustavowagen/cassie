import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthListener } from "./hooks/useAuth";
import { Layout } from "./components/Layout";
import { AuthGuard } from "./components/AuthGuard";
import { Home } from "./pages/Home";
import { Auth } from "./pages/Auth";
import { CreateCasino } from "./pages/CreateCasino";
import { CasinoDashboard } from "./pages/CasinoDashboard";
import { CasinoAdmin } from "./pages/CasinoAdmin";
import { ConfirmEmail } from "./pages/ConfirmEmail";
import { SetupNickname } from "./pages/SetupNickname";
import { NotFound } from "./pages/NotFound";

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
      <Route path="/casino/:slug" element={<CasinoDashboard />} />
      <Route
        path="/casino/:slug/admin"
        element={
          <AuthGuard>
            <CasinoAdmin />
          </AuthGuard>
        }
      />
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
