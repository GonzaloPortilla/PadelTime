import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus, Users } from "lucide-react";
import { GENDER_LABEL, type Gender } from "@shared/constants";
import type { Paginated, Player } from "@shared/types";
import { api, toQuery } from "@/lib/api";
import { keys, useCategories, useDebounced } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { FilterSelect } from "@/components/ui/Field";
import { Card, EmptyState, ErrorState, PageHeader, SearchInput, Spinner } from "@/components/ui/misc";
import { ActiveBadge, GenderBadge } from "@/components/ui/badges";
import { Pagination } from "@/components/ui/Pagination";
import { PlayerForm } from "@/components/forms/PlayerForm";

const PAGE_SIZE = 25;

export function PlayersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const categories = useCategories();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search.trim());
  const gender = (params.get("gender") ?? "") as Gender | "";
  const categoryId = params.get("categoryId") ?? "";
  const status = params.get("status") ?? "activos";
  const page = Number(params.get("page") ?? 1) || 1;
  const creating = params.get("nuevo") === "1";

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, val] of Object.entries(changes)) {
      if (val === null || val === "") next.delete(k);
      else next.set(k, val);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  // Sincroniza el texto de búsqueda con la URL (sin recargar la lista en cada tecla).
  useEffect(() => {
    if ((params.get("q") ?? "") !== q) update({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = useQuery({
    queryKey: [...keys.players, "list", { q, gender, categoryId, status, page }],
    queryFn: () =>
      api.get<Paginated<Player>>(`/players${toQuery({ q, gender, categoryId, status, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const categoryOptions = useMemo(
    () => (categories.data ?? []).filter((c) => !gender || c.gender === gender),
    [categories.data, gender],
  );

  const selectedCategory = categories.data?.find((c) => String(c.id) === categoryId);

  return (
    <>
      <PageHeader
        title="Jugadores"
        description="Cada jugador tiene un código interno único, aunque haya homónimos."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => update({ nuevo: "1" })}>Nuevo jugador</Button>}
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:p-4 lg:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre, apellido, apodo, DNI o código" className="flex-1" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
            <FilterSelect value={gender} aria-label="Filtrar por rama" onChange={(e) => update({ gender: e.target.value, categoryId: null })}>
              <option value="">Ambas ramas</option>
              <option value="M">{GENDER_LABEL.M}</option>
              <option value="F">{GENDER_LABEL.F}</option>
            </FilterSelect>
            <FilterSelect value={categoryId} className="col-span-2 sm:col-span-1" aria-label="Filtrar por categoría" onChange={(e) => update({ categoryId: e.target.value })}>
              <option value="">Todas las categorías</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{gender ? "" : ` · ${GENDER_LABEL[c.gender]}`}</option>
              ))}
            </FilterSelect>
            <FilterSelect value={status} aria-label="Filtrar por estado" onChange={(e) => update({ status: e.target.value === "activos" ? null : e.target.value })}>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </FilterSelect>
          </div>
        </div>

        {query.isPending ? (
          <Spinner />
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title={q || gender || categoryId || status !== "activos" ? "No hay jugadores con esos filtros" : "Todavía no hay jugadores"}
            description={q ? "Probá con otra parte del nombre: la búsqueda ignora acentos y mayúsculas." : "Cargá el primer jugador para empezar."}
            action={!q ? <Button variant="secondary" onClick={() => update({ nuevo: "1" })}>Nuevo jugador</Button> : undefined}
          />
        ) : (
          <>
            {/* Tabla en escritorio */}
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5">Jugador</th>
                  <th className="px-3 py-2.5">Código</th>
                  <th className="px-3 py-2.5">Rama</th>
                  <th className="px-3 py-2.5">Categoría principal</th>
                  <th className="px-3 py-2.5">Localidad</th>
                  <th className="px-3 py-2.5">Estado</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {query.data.items.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/jugadores/${p.id}`)}>
                    <td className="px-5 py-3">
                      <Link to={`/jugadores/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
                        {p.lastName}, {p.firstName}
                      </Link>
                      {p.nickname && <span className="ml-1.5 text-slate-400">“{p.nickname}”</span>}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">{p.code}</td>
                    <td className="px-3 py-3"><GenderBadge gender={p.gender} /></td>
                    <td className="px-3 py-3 text-slate-700">{p.mainCategoryName}</td>
                    <td className="px-3 py-3 text-slate-500">{p.city ?? "—"}</td>
                    <td className="px-3 py-3"><ActiveBadge active={p.active} /></td>
                    <td className="pr-4"><ChevronRight className="size-4 text-slate-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Lista en celulares */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {query.data.items.map((p) => (
                <li key={p.id}>
                  <Link to={`/jugadores/${p.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {p.lastName}, {p.firstName}
                        {p.nickname && <span className="ml-1 font-normal text-slate-400">“{p.nickname}”</span>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-mono">{p.code}</span>·<span>{p.mainCategoryName} {GENDER_LABEL[p.gender]}</span>
                        {!p.active && <ActiveBadge active={false} />}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onChange={(p) => update({ page: String(p) })} />
          </>
        )}
      </Card>

      {creating && (
        <PlayerForm
          player={null}
          defaults={{ gender: gender || selectedCategory?.gender, mainCategoryId: selectedCategory?.id }}
          onClose={() => update({ nuevo: null })}
        />
      )}
    </>
  );
}
