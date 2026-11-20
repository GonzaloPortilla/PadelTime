import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookOpenCheck } from "lucide-react";
import { MOVEMENT_KIND_LABEL, MOVEMENT_KINDS } from "@shared/constants";
import type { Paginated, PointMovement } from "@shared/types";
import { api, toQuery } from "@/lib/api";
import { keys, useSeasons } from "@/hooks/data";
import { FilterSelect } from "@/components/ui/Field";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/Pagination";
import { MovementList } from "@/components/MovementList";

const PAGE_SIZE = 50;

export function MovementsPage() {
  const [params, setParams] = useSearchParams();
  const seasons = useSeasons();
  const seasonId = params.get("seasonId") ?? "";
  const kind = params.get("kind") ?? "";
  const tournamentId = params.get("tournamentId") ?? "";
  const playerId = params.get("playerId") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };
  const q = useQuery({
    queryKey: [...keys.movements, { seasonId, kind, tournamentId, playerId, page }],
    queryFn: () => api.get<Paginated<PointMovement>>(`/movements${toQuery({ seasonId, kind, tournamentId, playerId, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Registro de movimientos"
        description="Fuente de verdad de los puntos. Es inmutable: las correcciones y reversiones se registran como nuevos movimientos." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 sm:p-4">
          <FilterSelect value={seasonId} aria-label="Temporada" onChange={(e) => update({ seasonId: e.target.value })}>
            <option value="">Temporadas</option>
            {(seasons.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FilterSelect>
          <FilterSelect value={kind} aria-label="Tipo de movimiento" onChange={(e) => update({ kind: e.target.value })}>
            <option value="">Todos los tipos</option>
            {MOVEMENT_KINDS.map((k) => <option key={k} value={k}>{MOVEMENT_KIND_LABEL[k]}</option>)}
          </FilterSelect>
          {(tournamentId || playerId) && (
            <button type="button" onClick={() => update({ tournamentId: null, playerId: null })} className="rounded-lg px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">
              Quitar filtro de {tournamentId ? "torneo" : "jugador"} ✕
            </button>
          )}
        </div>
        {q.isPending ? <Spinner /> : q.isError ? <ErrorState message={q.error.message} /> : q.data.items.length === 0 ? (
          <EmptyState icon={<BookOpenCheck className="size-6" />} title="Sin movimientos" description="Los movimientos aparecen cuando se acreditan torneos o se registran ajustes." />
        ) : (
          <>
            <MovementList items={q.data.items} showPlayer />
            <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onChange={(p) => update({ page: String(p) })} />
          </>
        )}
      </Card>
    </>
  );
}
