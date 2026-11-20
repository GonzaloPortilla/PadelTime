import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Spinner } from "@/components/ui/misc";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { PlayersPage } from "@/pages/PlayersPage";
import { PlayerDetailPage } from "@/pages/PlayerDetailPage";
import { CategoriesPage } from "@/pages/CategoriesPage";
import { SeasonsPage } from "@/pages/SeasonsPage";
import { TournamentsPage } from "@/pages/TournamentsPage";
import { UsersPage } from "@/pages/UsersPage";
import { AccountPage } from "@/pages/AccountPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { TournamentPage } from "@/pages/tournament/TournamentPage";
import { RankingsPage } from "@/pages/RankingsPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { MovementsPage } from "@/pages/MovementsPage";
import { RankingImportPage } from "@/pages/rankingImport/RankingImportPage";
import { PublicationPage } from "@/pages/PublicationPage";
import type { ReactNode } from "react";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner className="min-h-dvh" label="Cargando Padel Time…" />;
  if (!user) return <Navigate to="/ingresar" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/ingresar" element={<LoginPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="jugadores" element={<PlayersPage />} />
        <Route path="jugadores/:id" element={<PlayerDetailPage />} />
        <Route path="torneos" element={<TournamentsPage />} />
        <Route path="torneos/:id" element={<TournamentPage />} />
        <Route path="rankings" element={<RankingsPage />} />
        <Route path="importar-rankings" element={<RankingImportPage />} />
        <Route path="publicacion" element={<PublicationPage />} />
        <Route path="puntuacion" element={<TemplatesPage />} />
        <Route path="movimientos" element={<MovementsPage />} />
        <Route path="temporadas" element={<SeasonsPage />} />
        <Route path="categorias" element={<CategoriesPage />} />
        <Route path="usuarios" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        <Route path="cuenta" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
