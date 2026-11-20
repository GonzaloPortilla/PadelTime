import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, Globe, Upload } from "lucide-react";
import type { Gender } from "@shared/constants";
import type { RankingImportPayload } from "@shared/schemas";
import type { DirectoryEntry, RankingImportPreview } from "@shared/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { keys, useCategories, useSeasons } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Card, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { readSpreadsheet, sha256Hex, SpreadsheetError, type Workbook } from "@/rankingImport/parse";
import {
  defaultMapping, duplicateAssignments, extractRows, genderFromText, groupPlayers, indexDirectory, initialResolution, resolveRows, similarNamePairs,
  suggestCategory, suggestValueMaps,
  type FinalRow, type Mapping, type Resolution, type ValueMaps,
} from "@/rankingImport/mapping";
import { MappingStep } from "./MappingStep";
import { ValuesStep } from "./ValuesStep";
import { PlayersStep } from "./PlayersStep";
import { PreviewStep } from "./PreviewStep";
import { ImportHistory, importKeys } from "./ImportHistory";

type Step = "archivo" | "columnas" | "valores" | "jugadores" | "vista";
const STEPS: { key: Step; label: string }[] = [
  { key: "archivo", label: "Archivo" },
  { key: "columnas", label: "Columnas" },
  { key: "valores", label: "Valores" },
  { key: "jugadores", label: "Jugadores" },
  { key: "vista", label: "Vista previa" },
];

interface LoadedFile { name: string; hash: string; workbook: Workbook }

