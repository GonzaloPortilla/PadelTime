import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileSpreadsheet, FileText, Globe, ListOrdered, Medal, Plus, Settings2, Trash2 } from "lucide-react";
import { GENDER_LABEL, TIEBREAKER_LABEL, TIEBREAKERS, type Gender, type Gender as G, type Tiebreaker } from "@shared/constants";
import type { RankingResponse, RankingRow } from "@shared/types";
import { api, ApiError, toQuery } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { CSV_MIME, XLSX_MIME, slug, toCsv, toXlsx } from "@/lib/export";
import { downloadFile } from "@/lib/download";
import { RANKING_HEADER, rankingRows, rankingSheet } from "@/lib/rankingExport";
import { keys, useCategories, useSeasons } from "@/hooks/data";
import { Button, IconButton } from "@/components/ui/Button";
import { FilterSelect } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

function TiebreakersDialog({ seasonId, current, readOnly, onClose }: { seasonId: number; current: Tiebreaker[]; readOnly: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [list, setList] = useState<Tiebreaker[]>(current);
  const [error, setError] = useState<string | null>(null);
  const available = TIEBREAKERS.filter((t) => !list.includes(t));
  const save = useMutation({
    mutationFn: () => api.put(`/rankings/tiebreakers/${seasonId}`, { tiebreakers: list }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.rankings });
      toast("Reglas de desempate actualizadas");
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : "Error inesperado"),
  });
  const move = (i: number, d: -1 | 1) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setList(next);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Reglas de desempate"
      description="Se aplican en orden cuando dos jugadores tienen los mismos puntos. Si siguen empatados, comparten la posición."
      footer={readOnly ? <Button variant="secondary" onClick={onClose}>Cerrar</Button> : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button>
        </>
      )}
    >
      <ol className="space-y-2">
        <li className="flex items-center gap-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700"><span className="w-5 text-center text-xs text-slate-400">—</span>Más puntos (siempre primero)</li>
        {list.map((t, i) => (
          <li key={t} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200">
            <span className="w-5 text-center text-xs font-bold text-slate-400">{i + 1}</span>
            <span className="flex-1 text-slate-800">{TIEBREAKER_LABEL[t]}</span>
            {!readOnly && (
              <>
                <IconButton label="Subir" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp className="size-4" /></IconButton>
                <IconButton label="Bajar" disabled={i === list.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown className="size-4" /></IconButton>
                <IconButton label={`Quitar ${TIEBREAKER_LABEL[t]}`} onClick={() => setList(list.filter((x) => x !== t))} className="hover:text-red-600"><Trash2 className="size-4" /></IconButton>
              </>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && available.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Agregar criterio</p>
          <div className="flex flex-wrap gap-2">
            {available.map((t) => (
              <button key={t} type="button" onClick={() => setList([...list, t])}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-600/30 hover:bg-brand-50">
                <Plus className="size-3" />{TIEBREAKER_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      )}
      {readOnly && <p className="mt-3 text-xs text-slate-500">La temporada está cerrada: sus reglas no se pueden modificar.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
    </Modal>
  );
}

function PositionCell({ r }: { r: RankingRow }) {
  const medal = r.position <= 3 ? ["bg-ball-400 text-ink-950", "bg-slate-200 text-slate-700", "bg-amber-200 text-amber-900"][r.position - 1] : "text-slate-500";
  return (
    <span className={cn("inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm font-bold tabular", medal)} title={r.tied ? "Posición compartida" : undefined}>
      {r.position}{r.tied && "="}
    </span>
  );
}

export function RankingsPage() {
  const [params, setParams] = useSearchParams();
  const seasons = useSeasons();
  const categories = useCategories();
  const toast = useToast();
  const [showTiebreakers, setShowTiebreakers] = useState(false);
  const [exporting, setExporting] = useState(false);

  const defaultSeason = seasons.data?.find((s) => s.status === "activa") ?? seasons.data?.[0];
  const seasonId = params.get("seasonId") ?? (defaultSeason ? String(defaultSeason.id) : "");
  const gender = (params.get("gender") ?? "M") as Gender;
  const genderCats = useMemo(() => (categories.data ?? []).filter((c) => c.gender === gender).sort((a, b) => a.level - b.level), [categories.data, gender]);
  const categoryId = params.get("categoryId") ?? (genderCats.find((c) => c.active) ?? genderCats[0])?.id.toString() ?? "";
  const category = categories.data?.find((c) => String(c.id) === categoryId);
  const divisionId = params.get("divisionId") ?? "";

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    if (!next.get("seasonId") && seasonId) next.set("seasonId", seasonId);
    for (const [k, v] of Object.entries(changes)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  // Si la categoría elegida no es de la rama, se limpia.
  useEffect(() => {
    if (category && category.gender !== gender) update({ categoryId: null, divisionId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gender]);

  const query = useQuery({
    queryKey: [...keys.rankings, seasonId, categoryId, divisionId],
    queryFn: () => api.get<RankingResponse>(`/rankings${toQuery({ seasonId, categoryId, divisionId })}`),
    enabled: !!seasonId && !!categoryId && (!category || category.gender === gender),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const season = seasons.data?.find((s) => String(s.id) === seasonId);
  const hasBalance = !!data?.rows.some((r) => r.initialBalance !== 0);
  const publicPath = data ? `/publico/ranking/${data.season.id}/${data.category.id}${data.division ? `/${data.division.id}` : ""}` : null;

  const exportCsv = () => {
    if (!data) return;
    downloadFile(toCsv(RANKING_HEADER, rankingRows(data.rows)), `${slug("ranking", data.category.name, GENDER_LABEL[data.category.gender], data.division?.name ?? "", data.season.name)}.csv`, CSV_MIME);
  };
  const exportXlsx = () => {
    if (!data) return;
    const sheet = rankingSheet({ seasonName: data.season.name, category: data.category, divisionName: data.division?.name, tiebreakers: data.tiebreakers, rows: data.rows, generatedAt: data.generatedAt });
    downloadFile(toXlsx([sheet]), `${slug("ranking", data.category.name, GENDER_LABEL[data.category.gender], data.division?.name ?? "", data.season.name)}.xlsx`, XLSX_MIME);
  };
  const exportSeason = async () => {
    if (!season) return;
    setExporting(true);
    try {
      const book = await api.get<{ season: { name: string }; tiebreakers: Tiebreaker[]; categories: { category: { name: string; gender: G }; rows: RankingRow[] }[]; generatedAt: string }>(`/rankings/season/${season.id}`);
      if (book.categories.length === 0) {
        toast("La temporada todavía no tiene puntos acreditados", "error");
        return;
      }
      const sheets = book.categories.map((c) => rankingSheet({ seasonName: book.season.name, category: c.category, tiebreakers: book.tiebreakers, rows: c.rows, generatedAt: book.generatedAt }));
      downloadFile(toXlsx(sheets), `${slug("rankings", book.season.name)}.xlsx`, XLSX_MIME);
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo exportar", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Rankings"
        description="Cada jugador suma en su categoría principal. Los rankings se reinician cada temporada y las anteriores se conservan."
        actions={
          <>
            <Button variant="secondary" icon={<Settings2 className="size-4" />} disabled={!data} onClick={() => setShowTiebreakers(true)}>Desempates</Button>
            <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} loading={exporting} disabled={!season} onClick={() => void exportSeason()}>Temporada completa</Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:p-4 lg:flex-row lg:items-center">
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
            <FilterSelect value={seasonId} aria-label="Temporada" onChange={(e) => update({ seasonId: e.target.value })}>
              {(seasons.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "activa" ? " (activa)" : s.status === "cerrada" ? " (cerrada)" : ""}</option>)}
            </FilterSelect>
            <FilterSelect value={gender} aria-label="Rama" onChange={(e) => update({ gender: e.target.value, categoryId: null, divisionId: null })}>
              <option value="M">{GENDER_LABEL.M}</option>
              <option value="F">{GENDER_LABEL.F}</option>
            </FilterSelect>
            <FilterSelect value={categoryId} aria-label="Categoría" onChange={(e) => update({ categoryId: e.target.value, divisionId: null })}>
              {genderCats.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.active ? " (inactiva)" : ""}</option>)}
            </FilterSelect>
            <FilterSelect value={divisionId} aria-label="División" disabled={!category?.divisions.length} onChange={(e) => update({ divisionId: e.target.value })}>
              <option value="">Todas las divisiones</option>
              {category?.divisions.map((d) => <option key={d.id} value={d.id}>División {d.name}</option>)}
            </FilterSelect>
          </div>
          <div className="flex gap-2">
            {publicPath && (
              <a href={publicPath} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
                <Globe className="size-4" /> Página pública
              </a>
            )}
            <Button size="sm" variant="ghost" icon={<FileText className="size-4" />} disabled={!data?.rows.length} onClick={exportCsv}>CSV</Button>
            <Button size="sm" variant="subtle" icon={<FileSpreadsheet className="size-4" />} disabled={!data?.rows.length} onClick={exportXlsx}>Excel</Button>
          </div>
        </div>

        {!seasonId || !categoryId ? (
          <EmptyState icon={<ListOrdered className="size-6" />} title="Faltan datos" description="Creá una temporada y categorías para ver rankings." />
        ) : query.isPending ? <Spinner /> : query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : data!.rows.length === 0 ? (
          <EmptyState icon={<Medal className="size-6" />} title="Sin puntos todavía" description="Cuando se acrediten torneos, el ranking aparecerá acá." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs text-slate-500 sm:px-5">
              <span className="font-medium text-slate-700">{data!.category.name} {GENDER_LABEL[data!.category.gender]}{data!.division ? ` · División ${data!.division.name}` : ""}</span>
              <span>·</span><span>{data!.season.name}</span>
              {data!.season.status === "cerrada" && <Badge>Temporada cerrada</Badge>}
              <span className="ml-auto">Actualizado {formatDateTime(data!.generatedAt)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm" data-testid="ranking-table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="w-14 px-4 py-2 text-center">Pos.</th>
                    <th className="px-3 py-2">Jugador</th>
                    <th className="px-3 py-2 text-right">Puntos</th>
                    <th className="px-3 py-2 text-right" title="Torneos jugados">Torneos</th>
                    <th className="px-3 py-2 text-right" title="Campeonatos">Títulos</th>
                    <th className="px-3 py-2 text-right" title="Finales jugadas">Finales</th>
                    <th className="px-3 py-2 text-right" title="Mayor puntaje en un torneo">Mejor</th>
                    <th className="px-3 py-2 text-right" title="Ajustes manuales">Ajustes</th>
                    {hasBalance && <th className="px-4 py-2 text-right" title="Saldo inicial importado de rankings anteriores">Saldo inicial</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data!.rows.map((r) => (
                    <tr key={r.playerId} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-center"><PositionCell r={r} /></td>
                      <td className="px-3 py-2.5">
                        <Link to={`/jugadores/${r.playerId}`} className="font-medium text-slate-900 hover:text-brand-700">{r.lastName}, {r.firstName}</Link>
                        {r.nickname && <span className="ml-1 text-slate-400">“{r.nickname}”</span>}
                        <span className="ml-2 font-mono text-xs text-slate-400">{r.code}</span>
                        {!r.active && <Badge className="ml-2">Inactivo</Badge>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-base font-bold tabular text-slate-900">{r.points}</td>
                      <td className="px-3 py-2.5 text-right tabular text-slate-600">{r.tournaments}</td>
                      <td className="px-3 py-2.5 text-right tabular text-slate-600">{r.titles || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular text-slate-600">{r.finals || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular text-slate-600">{r.bestTournament || "—"}</td>
                      <td className={cn("px-3 py-2.5 text-right tabular", r.adjustments > 0 ? "text-brand-700" : r.adjustments < 0 ? "text-red-600" : "text-slate-300")}>
                        {r.adjustments ? (r.adjustments > 0 ? `+${r.adjustments}` : r.adjustments) : "—"}
                      </td>
                      {hasBalance && <td className="px-4 py-2.5 text-right tabular text-indigo-700">{r.initialBalance || "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
              Desempate: más puntos{data!.tiebreakers.map((t) => `, ${TIEBREAKER_LABEL[t].toLowerCase()}`).join("")}. “=” indica posición compartida.
              {data!.division && " Los ajustes manuales no se asignan a divisiones: figuran sólo en el ranking general de la categoría."}
              {hasBalance && " “Saldo inicial” son los puntos importados del ranking anterior (sin detalle de torneos)."}
            </p>
          </>
        )}
      </Card>
      {showTiebreakers && data && (
        <TiebreakersDialog seasonId={data.season.id} current={data.tiebreakers} readOnly={data.season.status === "cerrada"} onClose={() => setShowTiebreakers(false)} />
      )}
    </>
  );
}
