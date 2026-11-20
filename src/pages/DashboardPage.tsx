import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarRange, ChevronRight, Plus, Shapes, ShieldAlert, Trophy, Users } from "lucide-react";
import { GENDER_LABEL, type Gender } from "@shared/constants";
import type { DashboardData, Tournament } from "@shared/types";
import { api } from "@/lib/api";
import { dateParts, formatDate, formatLongDate, formatRange, plural, relativeTime } from "@/lib/format";
import { keys } from "@/hooks/data";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState, ErrorState, Spinner, Stat } from "@/components/ui/misc";
import { SeasonStatusBadge, TournamentStatusBadge, TournamentTypeBadge } from "@/components/ui/badges";
import { cn } from "@/lib/cn";

function TournamentRow({ t }: { t: Tournament }) {
  return (
    <li>
      <Link to={`/torneos/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
        <div className="flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-lg bg-white ring-1 ring-brand-100">
          <span className="w-full bg-brand-700 py-0.5 text-center text-[10px] font-semibold uppercase text-white">{dateParts(t.startDate).weekday}</span>
          <span className="tabular pt-0.5 font-display text-xl font-semibold leading-tight text-navy">{dateParts(t.startDate).day}</span>
          <span className="pb-1 text-[10px] uppercase text-slate-500">{dateParts(t.startDate).month}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{t.name}</p>
          <p className="truncate text-xs text-slate-500">
            {t.categoryName} {GENDER_LABEL[t.gender]}{t.divisionName ? ` · ${t.divisionName}` : ""} · {formatRange(t.startDate, t.endDate)}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5"><TournamentTypeBadge type={t.type} /><TournamentStatusBadge status={t.status} /></div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden />
      </Link>
    </li>
  );
}

function CategoryBars({ data }: { data: DashboardData["playersByCategory"] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const groups: Gender[] = ["M", "F"];
  return (
    <div className="grid gap-6 p-4 sm:grid-cols-2 sm:p-5">
      {groups.map((g) => {
        const rows = data.filter((d) => d.gender === g);
        return (
          <div key={g}>
            <h3 className="mb-3 font-brand text-xs font-bold uppercase tracking-wider text-slate-500">{GENDER_LABEL[g]}</h3>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-400">Sin categorías activas.</p>
            ) : (
              <ul className="space-y-2.5">
                {rows.map((r) => (
                  <li key={r.categoryId}>
                    <Link to={`/jugadores?categoryId=${r.categoryId}`} className="group block">
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-medium text-slate-700 group-hover:text-brand-700">{r.name}</span>
                        <span className="tabular text-slate-500">{r.count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                        <div
                          className={cn("h-full rounded-full", g === "M" ? "bg-brand-600" : "bg-ball-400")}
                          style={{ width: `${(r.count / max) * 100}%` }}
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<DashboardData>("/dashboard") });

  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const s = d.activeSeason;
  const firstName = user?.displayName.split(" ")[0];

  return (
    <div className="space-y-6">
      {/* Encabezado con las diagonales azul y verde del banner de la web oficial */}
      <div className="relative overflow-hidden rounded-2xl bg-white px-5 py-6 shadow-sm ring-1 ring-slate-200/80 sm:px-8 sm:py-7">
        <svg className="pointer-events-none absolute bottom-0 left-0 h-6 w-24 sm:h-10 sm:w-44" viewBox="0 0 256 80" preserveAspectRatio="none" aria-hidden>
          <path d="M0 0 L256 80 L0 80Z" fill="#0f5a93" />
        </svg>
        <svg className="pointer-events-none absolute bottom-0 right-0 h-10 w-28 sm:h-24 sm:w-64" viewBox="0 0 288 112" preserveAspectRatio="none" aria-hidden>
          <path d="M288 30 L0 112 L288 112Z" fill="#0f5a93" />
          <path d="M288 0 L60 112 L288 112Z" fill="#57aa57" />
        </svg>
        <div className="relative flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <img src="/brand/padeltime-simbolo.png" alt="" width={64} height={64} className="hidden size-16 sm:block" />
          <div>
            <p className="font-brand text-xs font-bold uppercase tracking-wider text-ball-500">{formatLongDate(d.today)}</p>
            <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-navy sm:text-3xl">¡Hola, {firstName}!</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/jugadores?nuevo=1"><Button variant="secondary" icon={<Plus className="size-4" />}>Jugador</Button></Link>
          <Link to="/torneos?nuevo=1"><Button icon={<Plus className="size-4" />}>Torneo</Button></Link>
        </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat
          label="Jugadores activos"
          value={d.players.active}
          icon={<Users className="size-4" />}
          sub={`${d.players.byGender.M} caballeros · ${d.players.byGender.F} damas`}
        />
        <Stat
          label="Categorías"
          value={d.categories.active}
          tone="sky"
          icon={<Shapes className="size-4" />}
          sub={`${d.categories.byGender.M} caballeros · ${d.categories.byGender.F} damas`}
        />
        <Stat
          label="Torneos en curso"
          value={d.tournaments.inProgress}
          tone="ball"
          icon={<Activity className="size-4" />}
          sub={s ? `${d.tournaments.scheduled} programados` : "Sin temporada activa"}
        />
        <Stat
          label="Finalizados"
          value={d.tournaments.finished}
          tone="amber"
          icon={<Trophy className="size-4" />}
          sub={s ? `en ${s.name}` : "Sin temporada activa"}
        />
      </div>

      <Card className="overflow-hidden">
        {s ? (
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-brand-700 p-2.5 text-white"><CalendarRange className="size-5" /></div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold tracking-wide text-navy">{s.name}</h2>
                  <SeasonStatusBadge status={s.status} />
                </div>
                <p className="text-xs text-slate-500">{formatDate(s.startDate)} al {formatDate(s.endDate)} · {plural(s.tournamentCount, "torneo")}</p>
              </div>
            </div>
            <div className="flex-1 sm:pl-6">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Avance de la temporada</span>
                <span className="tabular font-medium text-slate-700">{Math.round(s.progress * 100)}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(s.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la temporada">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-ball-400" style={{ width: `${s.progress * 100}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<CalendarRange className="size-6" />}
            title="No hay una temporada activa"
            description="Creá la temporada del año y activala para empezar a cargar torneos."
            action={<Link to="/temporadas"><Button variant="secondary">Ir a temporadas</Button></Link>}
          />
        )}
      </Card>

      {d.pendingCredits.length > 0 && (
        <Card className="ring-amber-300">
          <CardHeader title="Pendientes de acreditar" subtitle="Torneos finalizados cuyos puntos todavía no se confirmaron" />
          <ul className="divide-y divide-slate-100">
            {d.pendingCredits.map((t) => (
              <li key={t.id}>
                <Link to={`/torneos/${t.id}?tab=acreditacion`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <ShieldAlert className="size-5 shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{t.name}</p>
                    <p className="truncate text-xs text-slate-500">{t.categoryName} {GENDER_LABEL[t.gender]} · {formatRange(t.startDate, t.endDate)} · {plural(t.teamCount, "pareja")}</p>
                  </div>
                  <span className="text-xs font-medium text-amber-700">Acreditar</span>
                  <ChevronRight className="size-4 shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="En curso" action={<Link to="/torneos?status=en_curso" className="text-xs font-medium text-brand-700 hover:underline">Ver todos</Link>} />
          {d.inProgress.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No hay torneos en curso.</p>
          ) : (
            <ul className="divide-y divide-slate-100">{d.inProgress.map((t) => <TournamentRow key={t.id} t={t} />)}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Próximos torneos" action={<Link to="/torneos?status=programado" className="text-xs font-medium text-brand-700 hover:underline">Ver todos</Link>} />
          {d.upcoming.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No hay torneos programados.</p>
          ) : (
            <ul className="divide-y divide-slate-100">{d.upcoming.map((t) => <TournamentRow key={t.id} t={t} />)}</ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Jugadores activos por categoría principal" subtitle="Cada jugador suma puntos en el ranking de su categoría principal" />
          {d.playersByCategory.length === 0 ? (
            <EmptyState
              icon={<Shapes className="size-6" />}
              title="Todavía no hay categorías"
              action={<Link to="/categorias"><Button variant="secondary">Crear categorías</Button></Link>}
            />
          ) : (
            <CategoryBars data={d.playersByCategory} />
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Actividad reciente" />
          {d.recentActivity.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">Sin actividad todavía.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recentActivity.map((a) => (
                <li key={a.id} className="px-4 py-2.5 sm:px-5">
                  <p className="text-sm text-slate-700">{a.summary}</p>
                  <p className="text-xs text-slate-400">{a.userName ?? "Sistema"} · {relativeTime(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

