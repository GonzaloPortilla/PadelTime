import { useMemo, useState } from "react";
import { ArrowRight, UserPlus } from "lucide-react";
import { GENDER_LABEL } from "@shared/constants";
import { suggestNewPlayer } from "@shared/names";
import type { Category, DirectoryEntry, Tournament } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/misc";
import { PlayerPicker } from "@/components/forms/PlayerPicker";
import { cn } from "@/lib/cn";
import { slotProblems, type Resolution, type Slot } from "./linking";

interface Props {
  tournament: Tournament;
  slots: Slot[];
  directory: DirectoryEntry[];
  categories: Category[];
  onChange: (slots: Slot[]) => void;
  onBack: () => void;
  onNext: () => void;
}

const STATUS = {
  exacto: { label: "Coincide", tone: "green" },
  probable: { label: "Verificar", tone: "amber" },
  ambiguo: { label: "Ambiguo", tone: "red" },
  desconocido: { label: "No registrado", tone: "blue" },
} as const;

export function PlayersStep({ tournament, slots, directory, categories, onChange, onBack, onNext }: Props) {
  const [searching, setSearching] = useState<string | null>(null);
  const problems = useMemo(() => slotProblems(slots, directory), [slots, directory]);
  const problemOf = (id: string) => problems.filter((p) => p.slotId === id);
  const genderCategories = categories.filter((c) => c.gender === tournament.gender && c.active);
  const pendingNew = slots.filter((s) => s.resolution.kind === "new" && !s.resolution.confirmed && s.resolution.firstName.trim() && s.resolution.lastName.trim());
  const setResolution = (id: string, resolution: Resolution) => onChange(slots.map((s) => (s.id === id ? { ...s, resolution } : s)));
  const usedIds = new Set(slots.flatMap((s) => (s.resolution.kind === "existing" ? [s.resolution.playerId] : [])));

  const counts = {
    linked: slots.filter((s) => s.resolution.kind === "existing").length,
    created: slots.filter((s) => s.resolution.kind === "new").length,
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">Jugadores</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Cada nombre leído se compara con los jugadores de {GENDER_LABEL[tournament.gender].toLowerCase()} registrados (ignorando acentos y abreviaturas como “Maxi” o “Facu”).
          Los que no existen se proponen como jugadores nuevos: sólo se crean si lo confirmás.
          Revisá acentos y mayúsculas de los nuevos: el OCR lee en mayúsculas y puede omitir tildes. La categoría elegida es su categoría principal.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          <strong>{counts.linked}</strong> vinculados · <strong>{counts.created}</strong> nuevos · <strong className={problems.length ? "text-red-600" : "text-brand-700"}>{problems.length}</strong> pendientes
        </p>
        {pendingNew.length > 0 && (
          <Button size="sm" variant="subtle" className="mt-3" icon={<UserPlus className="size-4" />}
            onClick={() => onChange(slots.map((s) => (pendingNew.includes(s) && s.resolution.kind === "new" ? { ...s, resolution: { ...s.resolution, confirmed: true } } : s)))}>
            Confirmar la creación de {pendingNew.length} jugador{pendingNew.length === 1 ? "" : "es"} nuevo{pendingNew.length === 1 ? "" : "s"}
          </Button>
        )}
      </Card>

      <Card>
        <ul className="divide-y divide-slate-100" data-testid="player-slots">
          {slots.map((s, i) => {
            const r = s.resolution;
            const st = STATUS[s.match.status];
            const issues = problemOf(s.id);
            const prevTeam = i > 0 && slots[i - 1]!.teamKey === s.teamKey;
            return (
              <li key={s.id} className={cn("px-4 py-3 sm:px-5", issues.length > 0 && "bg-amber-50/40", prevTeam && "border-t-0 pt-0")} data-testid="player-slot">
                {!prevTeam && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{s.teamText}</p>}
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 lg:w-72">
                    <span className="text-sm font-semibold text-slate-900">{s.ocrName}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="flex-1 space-y-2">
                    <select
                      aria-label={`Jugador para ${s.ocrName}`}
                      value={r.kind === "existing" ? String(r.playerId) : r.kind === "new" ? "new" : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "search") { setSearching(s.id); return; }
                        if (v === "new") {
                          const sug = suggestNewPlayer(s.ocrName);
                          setResolution(s.id, { kind: "new", firstName: sug.firstName, lastName: sug.lastName, categoryId: tournament.categoryId, confirmed: false });
                        } else if (v === "") setResolution(s.id, { kind: "pending" });
                        else setResolution(s.id, { kind: "existing", playerId: Number(v) });
                      }}
                      className="h-9 w-full rounded-lg border-0 bg-white px-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="">Elegir…</option>
                      {s.match.candidates.map((c) => (
                        <option key={c.player.id} value={c.player.id} disabled={!c.player.active}>
                          {c.player.lastName}, {c.player.firstName}{c.player.nickname ? ` “${c.player.nickname}”` : ""} · {c.player.code} · {c.player.mainCategoryName} · {Math.round(c.score * 100)}%{c.player.active ? "" : " (inactivo)"}
                        </option>
                      ))}
                      {r.kind === "existing" && !s.match.candidates.some((c) => c.player.id === r.playerId) && (() => {
                        const p = directory.find((d) => d.id === r.playerId);
                        return p ? <option value={p.id}>{p.lastName}, {p.firstName} · {p.code} · {p.mainCategoryName}</option> : null;
                      })()}
                      <option value="new">➕ Crear jugador nuevo</option>
                      <option value="search">🔎 Buscar otro jugador…</option>
                    </select>
                    {searching === s.id && (
                      <PlayerPicker label="Buscar jugador" value={null} gender={tournament.gender} excluded={usedIds}
                        onChange={(p) => { if (p) setResolution(s.id, { kind: "existing", playerId: p.id }); setSearching(null); }} />
                    )}
                    {r.kind === "new" && (
                      <div className="grid gap-2 rounded-lg bg-sky-50/60 p-2.5 ring-1 ring-inset ring-sky-200 sm:grid-cols-4">
                        <input aria-label={`Nombre del nuevo jugador ${s.ocrName}`} value={r.firstName} placeholder="Nombre"
                          onChange={(e) => setResolution(s.id, { ...r, firstName: e.target.value, confirmed: false })}
                          className="h-9 rounded-md border-0 px-2 text-sm ring-1 ring-inset ring-slate-300" />
                        <input aria-label={`Apellido del nuevo jugador ${s.ocrName}`} value={r.lastName} placeholder="Apellido"
                          onChange={(e) => setResolution(s.id, { ...r, lastName: e.target.value, confirmed: false })}
                          className={cn("h-9 rounded-md border-0 px-2 text-sm ring-1 ring-inset", r.lastName.trim() ? "ring-slate-300" : "ring-red-400")} />
                        <select aria-label={`Categoría del nuevo jugador ${s.ocrName}`} value={r.categoryId}
                          onChange={(e) => setResolution(s.id, { ...r, categoryId: Number(e.target.value), confirmed: false })}
                          className="h-9 rounded-md border-0 px-2 text-sm ring-1 ring-inset ring-slate-300">
                          {genderCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <input type="checkbox" checked={r.confirmed} disabled={!r.firstName.trim() || !r.lastName.trim()}
                            onChange={(e) => setResolution(s.id, { ...r, confirmed: e.target.checked })} className="size-4 accent-brand-700" />
                          Crear
                        </label>
                      </div>
                    )}
                    {issues.map((p, k) => <p key={k} className="text-xs font-medium text-amber-800">{p.message}</p>)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onBack}>Volver al cuadro</Button>
        <Button icon={<ArrowRight className="size-4" />} disabled={problems.length > 0} onClick={onNext}>
          {problems.length ? `Resolvé ${problems.length} pendiente${problems.length === 1 ? "" : "s"}` : "Revisar y confirmar"}
        </Button>
      </div>
    </div>
  );
}

