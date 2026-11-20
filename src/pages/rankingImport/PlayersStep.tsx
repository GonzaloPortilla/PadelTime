import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, ArrowRight, Link2, UserPlus } from "lucide-react";
import { GENDER_LABEL } from "@shared/constants";
import type { Category, DirectoryEntry } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/misc";
import { PlayerPicker } from "@/components/forms/PlayerPicker";
import { cn } from "@/lib/cn";
import type { PlayerGroup, ResolvedRow, Resolution } from "@/rankingImport/mapping";

interface Props {
  groups: PlayerGroup[];
  rows: ResolvedRow[];
  resolutions: Record<string, Resolution>;
  directory: Map<number, DirectoryEntry>;
  categories: Category[];
  problems: Map<string, string[]>;
  warnings: { key: string; message: string }[];
  onChange: (r: Record<string, Resolution>) => void;
  onBack: () => void;
  onNext: () => void;
}

const STATUS = {
  exacto: { label: "Coincide", tone: "green" },
  probable: { label: "Verificar", tone: "amber" },
  ambiguo: { label: "Ambiguo", tone: "red" },
  desconocido: { label: "No registrado", tone: "blue" },
} as const;

type Filter = "revisar" | "nuevos" | "todos";
const PAGE = 60;

export function PlayersStep({ groups, rows, resolutions, directory, categories, problems, warnings, onChange, onBack, onNext }: Props) {
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const needsReview = (g: PlayerGroup) => problems.has(g.key) || g.match.status !== "exacto" || resolutions[g.key]?.kind !== "existing";
  const [filter, setFilter] = useState<Filter>(() => (groups.some(needsReview) ? "revisar" : "todos"));
  const [limit, setLimit] = useState(PAGE);
  const [searching, setSearching] = useState<string | null>(null);
  const set = (key: string, r: Resolution) => onChange({ ...resolutions, [key]: r });

  const visible = groups.filter((g) => (filter === "todos" ? true : filter === "nuevos" ? resolutions[g.key]?.kind === "new" : needsReview(g)));
  const counts = {
    linked: groups.filter((g) => resolutions[g.key]?.kind === "existing").length,
    created: groups.filter((g) => resolutions[g.key]?.kind === "new").length,
    skipped: groups.filter((g) => resolutions[g.key]?.kind === "skip").length,
    problems: problems.size,
  };
  const pendingProbable = groups.filter((g) => resolutions[g.key]?.kind === "pending" && g.match.candidates[0]);

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">Jugadores</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Cada nombre se compara con los jugadores registrados de su rama, sin distinguir acentos ni mayúsculas, aceptando abreviaturas (“Maxi”, “Facu”) y el formato “Apellido, Nombre”.
          Los que no existen se proponen como nuevos y sólo se crean al confirmar la importación.
        </p>
        <p className="mt-2 text-sm text-slate-700" data-testid="players-counts">
          <strong>{groups.length}</strong> jugadores · <strong>{counts.linked}</strong> vinculados · <strong>{counts.created}</strong> nuevos
          {counts.skipped > 0 && <> · <strong>{counts.skipped}</strong> omitidos</>} ·{" "}
          <strong className={counts.problems ? "text-red-600" : "text-brand-700"}>{counts.problems}</strong> pendientes
        </p>
        {pendingProbable.length > 0 && (
          <Button size="sm" variant="subtle" className="mt-3" icon={<Link2 className="size-4" />}
            onClick={() => onChange({ ...resolutions, ...Object.fromEntries(pendingProbable.map((g) => [g.key, { kind: "existing", playerId: g.match.candidates[0]!.player.id } as Resolution])) })}>
            Vincular {pendingProbable.length} con su candidato más probable
          </Button>
        )}
      </Card>

      {warnings.length > 0 && (
        <div className="space-y-1.5" data-testid="players-warnings">
          {warnings.slice(0, 12).map((w) => (
            <p key={w.key} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w.message}</p>
          ))}
          {warnings.length > 12 && <p className="text-xs text-amber-800">…y {warnings.length - 12} advertencias más.</p>}
        </div>
      )}

      <Card>
        <div className="flex gap-1 border-b border-slate-100 p-2" role="tablist">
          {([["revisar", "A revisar"], ["nuevos", "Nuevos"], ["todos", "Todos"]] as [Filter, string][]).map(([f, label]) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => { setFilter(f); setLimit(PAGE); }}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", filter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
              {label}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">{filter === "revisar" ? "No queda nada por revisar." : "No hay jugadores en esta vista."}</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="player-groups">
            {visible.slice(0, limit).map((g) => {
              const r = resolutions[g.key] ?? { kind: "pending" };
              const st = STATUS[g.match.status];
              const issues = problems.get(g.key) ?? [];
              const groupRows = g.rowIds.map((id) => rowById.get(id)!).filter(Boolean);
              const genderCats = categories.filter((c) => c.gender === g.gender && c.active).sort((a, b) => a.level - b.level);
              const linked = r.kind === "existing" ? directory.get(r.playerId) : undefined;
              return (
                <li key={g.key} className={cn("px-4 py-3 sm:px-5", issues.length > 0 && "bg-amber-50/40")} data-testid="player-group">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
                    <div className="min-w-0 lg:w-80">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{g.name}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {GENDER_LABEL[g.gender]} · {groupRows.map((x) => `fila ${x.rowNumber}: ${x.points} pts`).slice(0, 3).join(" · ")}{groupRows.length > 3 ? ` · +${groupRows.length - 3}` : ""}
                      </p>
                    </div>
                    <div className="flex-1 space-y-2">
                      <select aria-label={`Jugador para ${g.name}`}
                        value={r.kind === "existing" ? String(r.playerId) : r.kind === "new" ? "new" : r.kind === "skip" ? "skip" : ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "search") setSearching(g.key);
                          else if (v === "new") set(g.key, { kind: "new", firstName: g.suggestion.firstName, lastName: g.suggestion.lastName, categoryId: groupRows[0]?.categoryId ?? genderCats[0]?.id ?? 0 });
                          else if (v === "skip") set(g.key, { kind: "skip" });
                          else if (v === "") set(g.key, { kind: "pending" });
                          else set(g.key, { kind: "existing", playerId: Number(v) });
                        }}
                        className={cn("h-9 w-full rounded-lg border-0 bg-white px-2 text-sm ring-1 ring-inset focus:ring-2 focus:ring-brand-600", r.kind === "pending" ? "ring-amber-400" : "ring-slate-300")}>
                        <option value="">Elegir…</option>
                        {g.match.candidates.map((c) => (
                          <option key={c.player.id} value={c.player.id}>
                            {c.player.lastName}, {c.player.firstName}{c.player.nickname ? ` “${c.player.nickname}”` : ""} · {c.player.code} · {c.player.mainCategoryName} · {Math.round(c.score * 100)}%{c.player.active ? "" : " (inactivo)"}
                          </option>
                        ))}
                        {linked && !g.match.candidates.some((c) => c.player.id === linked.id) && (
                          <option value={linked.id}>{linked.lastName}, {linked.firstName} · {linked.code} · {linked.mainCategoryName}</option>
                        )}
                        <option value="new">➕ Crear jugador nuevo</option>
                        <option value="search">🔎 Buscar otro jugador…</option>
                        <option value="skip">⊘ No importar sus puntos</option>
                      </select>
                      {searching === g.key && (
                        <PlayerPicker label="Buscar jugador" value={null} gender={g.gender} excluded={new Set()}
                          onChange={(p) => { if (p) set(g.key, { kind: "existing", playerId: p.id }); setSearching(null); }} />
                      )}
                      {r.kind === "new" && (
                        <div className="grid gap-2 rounded-lg bg-sky-50/60 p-2.5 ring-1 ring-inset ring-sky-200 sm:grid-cols-3">
                          <input aria-label={`Nombre del nuevo jugador ${g.name}`} value={r.firstName} placeholder="Nombre"
                            onChange={(e) => set(g.key, { ...r, firstName: e.target.value })}
                            className={cn("h-9 rounded-md border-0 px-2 text-sm ring-1 ring-inset", r.firstName.trim() ? "ring-slate-300" : "ring-red-400")} />
                          <input aria-label={`Apellido del nuevo jugador ${g.name}`} value={r.lastName} placeholder="Apellido"
                            onChange={(e) => set(g.key, { ...r, lastName: e.target.value })}
                            className={cn("h-9 rounded-md border-0 px-2 text-sm ring-1 ring-inset", r.lastName.trim() ? "ring-slate-300" : "ring-red-400")} />
                          <select aria-label={`Categoría principal del nuevo jugador ${g.name}`} value={r.categoryId}
                            onChange={(e) => set(g.key, { ...r, categoryId: Number(e.target.value) })}
                            className="h-9 rounded-md border-0 px-2 text-sm ring-1 ring-inset ring-slate-300">
                            {genderCats.map((c) => <option key={c.id} value={c.id}>{c.name} (categoría principal)</option>)}
                          </select>
                        </div>
                      )}
                      {issues.map((p, k) => <p key={k} className="flex items-start gap-1.5 text-xs font-medium text-red-700"><AlertCircle className="mt-px size-3.5 shrink-0" />{p}</p>)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {visible.length > limit && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>Mostrar {Math.min(PAGE, visible.length - limit)} más (de {visible.length - limit})</Button>
          </div>
        )}
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onBack}>Volver</Button>
        <Button icon={counts.created ? <UserPlus className="size-4" /> : <ArrowRight className="size-4" />} disabled={counts.problems > 0} onClick={onNext}>
          {counts.problems ? `Resolvé ${counts.problems} pendiente${counts.problems === 1 ? "" : "s"}` : "Ver la vista previa"}
        </Button>
      </div>
    </div>
  );
}
