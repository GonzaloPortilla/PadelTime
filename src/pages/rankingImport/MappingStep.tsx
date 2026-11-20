import { useMemo } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { GENDER_LABEL, type Gender } from "@shared/constants";
import type { Category, Season } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { Workbook } from "@/rankingImport/parse";
import {
  FIELD_LABEL, cellText, columnLetter, detectHeaderRow, extractRows, headersOf, suggestMapping,
  type FieldKey, type Mapping, type NameOrder, type Source,
} from "@/rankingImport/mapping";

interface Props {
  workbook: Workbook;
  mapping: Mapping;
  categories: Category[];
  seasons: Season[];
  onChange: (m: Mapping) => void;
  onBack: () => void;
  onNext: () => void;
}

const selectCls = "h-9 w-full rounded-lg border-0 bg-white px-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600";
const COLUMN_FIELDS: FieldKey[] = ["name", "firstName", "lastName", "points", "position"];

export function MappingStep({ workbook, mapping, categories, seasons, onChange, onBack, onNext }: Props) {
  const sheet = workbook.sheets.find((s) => s.name === mapping.sheets[0]) ?? workbook.sheets[0]!;
  const headers = useMemo(() => headersOf(sheet, mapping.headerRow), [sheet, mapping.headerRow]);
  const extracted = useMemo(() => extractRows(workbook, mapping), [workbook, mapping]);
  // Primer valor de cada columna, para reconocerla en los desplegables.
  const examples = useMemo(
    () => headers.map((_, i) => cellText(sheet.rows.slice(mapping.headerRow + 1).find((r) => cellText(r[i]))?.[i]).slice(0, 24)),
    [headers, sheet, mapping.headerRow],
  );
  const set = (patch: Partial<Mapping>) => onChange({ ...mapping, ...patch });
  const setColumn = (f: FieldKey, v: string) => {
    const columns = { ...mapping.columns };
    if (v === "") delete columns[f];
    else columns[f] = Number(v);
    onChange({ ...mapping, columns });
  };
  const changeHeaderRow = (row: number) => {
    const columns = suggestMapping(sheet, row);
    onChange({
      ...mapping, headerRow: row, columns,
      categorySource: columns.category !== undefined ? "columna" : mapping.categorySource === "columna" ? "fija" : mapping.categorySource,
      divisionSource: columns.division !== undefined ? "columna" : mapping.divisionSource === "columna" ? "ninguna" : mapping.divisionSource,
      seasonSource: columns.season !== undefined ? "columna" : mapping.seasonSource === "columna" ? "fija" : mapping.seasonSource,
    });
  };
  const toggleSheet = (name: string, on: boolean) => {
    const sheets = on ? [...mapping.sheets, name] : mapping.sheets.filter((s) => s !== name);
    if (!sheets.length) return;
    const first = workbook.sheets.find((s) => s.name === sheets[0])!;
    onChange({ ...mapping, sheets, headerRow: on ? mapping.headerRow : detectHeaderRow(first.rows) });
  };

  const hasName = mapping.columns.name !== undefined || mapping.columns.lastName !== undefined || mapping.columns.firstName !== undefined;
  const problems: string[] = [];
  if (!hasName) problems.push("Elegí la columna del jugador (o las de nombre y apellido).");
  if (mapping.columns.points === undefined) problems.push("Elegí la columna de puntos.");
  if (mapping.categorySource === "columna" && mapping.columns.category === undefined) problems.push("Elegí la columna de categoría o una categoría fija.");
  if (mapping.categorySource === "fija" && !mapping.categoryFixed) problems.push("Elegí la categoría del ranking.");
  if (mapping.seasonSource === "columna" && mapping.columns.season === undefined) problems.push("Elegí la columna de temporada o una temporada fija.");
  if (mapping.seasonSource === "fija" && !mapping.seasonFixed) problems.push("Elegí la temporada.");
  if (mapping.divisionSource === "columna" && mapping.columns.division === undefined) problems.push("Elegí la columna de división.");
  if (mapping.divisionSource === "fija" && !mapping.divisionFixed) problems.push("Elegí la división.");
  if (hasName && mapping.columns.points !== undefined && extracted.rows.length === 0) problems.push("Con este mapeo no queda ninguna fila válida.");

  const fixedCategory = categories.find((c) => c.id === mapping.categoryFixed);
  const previewRows = sheet.rows.slice(Math.max(0, mapping.headerRow - 2), mapping.headerRow + 9);
  const width = Math.min(Math.max(headers.length, 1), 14);

  const columnSelect = (f: FieldKey) => (
    <select aria-label={`Columna: ${FIELD_LABEL[f]}`} className={selectCls} value={mapping.columns[f] ?? ""} onChange={(e) => setColumn(f, e.target.value)}>
      <option value="">— No usar —</option>
      {headers.map((h, i) => <option key={i} value={i}>{columnLetter(i)} · {h}{examples[i] ? ` (ej.: ${examples[i]})` : ""}</option>)}
    </select>
  );

  const sourceSelect = (label: string, value: Source, options: Source[], onSel: (s: Source) => void) => (
    <select aria-label={`Origen: ${label}`} className={selectCls} value={value} onChange={(e) => onSel(e.target.value as Source)}>
      {options.map((o) => (
        <option key={o} value={o}>{{ columna: "Desde una columna", fija: "La misma para todo el archivo", hoja: "Según el nombre de la hoja", ninguna: "Sin división (ranking general)" }[o]}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">Columnas</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Se configura <strong>una sola vez para todo el archivo</strong>: en cada dato elegí en qué columna de la planilla está (A, B, C…) y se aplica a todas las filas.
          Se sugirió un mapeo según los títulos y el contenido; revisalo con la vista previa de abajo.
        </p>

        {workbook.sheets.length > 1 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-700">Hojas a importar</p>
            <p className="text-xs text-slate-500">Si cada hoja es una categoría, elegí varias y usá “Según el nombre de la hoja” en Categoría. Todas deben tener el mismo formato.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {workbook.sheets.map((s) => (
                <label key={s.name} className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset", mapping.sheets.includes(s.name) ? "bg-brand-50 ring-brand-600/40" : "ring-slate-200")}>
                  <input type="checkbox" className="size-4 accent-brand-700" checked={mapping.sheets.includes(s.name)} onChange={(e) => toggleSheet(s.name, e.target.checked)} />
                  {s.name} <span className="text-xs text-slate-400">({s.rows.length} filas)</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Fila de títulos</span>
              <span className="block text-xs text-slate-500">Número de fila donde están los títulos; las filas de abajo son los jugadores. Poné <strong>0</strong> si la planilla no tiene títulos y empieza directamente con el primer jugador.</span>
              <input type="number" min={0} max={sheet.rows.length} value={mapping.headerRow + 1} aria-label="Fila de títulos"
                onChange={(e) => changeHeaderRow(Math.max(-1, Math.min(sheet.rows.length - 1, Number(e.target.value) - 1)))}
                className="mt-1 block h-9 w-28 rounded-lg border-0 px-2 text-sm ring-1 ring-inset ring-slate-300" />
            </label>
            {COLUMN_FIELDS.map((f) => (
              <label key={f} className="block text-sm">
                <span className="font-medium text-slate-700">{FIELD_LABEL[f]}{(f === "points" || f === "name") && <span className="text-red-600"> *</span>}</span>
                <div className="mt-1">{columnSelect(f)}</div>
                {f === "name" && <span className="text-xs text-slate-500">O usá “Nombre” y “Apellido” si están en columnas separadas.</span>}
                {f === "points" && <span className="text-xs text-slate-500">Si hay una columna por torneo, elegí la del total: se importa sólo el saldo, sin inventar resultados.</span>}
              </label>
            ))}
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Formato del nombre</span>
              <select aria-label="Formato del nombre" className={cn(selectCls, "mt-1")} value={mapping.nameOrder} onChange={(e) => set({ nameOrder: e.target.value as NameOrder })}>
                <option value="auto">Detectar (“Apellido, Nombre” con coma o el orden que mejor coincida)</option>
                <option value="nombre_apellido">Nombre Apellido</option>
                <option value="apellido_nombre">Apellido Nombre</option>
              </select>
            </label>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg p-3 ring-1 ring-inset ring-slate-200">
              <p className="text-sm font-medium text-slate-700">Categoría</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {sourceSelect("Categoría", mapping.categorySource, ["columna", "fija", "hoja"], (s) => set({ categorySource: s as Mapping["categorySource"] }))}
                {mapping.categorySource === "columna" && columnSelect("category")}
                {mapping.categorySource === "fija" && (
                  <select aria-label="Categoría del ranking" className={selectCls} value={mapping.categoryFixed ?? ""}
                    onChange={(e) => set({ categoryFixed: e.target.value ? Number(e.target.value) : null, divisionFixed: null })}>
                    <option value="">Elegir…</option>
                    {(["M", "F"] as Gender[]).map((g) => (
                      <optgroup key={g} label={GENDER_LABEL[g]}>
                        {categories.filter((c) => c.gender === g).sort((a, b) => a.level - b.level).map((c) => <option key={c.id} value={c.id}>{c.name} {GENDER_LABEL[g]}</option>)}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
              {mapping.categorySource !== "fija" && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <span className="self-center text-xs text-slate-500">Rama si el texto no la indica</span>
                  <select aria-label="Rama por defecto" className={selectCls} value={mapping.defaultGender} onChange={(e) => set({ defaultGender: e.target.value as Gender })}>
                    <option value="M">{GENDER_LABEL.M}</option>
                    <option value="F">{GENDER_LABEL.F}</option>
                  </select>
                  <span className="self-center text-xs text-slate-500">Columna de rama (opcional)</span>
                  {columnSelect("gender")}
                </div>
              )}
            </div>
            <div className="rounded-lg p-3 ring-1 ring-inset ring-slate-200">
              <p className="text-sm font-medium text-slate-700">División</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {sourceSelect("División", mapping.divisionSource, ["ninguna", "columna", "fija", "hoja"], (s) => set({ divisionSource: s }))}
                {mapping.divisionSource === "columna" && columnSelect("division")}
                {mapping.divisionSource === "fija" && (
                  <select aria-label="División del ranking" className={selectCls} value={mapping.divisionFixed ?? ""} disabled={!fixedCategory}
                    onChange={(e) => set({ divisionFixed: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">{fixedCategory ? "Elegir…" : "Elegí antes una categoría fija"}</option>
                    {fixedCategory?.divisions.map((d) => <option key={d.id} value={d.id}>División {d.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            <div className="rounded-lg p-3 ring-1 ring-inset ring-slate-200">
              <p className="text-sm font-medium text-slate-700">Temporada</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {sourceSelect("Temporada", mapping.seasonSource, ["columna", "fija", "hoja"], (s) => set({ seasonSource: s as Mapping["seasonSource"] }))}
                {mapping.seasonSource === "columna" && columnSelect("season")}
                {mapping.seasonSource === "fija" && (
                  <select aria-label="Temporada del ranking" className={selectCls} value={mapping.seasonFixed ?? ""} onChange={(e) => set({ seasonFixed: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Elegir…</option>
                    {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "cerrada" ? " (cerrada)" : s.status === "activa" ? " (activa)" : ""}</option>)}
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h3 className="text-sm font-semibold text-slate-900">Vista previa · {sheet.name}</h3>
          <p className="text-xs text-slate-500" data-testid="mapping-counts">
            <strong className="text-slate-800">{extracted.rows.length}</strong> filas con puntos · <strong className="text-slate-800">{extracted.skipped.length}</strong> omitidas
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                <th className="px-2 py-1.5 font-medium">Fila</th>
                {headers.slice(0, width).map((_, i) => {
                  const field = (Object.entries(mapping.columns) as [FieldKey, number][]).find(([, c]) => c === i)?.[0];
                  return (
                    <th key={i} className="px-2 py-1.5 font-medium">
                      <span className="block text-[10px] text-slate-400">{columnLetter(i)}</span>
                      {field ? <span className="rounded bg-brand-50 px-1 text-brand-800">{FIELD_LABEL[field].split(" (")[0]}</span> : <span className="text-slate-300">—</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, k) => {
                const index = Math.max(0, mapping.headerRow - 2) + k;
                const isHeader = index === mapping.headerRow;
                return (
                  <tr key={index} className={cn("border-t border-slate-100", isHeader ? "bg-ball-300/30 font-semibold" : index < mapping.headerRow ? "text-slate-300" : "")}>
                    <td className="px-2 py-1 text-slate-400">{index + 1}</td>
                    {Array.from({ length: width }, (_, i) => <td key={i} className="max-w-48 truncate px-2 py-1">{cellText(r[i])}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {extracted.skipped.length > 0 && (
          <details className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600 sm:px-5">
            <summary className="cursor-pointer font-medium">Ver filas omitidas ({extracted.skipped.length})</summary>
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
              {extracted.skipped.slice(0, 300).map((s) => (
                <li key={`${s.sheet}:${s.rowNumber}`}><span className="text-slate-400">{s.sheet} · fila {s.rowNumber}:</span> {s.reason}{s.text ? <span className="text-slate-400"> — {s.text}</span> : null}</li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {problems.length > 0 && (
        <div className="space-y-1.5">
          {problems.map((p) => <p key={p} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{p}</p>)}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onBack}>Elegir otro archivo</Button>
        <Button icon={<ArrowRight className="size-4" />} disabled={problems.length > 0} onClick={onNext}>Continuar</Button>
      </div>
    </div>
  );
}
