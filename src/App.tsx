import { Navigate, Route, Routes, useLocation } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { Spinner } from "@/components/ui/misc";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { PlayersPage } from "@/pages/PlayersPage";
import { CategoriesPage } from "@/pages/CategoriesPage";
import { SeasonsPage } from "@/pages/SeasonsPage";
import { TournamentsPage } from "@/pages/TournamentsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

/** Pantallas que se descargan recién al abrirlas (el celular carga primero sólo lo de uso diario). */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Lazy = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return function LazyPage() {
    return (
      <Suspense fallback={<Spinner className="py-20" label="Cargando…" />}>
        <Lazy />
      </Suspense>
    );
  };
}
const UsersPage = page(() => import("@/pages/UsersPage"), "UsersPage");
const BackupPage = page(() => import("@/pages/BackupPage"), "BackupPage");
const AccountPage = page(() => import("@/pages/AccountPage"), "AccountPage");
const TournamentPage = page(() => import("@/pages/tournament/TournamentPage"), "TournamentPage");
const RankingsPage = page(() => import("@/pages/RankingsPage"), "RankingsPage");
const TemplatesPage = page(() => import("@/pages/TemplatesPage"), "TemplatesPage");
const MovementsPage = page(() => import("@/pages/MovementsPage"), "MovementsPage");
const RankingImportPage = page(() => import("@/pages/rankingImport/RankingImportPage"), "RankingImportPage");
const PublicationPage = page(() => import("@/pages/PublicationPage"), "PublicationPage");
const PlayerDetailPage = page(() => import("@/pages/PlayerDetailPage"), "PlayerDetailPage");

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
        <Route path="respaldo" element={<RequireAdmin><BackupPage /></RequireAdmin>} />
        <Route path="cuenta" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
