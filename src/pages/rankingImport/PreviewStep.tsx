import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, Check, Upload } from "lucide-react";
import { GENDER_LABEL } from "@shared/constants";
import type { RankingImportPayload } from "@shared/schemas";
import type { Category, DirectoryEntry, RankingImportPreview, Season } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

interface Props {
  payload: RankingImportPayload;
  preview: RankingImportPreview | undefined;
  loading: boolean;
  error: string | null;
  directory: Map<number, DirectoryEntry>;
  categories: Category[];
  seasons: Season[];
  busy: boolean;
  notes: string;
  onNotes: (v: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}

const fmt = (n: number) => n.toLocaleString("es-AR");

export function PreviewStep({ payload, preview, loading, error, directory, categories, seasons, busy, notes, onNotes, onBack, onConfirm }: Props) {
  const [reviewed, setReviewed] = useState(false);
  const [filter, setFilter] = useState("");
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const seasonById = useMemo(() => new Map(seasons.map((s) => [s.id, s])), [seasons]);
  const newByKey = useMemo(() => new Map((payload.newPlayers ?? []).map((p) => [p.key, p])), [payload.newPlayers]);
  const errorRows = new Set(preview?.issues.filter((i) => i.level === "error").flatMap((i) => i.rowNumbers ?? []) ?? []);

  const lines = payload.rows.map((r) => {
    const cat = catById.get(r.categoryId);
    const div = cat?.divisions.find((d) => d.id === r.divisionId);
    const existing = r.playerId ? directory.get(r.playerId) : undefined;
    const np = r.newKey ? newByKey.get(r.newKey) : undefined;
    return {
      ...r,
      playerLabel: existing ? `${existing.lastName}, ${existing.firstName}` : np ? `${np.lastName}, ${np.firstName}` : "?",
      code: existing?.code ?? null,
      isNew: !!np,
      ranking: `${cat?.name ?? "?"} ${cat ? GENDER_LABEL[cat.gender] : ""}${div ? ` · ${div.name}` : ""} · ${seasonById.get(r.seasonId)?.name ?? "?"}`,
    };
  });
  const f = filter.trim().toLowerCase();
  const shown = f ? lines.filter((l) => `${l.sourceName} ${l.playerLabel} ${l.ranking}`.toLowerCase().includes(f)) : lines;
  const errors = preview?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.level === "warning") ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">Vista previa</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Cada fila se registra como <strong>“Saldo inicial importado”</strong> en el ranking indicado: son los puntos que el jugador ya tenía. No se crean torneos ni resultados.
          Nada se guarda hasta que confirmes, y la importación completa se puede revertir después.
        </p>
        {loading && <Spinner label="Verificando contra la base…" className="py-6" />}
        {error && <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
        {preview && (
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="import-preview-stats">
            {[["Filas", preview.rowCount], ["Jugadores", preview.playerCount], ["Jugadores nuevos", preview.newPlayerCount], ["Puntos totales", preview.totalPoints]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                <dt className="text-xs text-slate-500">{l}</dt>
                <dd className="text-lg font-bold tabular text-slate-900">{fmt(v as number)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-1.5" data-testid="import-issues">
          {errors.map((i, k) => <p key={`e${k}`} className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200"><AlertCircle className="mt-0.5 size-4 shrink-0" />{i.message}</p>)}
          {warnings.map((i, k) => <p key={`w${k}`} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{i.message}</p>)}
        </div>
      )}

      {preview && preview.rankings.length > 0 && (
        <Card>
          <CardHeader title="Rankings afectados" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" data-testid="import-rankings">
              <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Ranking</th><th className="px-3 py-2">Temporada</th><th className="px-3 py-2 text-right">Jugadores</th>
                <th className="px-3 py-2 text-right">Saldo a importar</th><th className="px-4 py-2 text-right">Ya cargado</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rankings.map((r) => (
                  <tr key={`${r.seasonId}:${r.categoryId}:${r.divisionId ?? 0}`}>
                    <td className="px-4 py-2 font-medium">{r.categoryName} {GENDER_LABEL[r.gender]}{r.divisionName ? ` · División ${r.divisionName}` : ""}</td>
                    <td className="px-3 py-2">{r.seasonName}</td>
                    <td className="px-3 py-2 text-right tabular">{r.players}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular">{fmt(r.points)}</td>
                    <td className={cn("px-4 py-2 text-right tabular", r.existingPoints ? "text-amber-700" : "text-slate-300")}>{r.existingPoints ? fmt(r.existingPoints) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <h3 className="text-sm font-semibold text-slate-900">Lista completa ({lines.length})</h3>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar" aria-label="Filtrar la lista"
            className="h-9 rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-slate-300 sm:w-64" />
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="import-lines">
            <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">Fila</th><th className="px-3 py-2">En el archivo</th><th className="px-3 py-2">Jugador</th><th className="px-3 py-2">Ranking</th><th className="px-4 py-2 text-right">Puntos</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((l) => (
                <tr key={`${l.rowNumber}-${l.sourceName}-${l.seasonId}-${l.categoryId}`} className={errorRows.has(l.rowNumber) ? "bg-red-50" : ""}>
                  <td className="px-4 py-1.5 text-slate-400 tabular">{l.rowNumber}</td>
                  <td className="px-3 py-1.5 text-slate-600">{l.sourceName}{l.sourcePosition ? <span className="text-slate-400"> (#{l.sourcePosition})</span> : null}</td>
                  <td className="px-3 py-1.5 font-medium">{l.playerLabel} {l.isNew ? <Badge tone="blue">nuevo</Badge> : <span className="font-mono text-xs text-slate-400">{l.code}</span>}</td>
                  <td className="px-3 py-1.5 text-slate-600">{l.ranking}</td>
                  <td className="px-4 py-1.5 text-right font-semibold tabular">{fmt(l.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Nota (opcional)</span>
          <input value={notes} maxLength={500} onChange={(e) => onNotes(e.target.value)} placeholder="Ej.: ranking 2025 copiado del sitio anterior"
            className="mt-1 block h-9 w-full rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-slate-300" />
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          Revisé la lista completa de jugadores, rankings y puntos. Entiendo que se van a registrar como saldo inicial{payload.newPlayers.length ? ` y que se va${payload.newPlayers.length === 1 ? "" : "n"} a crear ${payload.newPlayers.length === 1 ? "1 jugador nuevo" : `${payload.newPlayers.length} jugadores nuevos`}` : ""}.
        </label>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onBack}>Volver a los jugadores</Button>
        <Button icon={busy ? undefined : preview?.ok ? <Check className="size-4" /> : <Upload className="size-4" />} loading={busy}
          disabled={!preview?.ok || !reviewed || loading} onClick={onConfirm}>
          {preview && !preview.ok ? `Hay ${errors.length} error${errors.length === 1 ? "" : "es"} para corregir` : "Confirmar importación"}
        </Button>
      </div>
    </div>
  );
}
