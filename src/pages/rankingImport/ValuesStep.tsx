import { ArrowRight } from "lucide-react";
import { GENDER_LABEL, type Gender } from "@shared/constants";
import type { Category, Season } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { categoryKey, rowCategory, type Mapping, type SourceRow, type ValueMaps } from "@/rankingImport/mapping";

interface Props {
  rows: SourceRow[];
  mapping: Mapping;
  maps: ValueMaps;
  categories: Category[];
  seasons: Season[];
  pendingCount: number;
  onChange: (m: ValueMaps) => void;
  onBack: () => void;
  onNext: () => void;
}

const selectCls = "h-9 w-full rounded-lg border-0 bg-white px-2 text-sm ring-1 ring-inset focus:ring-2 focus:ring-brand-600";

/** Asocia cada texto del archivo (categoría, división, temporada) con lo registrado en el sistema. */
export function ValuesStep({ rows, mapping, maps, categories, seasons, pendingCount, onChange, onBack, onNext }: Props) {
  const count = <K extends string>(keyOf: (r: SourceRow) => K) => {
    const m = new Map<K, number>();
    for (const r of rows) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + 1);
    return [...m.entries()];
  };
  const catEntries = mapping.categorySource !== "fija" ? count(categoryKey) : [];
  const seasonEntries = mapping.seasonSource !== "fija" ? count((r) => r.seasonText) : [];
  const divEntries =
    mapping.divisionSource === "columna" || mapping.divisionSource === "hoja"
      ? count((r) => {
          const c = rowCategory(r, mapping, maps);
          return (c !== null && r.divisionText ? `${c}|${r.divisionText}` : "") as string;
        }).filter(([k]) => k)
      : [];
  const catById = new Map(categories.map((c) => [c.id, c]));
  const missing = catEntries.filter(([k]) => !maps.category[k]).length + seasonEntries.filter(([k]) => !maps.season[k]).length;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">Categorías, divisiones y temporadas</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          No hace falta configurar jugador por jugador: abajo aparece <strong>cada valor distinto del archivo una sola vez</strong>, y lo que elijas se aplica a todas las filas que lo tienen.
          Se asociaron automáticamente cuando fue posible (por ejemplo “C6”, “6ta” o “Sexta” → 6ta).
        </p>
        {pendingCount > 0 && (
          <p className="mt-2 text-sm font-medium text-amber-800" data-testid="values-pending">
            Falta elegir {missing === 1 ? "1 valor" : `${missing} valores`} en los recuadros marcados ({pendingCount} fila{pendingCount === 1 ? "" : "s"} en total).
          </p>
        )}
      </Card>

      {catEntries.length > 0 && (
        <Card>
          <CardHeader title="Categorías" subtitle="Valor del archivo → categoría del sistema (define la rama de los jugadores)" />
          <ul className="divide-y divide-slate-100">
            {catEntries.map(([key, n]) => {
              const [text, genderText] = key.split("¦");
              const value = maps.category[key];
              return (
                <li key={key} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[1fr_16rem] sm:items-center sm:px-5">
                  <span className="text-sm"><strong>{text || "(vacío)"}</strong>{genderText ? <span className="text-slate-500"> · {genderText}</span> : null} <Badge>se aplica a {n} fila{n === 1 ? "" : "s"}</Badge></span>
                  <select aria-label={`Categoría para ${text || "vacío"}`} className={`${selectCls} ${value ? "ring-slate-300" : "ring-amber-400"}`} value={value ?? ""}
                    onChange={(e) => onChange({ ...maps, category: { ...maps.category, [key]: e.target.value ? Number(e.target.value) : null } })}>
                    <option value="">Elegí la categoría…</option>
                    {(["M", "F"] as Gender[]).map((g) => (
                      <optgroup key={g} label={GENDER_LABEL[g]}>
                        {categories.filter((c) => c.gender === g).sort((a, b) => a.level - b.level).map((c) => <option key={c.id} value={c.id}>{c.name} {GENDER_LABEL[g]}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {divEntries.length > 0 && (
        <Card>
          <CardHeader title="Divisiones" subtitle="Si no corresponde a ninguna división registrada, se suma al ranking general de la categoría." />
          <ul className="divide-y divide-slate-100">
            {divEntries.map(([key, n]) => {
              const [catId, text] = [Number(key.split("|")[0]), key.slice(key.indexOf("|") + 1)];
              const cat = catById.get(catId);
              return (
                <li key={key} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[1fr_16rem] sm:items-center sm:px-5">
                  <span className="text-sm"><strong>{text}</strong> <span className="text-slate-500">· {cat?.name} {cat ? GENDER_LABEL[cat.gender] : ""}</span> <Badge>se aplica a {n} fila{n === 1 ? "" : "s"}</Badge></span>
                  <select aria-label={`División para ${text}`} className={`${selectCls} ring-slate-300`} value={maps.division[key] ?? ""}
                    onChange={(e) => onChange({ ...maps, division: { ...maps.division, [key]: e.target.value ? Number(e.target.value) : null } })}>
                    <option value="">Sin división</option>
                    {cat?.divisions.map((d) => <option key={d.id} value={d.id}>División {d.name}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {seasonEntries.length > 0 && (
        <Card>
          <CardHeader title="Temporadas" />
          <ul className="divide-y divide-slate-100">
            {seasonEntries.map(([text, n]) => {
              const value = maps.season[text];
              return (
                <li key={text} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[1fr_16rem] sm:items-center sm:px-5">
                  <span className="text-sm"><strong>{text || "(vacío)"}</strong> <Badge>se aplica a {n} fila{n === 1 ? "" : "s"}</Badge></span>
                  <select aria-label={`Temporada para ${text || "vacío"}`} className={`${selectCls} ${value ? "ring-slate-300" : "ring-amber-400"}`} value={value ?? ""}
                    onChange={(e) => onChange({ ...maps, season: { ...maps.season, [text]: e.target.value ? Number(e.target.value) : null } })}>
                    <option value="">Elegí la temporada…</option>
                    {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onBack}>Volver a las columnas</Button>
        <Button icon={<ArrowRight className="size-4" />} disabled={rows.length === pendingCount} onClick={onNext}>
          {pendingCount > 0 ? `Continuar sin ${pendingCount} fila${pendingCount === 1 ? "" : "s"}` : "Continuar con los jugadores"}
        </Button>
      </div>
    </div>
  );
}
