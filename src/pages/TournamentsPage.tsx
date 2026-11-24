import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus, ShieldCheck, Trophy } from "lucide-react";
import { GENDER_LABEL, TOURNAMENT_STATUS_LABEL, TOURNAMENT_STATUSES, TOURNAMENT_TYPE_LABEL, eventStatus } from "@shared/constants";
import type { Tournament } from "@shared/types";
import { api, toQuery } from "@/lib/api";
import { capitalize, dateParts, formatDayMonth } from "@/lib/format";
import { keys, useDebounced, useSeasons } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { FilterSelect } from "@/components/ui/Field";
import { Card, EmptyState, ErrorState, PageHeader, SearchInput, Spinner } from "@/components/ui/misc";
import { TournamentStatusBadge, TournamentTypeBadge } from "@/components/ui/badges";
import { TorneoForm } from "@/components/forms/TorneoForm";

export function TournamentsPage() {
  const [params, setParams] = useSearchParams();
  const seasons = useSeasons();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const seasonId = params.get("seasonId") ?? "";
  const gender = params.get("gender") ?? "";
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "";
  const legacyId = Number(params.get("id")) || null;
  const creating = params.get("nuevo") === "1";
  const navigate = useNavigate();

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: [...keys.tournaments, "list", { q, seasonId, gender, type, status }],
    queryFn: async () => (await api.get<{ items: Tournament[] }>(`/tournaments${toQuery({ q, seasonId, gender, type, status })}`)).items,
    placeholderData: keepPreviousData,
  });

  // Un torneo (evento) con sus categorías; agrupados por mes para facilitar la lectura.
  const groups = useMemo(() => {
    const events = new Map<number, Tournament[]>();
    for (const t of query.data ?? []) {
      const key = t.eventId ?? -t.id;
      events.set(key, [...(events.get(key) ?? []), t]);
    }
    const map = new Map<string, Tournament[][]>();
    for (const comps of events.values()) {
      const key = comps[0]!.startDate.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), comps]);
    }
    return [...map.entries()];
  }, [query.data]);
  const monthLabel = (ym: string) =>
    capitalize(new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`)));

  const filtered = q || seasonId || gender || type || status;
  // Compatibilidad con enlaces anteriores (/torneos?id=N).
  if (legacyId) return <Navigate to={`/torneos/${legacyId}`} replace />;

  return (
    <>
      <PageHeader
        title="Torneos"
        description="Cada torneo puede tener varias categorías: cada una es una competencia con sus parejas, fixture y puntos."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => update({ nuevo: "1" })}>Nuevo torneo</Button>}
      />
      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:p-4 lg:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre, sede o categoría" className="flex-1" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
            <FilterSelect value={seasonId} aria-label="Filtrar por temporada" onChange={(e) => update({ seasonId: e.target.value })}>
              <option value="">Temporadas</option>
              {(seasons.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FilterSelect>
            <FilterSelect value={gender} aria-label="Filtrar por rama" onChange={(e) => update({ gender: e.target.value })}>
              <option value="">Ambas ramas</option>
              <option value="M">{GENDER_LABEL.M}</option>
              <option value="F">{GENDER_LABEL.F}</option>
            </FilterSelect>
            <FilterSelect value={type} aria-label="Filtrar por tipo" onChange={(e) => update({ type: e.target.value })}>
              <option value="">Tipos</option>
              <option value="largo">{TOURNAMENT_TYPE_LABEL.largo}</option>
              <option value="americano">{TOURNAMENT_TYPE_LABEL.americano}</option>
            </FilterSelect>
            <FilterSelect value={status} aria-label="Filtrar por estado" onChange={(e) => update({ status: e.target.value })}>
              <option value="">Estados</option>
              {TOURNAMENT_STATUSES.map((s) => <option key={s} value={s}>{TOURNAMENT_STATUS_LABEL[s]}</option>)}
            </FilterSelect>
          </div>
        </div>

        {query.isPending ? <Spinner /> : query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> :
          query.data.length === 0 ? (
            <EmptyState icon={<Trophy className="size-6" />}
              title={filtered ? "No hay torneos con esos filtros" : "Todavía no hay torneos"}
              description={filtered ? undefined : "Cargá el primer torneo de la temporada."}
              action={!filtered ? <Button variant="secondary" onClick={() => update({ nuevo: "1" })}>Nuevo torneo</Button> : undefined} />
          ) : (
            <div>
              {groups.map(([ym, items]) => (
                <section key={ym}>
                  <h2 className="sticky top-14 z-10 border-b border-slate-100 bg-slate-50/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur sm:px-5 lg:top-0">
                    {monthLabel(ym)}
                  </h2>
                  <ul className="divide-y divide-slate-100">
                    {items.map((comps) => {
                      const t = comps[0]!;
                      const status = eventStatus(comps.map((c) => c.status));
                      return (
                        <li key={t.eventId ?? t.id} className="px-4 py-3 sm:px-5">
                          <button type="button" onClick={() => navigate(`/torneos/${t.id}`)} className="flex w-full items-center gap-3 text-left sm:gap-4">
                            <div className="w-12 shrink-0 text-center sm:w-14">
                              <p className="text-[10px] font-semibold uppercase text-slate-500">{dateParts(t.startDate).weekday}</p>
                              <p className="tabular text-lg font-bold leading-tight text-slate-900">{dateParts(t.startDate).day}</p>
                              {t.endDate !== t.startDate && <p className="whitespace-nowrap text-[10px] text-slate-400">al {formatDayMonth(t.endDate)}</p>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-slate-900">{t.eventName ?? t.name}</p>
                              <p className="truncate text-xs text-slate-500">
                                {comps.length === 1 ? `${t.categoryName} ${GENDER_LABEL[t.gender]}${t.divisionName ? ` · ${t.divisionName}` : ""}` : `${comps.length} categorías`}{t.venue ? ` · ${t.venue}` : ""}
                              </p>
                            </div>
                            <div className="hidden items-center gap-2 sm:flex">
                              <TournamentTypeBadge type={t.type} />
                              <TournamentStatusBadge status={status} />
                            </div>
                            <ChevronRight className="size-4 shrink-0 text-slate-300" />
                          </button>
                          <div className="mt-2 flex flex-wrap gap-1.5 pl-[3.75rem] sm:pl-[4.5rem]">
                            <span className="sm:hidden"><TournamentTypeBadge type={t.type} /></span>
                            {comps.map((c) => (
                              <Link key={c.id} to={`/torneos/${c.id}`} aria-label={`Categoría ${c.categoryName}${c.divisionName ? ` ${c.divisionName}` : ""}: ${TOURNAMENT_STATUS_LABEL[c.status]}`}
                                className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-brand-50 hover:ring-brand-300">
                                {c.categoryName}{c.divisionName ? ` · ${c.divisionName}` : ""}
                                <span className="text-slate-400">·</span><span className="text-slate-500">{TOURNAMENT_STATUS_LABEL[c.status]}</span>
                                {c.creditedVersion !== null && <ShieldCheck className="size-3 text-ball-600" aria-label="Acreditado" />}
                              </Link>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
      </Card>

      {creating && (
        <TorneoForm
          event={null}
          onClose={() => update({ nuevo: null })}
          onSaved={(e) => navigate(`/torneos/${e.tournaments[0]!.id}?tab=parejas`)}
        />
      )}
    </>
  );
}
