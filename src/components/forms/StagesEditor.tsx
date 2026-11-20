import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Checkbox, TextField } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/Button";
import { stagePoints } from "@shared/scoring";

export interface StageDraft {
  /** id de la instancia si ya existe (en torneos se conserva para no perder asignaciones). */
  id?: number;
  key: string;
  label: string;
  points: string;
  maxTeams: string;
}

export interface RulesDraft {
  cumulative: boolean;
  participationBonus: string;
  matchPlayedBonus: string;
  matchWonBonus: string;
}

let seq = 0;
export const newStageKey = () => `s${Date.now()}-${seq++}`;

export function toStageDrafts(stages: { id: number; label: string; points: number; maxTeams: number | null }[], keepIds: boolean): StageDraft[] {
  return stages.map((s) => ({ id: keepIds ? s.id : undefined, key: newStageKey(), label: s.label, points: String(s.points), maxTeams: s.maxTeams === null ? "" : String(s.maxTeams) }));
}

export function stagesPayload(stages: StageDraft[]) {
  return stages.map((s) => ({ ...(s.id ? { id: s.id } : {}), label: s.label, points: s.points, maxTeams: s.maxTeams }));
}

/** Errores de zod con ruta "stages.N.campo" → mensaje para cada fila. */
function rowError(errors: Record<string, string>, i: number, field: string) {
  return errors[`stages.${i}.${field}`];
}

interface Props {
  stages: StageDraft[];
  onChange: (s: StageDraft[]) => void;
  rules: RulesDraft;
  onRulesChange: (r: RulesDraft) => void;
  errors: Record<string, string>;
  disabled?: boolean;
  /** Ids de instancias con parejas asignadas (no se pueden quitar). */
  usedStageIds?: Set<number>;
}

/** Editor de instancias y bonificaciones (plantillas y puntuación de cada torneo). */
export function StagesEditor({ stages, onChange, rules, onRulesChange, errors, disabled, usedStageIds }: Props) {
  const update = (i: number, patch: Partial<StageDraft>) => onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...stages];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item!);
    onChange(next);
  };
  const numeric = stages.map((s, i) => ({ id: i, label: s.label, rank: i + 1, points: Number(s.points) || 0, maxTeams: null }));

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Instancias y puntos</h3>
            <p className="text-xs text-slate-500">Ordenadas de mejor a peor: la primera es el campeón. El cupo limita cuántas parejas pueden quedar en cada instancia.</p>
          </div>
        </div>
        {errors.stages && <p className="mb-2 text-xs font-medium text-red-600">{errors.stages}</p>}
        <ol className="space-y-2">
          {stages.map((s, i) => {
            const used = s.id !== undefined && usedStageIds?.has(s.id);
            const cumulativeTotal = rules.cumulative ? stagePoints({ cumulative: true, stages: numeric }, numeric[i]!) : null;
            return (
              <li key={s.key} className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
                <div className="flex items-start gap-2">
                  <span className="mt-8 w-5 shrink-0 text-center text-xs font-bold text-slate-400 tabular">{i + 1}</span>
                  <div className="grid flex-1 grid-cols-6 gap-2">
                    <TextField label="Instancia" containerClassName="col-span-6 sm:col-span-3" value={s.label} disabled={disabled}
                      onChange={(e) => update(i, { label: e.target.value })} error={rowError(errors, i, "label")} />
                    <TextField label="Puntos" containerClassName="col-span-3 sm:col-span-2" type="number" min={0} inputMode="numeric" value={s.points} disabled={disabled}
                      onChange={(e) => update(i, { points: e.target.value })} error={rowError(errors, i, "points")}
                      hint={cumulativeTotal !== null ? `Total acumulado: ${cumulativeTotal}` : undefined} />
                    <TextField label="Cupo" containerClassName="col-span-3 sm:col-span-1" type="number" min={1} inputMode="numeric" placeholder="∞" value={s.maxTeams} disabled={disabled}
                      onChange={(e) => update(i, { maxTeams: e.target.value })} error={rowError(errors, i, "maxTeams")} />
                  </div>
                  <div className="mt-6 flex shrink-0 flex-col sm:flex-row">
                    <IconButton label="Subir" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp className="size-4" /></IconButton>
                    <IconButton label="Bajar" disabled={disabled || i === stages.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown className="size-4" /></IconButton>
                    <IconButton label={used ? "Tiene parejas asignadas" : `Quitar ${s.label || "instancia"}`} disabled={disabled || used || stages.length === 1}
                      onClick={() => onChange(stages.filter((_, j) => j !== i))} className="hover:text-red-600 disabled:opacity-30">
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {!disabled && (
          <button type="button" onClick={() => onChange([...stages, { key: newStageKey(), label: "", points: "0", maxTeams: "" }])}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50">
            <Plus className="size-4" /> Agregar instancia
          </button>
        )}
      </div>

      <div className="space-y-3 rounded-lg ring-1 ring-inset ring-slate-200 p-3">
        <h3 className="text-sm font-semibold text-slate-900">Reglamento</h3>
        <Checkbox
          label="Puntaje acumulativo (reglamento especial)"
          checked={rules.cumulative}
          onChange={(v) => !disabled && onRulesChange({ ...rules, cumulative: v })}
          hint="Si está desactivado (regla general), cada pareja recibe sólo los puntos de la instancia que alcanzó: el campeón recibe los de campeón. Activalo sólo si el reglamento suma todas las fases."
        />
        <div className="grid grid-cols-3 gap-2">
          <TextField label="Bonus por participar" type="number" min={0} value={rules.participationBonus} disabled={disabled}
            onChange={(e) => onRulesChange({ ...rules, participationBonus: e.target.value })} error={errors.participationBonus} />
          <TextField label="Por partido jugado" type="number" min={0} value={rules.matchPlayedBonus} disabled={disabled}
            onChange={(e) => onRulesChange({ ...rules, matchPlayedBonus: e.target.value })} error={errors.matchPlayedBonus} />
          <TextField label="Por partido ganado" type="number" min={0} value={rules.matchWonBonus} disabled={disabled}
            onChange={(e) => onRulesChange({ ...rules, matchWonBonus: e.target.value })} error={errors.matchWonBonus} />
        </div>
        <p className="text-xs text-slate-500">Dejá las bonificaciones en 0 si el reglamento no las prevé. Se suman a los puntos de la instancia, igual para ambos integrantes.</p>
      </div>
    </div>
  );
}