export function RankingImportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useCategories();
  const seasons = useSeasons();
  const directoryM = useQuery({ queryKey: ["players", "directory", "M"], queryFn: async () => (await api.get<{ items: DirectoryEntry[] }>("/players/directory?gender=M")).items });
  const directoryF = useQuery({ queryKey: ["players", "directory", "F"], queryFn: async () => (await api.get<{ items: DirectoryEntry[] }>("/players/directory?gender=F")).items });

  const [step, setStep] = useState<Step>("archivo");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [maps, setMaps] = useState<ValueMaps>({ category: {}, division: {}, season: {} });
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<{ id: number; preview: RankingImportPreview } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const catOptions = useMemo(() => (categories.data ?? []).map((c) => ({ id: c.id, name: c.name, gender: c.gender, level: c.level, active: c.active })), [categories.data]);
  const divOptions = useMemo(() => (categories.data ?? []).flatMap((c) => c.divisions.map((d) => ({ id: d.id, name: d.name, categoryId: c.id }))), [categories.data]);
  const seasonOptions = useMemo(() => (seasons.data ?? []).map((s) => ({ id: s.id, name: s.name, year: s.year })), [seasons.data]);
  const directory = useMemo(() => new Map([...(directoryM.data ?? []), ...(directoryF.data ?? [])].map((p) => [p.id, p])), [directoryM.data, directoryF.data]);
  const indexes = useMemo(() => ({ M: indexDirectory(directoryM.data ?? []), F: indexDirectory(directoryF.data ?? []) }) as Record<Gender, ReturnType<typeof indexDirectory>>, [directoryM.data, directoryF.data]);

  const extracted = useMemo(() => (file && mapping ? extractRows(file.workbook, mapping) : { rows: [], skipped: [] }), [file, mapping]);
  const { resolved, pending } = useMemo(() => (mapping ? resolveRows(extracted.rows, mapping, maps, catOptions) : { resolved: [], pending: [] }), [extracted.rows, mapping, maps, catOptions]);
  // El cotejo de nombres es lo más costoso: sólo se recalcula al llegar al paso de jugadores.
  const groupsEnabled = step === "jugadores" || step === "vista";
  const groups = useMemo(() => (groupsEnabled && mapping ? groupPlayers(resolved, indexes, mapping.nameOrder) : []), [groupsEnabled, resolved, indexes, mapping]);

  // Resoluciones iniciales para grupos nuevos (conserva las decisiones ya tomadas).
  useEffect(() => {
    if (!groups.length) return;
    setResolutions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of groups) if (!(g.key in next)) { next[g.key] = initialResolution(g, resolved); changed = true; }
      return changed ? next : prev;
    });
  }, [groups, resolved]);

  const finals: FinalRow[] = useMemo(() => {
    const byKey = new Map(groups.map((g) => [g.key, g]));
    const rowGroup = new Map<string, string>();
    for (const g of groups) for (const id of g.rowIds) rowGroup.set(id, g.key);
    return resolved.flatMap((row) => {
      const g = byKey.get(rowGroup.get(row.id) ?? "");
      return g ? [{ row, group: g, resolution: resolutions[g.key] ?? { kind: "pending" } }] : [];
    });
  }, [groups, resolved, resolutions]);

  const { problems, warnings } = useMemo(() => {
    const problems = new Map<string, string[]>();
    const add = (key: string, msg: string) => problems.set(key, [...(problems.get(key) ?? []), msg]);
    for (const g of groups) {
      const r = resolutions[g.key];
      if (!r || r.kind === "pending") add(g.key, g.match.status === "ambiguo" ? "Hay varios jugadores parecidos: elegí cuál es." : "Elegí un jugador, creá uno nuevo u omitilo.");
      else if (r.kind === "new" && (!r.firstName.trim() || !r.lastName.trim())) add(g.key, "Completá nombre y apellido del jugador nuevo.");
      else if (r.kind === "new" && !r.categoryId) add(g.key, "Elegí la categoría principal del jugador nuevo.");
    }
    for (const dup of duplicateAssignments(finals)) {
      const names = [...new Set(dup.map((f) => f.group.name))];
      const rowsText = dup.map((f) => f.row.rowNumber).join(", ");
      for (const f of dup) {
        add(f.group.key, names.length > 1
          ? `“${names.join("” y “")}” quedaron vinculados al mismo jugador en el mismo ranking (filas ${rowsText}). Corregí uno u omitilo.`
          : `Aparece ${dup.length} veces en el mismo ranking (filas ${rowsText}). Omitilo o corregí el archivo.`);
      }
    }
    for (const [k, list] of problems) problems.set(k, [...new Set(list)]);
    const warnings = similarNamePairs(groups).map(([a, b]) => ({
      key: `${a.key}~${b.key}`,
      message: `Posible duplicado en el archivo: “${a.name}” y “${b.name}”. Si son la misma persona, vinculá ambos al mismo jugador (y verificá que no estén en el mismo ranking).`,
    }));
    return { problems, warnings };
  }, [groups, resolutions, finals]);

  const payload: RankingImportPayload | null = useMemo(() => {
    if (!file || !mapping || step !== "vista") return null;
    const newKeys = new Map<string, string>();
    const newPlayers: NonNullable<RankingImportPayload["newPlayers"]> = [];
    const rows: RankingImportPayload["rows"] = [];
    for (const f of finals) {
      const r = f.resolution;
      if (r.kind === "skip" || r.kind === "pending") continue;
      let newKey: string | null = null;
      if (r.kind === "new") {
        newKey = newKeys.get(f.group.key) ?? null;
        if (!newKey) {
          newKey = `n${newKeys.size + 1}`;
          newKeys.set(f.group.key, newKey);
          newPlayers.push({ key: newKey, firstName: r.firstName.trim(), lastName: r.lastName.trim(), gender: f.group.gender, mainCategoryId: r.categoryId });
        }
      }
      rows.push({
        rowNumber: f.row.rowNumber, sourceName: f.row.name.slice(0, 160), sourcePosition: f.row.positionText?.slice(0, 20) ?? null,
        playerId: r.kind === "existing" ? r.playerId : null, newKey, seasonId: f.row.seasonId, categoryId: f.row.categoryId,
        divisionId: f.row.divisionId, points: f.row.points,
      });
    }
    const skippedPlayers = finals.filter((f) => f.resolution.kind === "skip").length;
    return {
      fileName: file.name.slice(0, 200), fileHash: file.hash, sheetNames: mapping.sheets,
      mapping: {
        hojas: mapping.sheets.join(", "), filaTitulos: mapping.headerRow + 1,
        ...Object.fromEntries(Object.entries(mapping.columns).map(([k, v]) => [`col_${k}`, v ?? null])),
        categoria: mapping.categorySource, temporada: mapping.seasonSource, division: mapping.divisionSource, formatoNombre: mapping.nameOrder,
      },
      newPlayers, rows,
      skippedRows: extracted.skipped.length + pending.length + skippedPlayers,
      warnings: warnings.map((w) => w.message).slice(0, 100),
      notes: notes.trim() || null,
    };
  }, [file, mapping, step, finals, extracted.skipped.length, pending.length, warnings, notes]);

  const previewPayload = useMemo(() => (payload ? { ...payload, notes: null } : null), [payload]);
  const preview = useQuery({
    queryKey: ["ranking-imports", "preview", previewPayload],
    queryFn: () => api.post<RankingImportPreview>("/ranking-imports/preview", previewPayload),
    enabled: !!previewPayload && previewPayload.rows.length > 0,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: () => api.post<{ id: number; preview: RankingImportPreview }>("/ranking-imports", payload),
    onSuccess: (r) => {
      setDone(r);
      toast("Ranking importado");
      void qc.invalidateQueries({ queryKey: importKeys.list });
      void qc.invalidateQueries({ queryKey: keys.rankings });
      void qc.invalidateQueries({ queryKey: keys.players });
      void qc.invalidateQueries({ queryKey: keys.movements });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });

  const reset = () => {
    setStep("archivo"); setFile(null); setMapping(null); setMaps({ category: {}, division: {}, season: {} });
    setResolutions({}); setNotes(""); setDone(null); setFileError(null); confirm.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    setFileError(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const workbook = readSpreadsheet(f.name, bytes);
      const hash = await sha256Hex(bytes);
      const m = defaultMapping(workbook);
      const active = seasons.data?.find((s) => s.status === "activa");
      // Sugerencias: temporada por el año del nombre del archivo; categoría por el nombre del archivo/hoja.
      const yearMatch = f.name.match(/20\d{2}/)?.[0];
      const bySeasonYear = yearMatch ? seasons.data?.filter((s) => s.year === Number(yearMatch)) : undefined;
      m.seasonFixed = bySeasonYear?.length === 1 ? bySeasonYear[0]!.id : active?.id ?? null;
      const guessText = `${f.name.replace(/\.[^.]+$/, "")} ${m.sheets[0] ?? ""}`;
      m.defaultGender = genderFromText(guessText) ?? "M";
      m.categoryFixed = suggestCategory(guessText, catOptions, m.defaultGender);
      setFile({ name: f.name, hash, workbook });
      setMapping(m);
      setResolutions({});
      setStep("columnas");
    } catch (e) {
      setFileError(e instanceof SpreadsheetError ? e.message : "No se pudo leer el archivo. Verificá que sea un Excel (.xlsx) o CSV.");
    } finally {
      setReading(false);
    }
  };

  const goValues = () => {
    if (!mapping) return;
    const next = suggestValueMaps(extracted.rows, mapping, catOptions, divOptions, seasonOptions, maps);
    setMaps(next);
    const needsValues = mapping.categorySource !== "fija" || mapping.seasonSource !== "fija" || mapping.divisionSource === "columna" || mapping.divisionSource === "hoja";
    setStep(needsValues ? "valores" : "jugadores");
  };

  const loading = categories.isPending || seasons.isPending || directoryM.isPending || directoryF.isPending;
  const loadError = categories.error ?? seasons.error ?? directoryM.error ?? directoryF.error;
  const current = STEPS.findIndex((s) => s.key === step);
  const firstRanking = done?.preview.rankings[0];

  return (
    <>
      <PageHeader
        title="Importar rankings"
        description="Migrá rankings existentes desde Excel o CSV. Los puntos se registran como saldo inicial, sin inventar torneos, y cada importación se puede revertir."
      />
      {loading ? <Spinner /> : loadError ? <ErrorState message={loadError.message} /> : done ? (
        <div data-testid="import-done"><Card className="p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-brand-600" />
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Importación #{done.id} confirmada</h2>
          <p className="mt-1 text-sm text-slate-600">
            {done.preview.rowCount} saldos iniciales · {done.preview.totalPoints.toLocaleString("es-AR")} pts
            {done.preview.newPlayerCount > 0 && ` · ${done.preview.newPlayerCount} jugador${done.preview.newPlayerCount === 1 ? "" : "es"} nuevo${done.preview.newPlayerCount === 1 ? "" : "s"}`}. Los rankings y las páginas públicas ya están actualizados.
          </p>
          <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
            {firstRanking && (
              <Link to={`/rankings?seasonId=${firstRanking.seasonId}&gender=${firstRanking.gender}&categoryId=${firstRanking.categoryId}${firstRanking.divisionId ? `&divisionId=${firstRanking.divisionId}` : ""}`}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">Ver el ranking</Link>
            )}
            {firstRanking && (
              <a href={`/publico/ranking/${firstRanking.seasonId}/${firstRanking.categoryId}${firstRanking.divisionId ? `/${firstRanking.divisionId}` : ""}`} target="_blank" rel="noopener"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"><Globe className="size-4" /> Página pública</a>
            )}
            <Button variant="secondary" onClick={reset}>Importar otro archivo</Button>
          </div>
        </Card></div>
      ) : (
        <div className="space-y-4">
          <ol className="flex flex-wrap items-center gap-1 text-xs font-medium" aria-label="Pasos">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1">
                <span className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1",
                  i === current ? "bg-ink-950 text-white" : i < current ? "bg-brand-50 text-brand-800" : "bg-slate-100 text-slate-400")}>
                  <span className="tabular">{i + 1}</span>{s.label}
                </span>
                {i < STEPS.length - 1 && <span className="text-slate-300">›</span>}
              </li>
            ))}
          </ol>

          {step === "archivo" && (
            <Card className="p-4 sm:p-6">
              <label
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-10 text-center hover:border-brand-600 hover:bg-brand-50/40"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files[0]); }}
              >
                {reading ? <Spinner label="Leyendo el archivo…" /> : <>
                  <FileSpreadsheet className="size-10 text-brand-700" />
                  <span className="text-sm font-semibold text-slate-900">Elegí o arrastrá un archivo Excel (.xlsx) o CSV</span>
                  <span className="max-w-lg text-xs text-slate-500">
                    Desde Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx) o CSV. El archivo se lee en tu navegador; sólo se envían los datos que confirmes.
                  </span>
                  <span className="mt-2 inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"><Upload className="size-4" /> Elegir archivo</span>
                </>}
                <input ref={inputRef} type="file" className="sr-only" aria-label="Archivo de ranking" accept=".xlsx,.xlsm,.csv,.txt,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => void onFile(e.target.files?.[0])} />
              </label>
              {fileError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200" role="alert">{fileError}</p>}
              <div className="mt-4 grid gap-3 text-xs text-slate-600 sm:grid-cols-3">
                <p><strong className="text-slate-800">Qué columnas sirven:</strong> jugador (o nombre y apellido), puntos y, si las hay, categoría, división y temporada. Si el archivo es de un solo ranking, esos datos se eligen una vez.</p>
                <p><strong className="text-slate-800">Qué se importa:</strong> sólo el total de cada jugador, como “Saldo inicial importado”. Las columnas por torneo se ignoran: no se inventan resultados históricos.</p>
                <p><strong className="text-slate-800">Sin duplicar:</strong> un mismo archivo (o el mismo contenido) no se puede importar dos veces, ni dar dos saldos al mismo jugador en el mismo ranking.</p>
              </div>
            </Card>
          )}

          {step === "columnas" && file && mapping && (
            <MappingStep workbook={file.workbook} mapping={mapping} categories={categories.data!} seasons={seasons.data!}
              onChange={setMapping} onBack={reset} onNext={goValues} />
          )}

          {step === "valores" && mapping && (
            <ValuesStep rows={extracted.rows} mapping={mapping} maps={maps} categories={categories.data!} seasons={seasons.data!} pendingCount={pending.length}
              onChange={setMaps} onBack={() => setStep("columnas")} onNext={() => setStep("jugadores")} />
          )}

          {step === "jugadores" && mapping && (
            <PlayersStep groups={groups} rows={resolved} resolutions={resolutions} directory={directory} categories={categories.data!}
              problems={problems} warnings={warnings} onChange={setResolutions}
              onBack={() => setStep(mapping.categorySource !== "fija" || mapping.seasonSource !== "fija" || mapping.divisionSource === "columna" || mapping.divisionSource === "hoja" ? "valores" : "columnas")}
              onNext={() => setStep("vista")} />
          )}

          {step === "vista" && payload && (
            <PreviewStep payload={payload} preview={preview.data} loading={preview.isFetching} error={confirm.error?.message ?? preview.error?.message ?? null}
              directory={directory} categories={categories.data!} seasons={seasons.data!} busy={confirm.isPending}
              notes={notes} onNotes={setNotes} onBack={() => setStep("jugadores")} onConfirm={() => confirm.mutate()} />
          )}
        </div>
      )}

      <div className="mt-6"><ImportHistory /></div>
    </>
  );
}
