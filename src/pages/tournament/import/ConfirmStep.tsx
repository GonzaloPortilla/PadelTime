import { useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck, Upload } from "lucide-react";
import { teamPoints } from "@shared/scoring";
import type { DirectoryEntry, Team, TournamentScoring } from "@shared/types";
import { mapStagesToTournament, STAGE_KEY_LABEL, type Interpretation, type StageKey } from "@/ocr/bracket";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import type { Slot } from "./linking";

export interface ConfirmRow {
  teamKey: number;
  ocrText: string;
  slots: Slot[];
  stageKey: StageKey | null;
  stageId: number | null;
  matchesPlayed: number;
  matchesWon: number;
}

interface Props {
  result: Interpretation;
  slots: Slot[];
  directory: DirectoryEntry[];
  scoring: TournamentScoring;
  existingTeams: Team[];
  warnings: string[];
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onImport: (rows: ConfirmRow[], mode: "reemplazar" | "agregar") => void;
}

export function ConfirmStep({ result, slots, directory, scoring, existingTeams, warnings, busy, error, onBack, onImport }: Props) {
  const stageMap = useMemo(
    () => mapStagesToTournament(["campeon", "finalista", "semifinal", "cuartos", "octavos", "16avos", "32avos"], scoring.stages),
    [scoring.stages],
  );
  const [overrides, setOverrides] = useState<Record<number, number | null>>({});
  const [mode, setMode] = useState<"reemplazar" | "agregar">("reemplazar");
  const [accepted, setAccepted] = useState(false);

  const rows: ConfirmRow[] = result.teams.map((t) => {
    const mapped = t.stage ? stageMap.get(t.stage)?.id ?? null : null;
    return {
      teamKey: t.key,
      ocrText: t.text,
      slots: slots.filter((s) => s.teamKey === t.key),
      stageKey: t.stage,
      stageId: t.key in overrides ? overrides[t.key]! : mapped,
      matchesPlayed: t.matchesPlayed,
      matchesWon: t.matchesWon,
    };
  });
  const order = (r: ConfirmRow) => scoring.stages.find((s) => s.id === r.stageId)?.rank ?? 99;
  rows.sort((a, b) => order(a) - order(b));
  const missingStage = rows.filter((r) => r.stageId === null);
  const total = rows.reduce((sum, r) => sum + teamPoints(scoring, r).points * 2, 0);
  const newPlayers = slots.filter((s) => s.resolution.kind === "new").length;

  const playerLabel = (s: Slot) => {
    const r = s.resolution;
    if (r.kind === "existing") {
      const p = directory.find((d) => d.id === r.playerId);
      return p ? <><span className="font-medium text-slate-900">{p.firstName} {p.lastName}</span> <span className="font-mono text-xs text-slate-400">{p.code}</span><span className="text-xs text-slate-500"> · {p.mainCategoryName}</span></> : "—";
    }
    if (r.kind === "new") return <><span className="font-medium text-slate-900">{r.firstName} {r.lastName}</span> <Badge tone="blue">nuevo</Badge></>;
    return "—";
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">Confirmación</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Revisá la lista completa de parejas, jugadores, instancias y puntos. Al importar se guardan las parejas y sus resultados en el torneo:
          <strong className="text-slate-700"> los puntos NO se acreditan todavía</strong>. Después vas a confirmar la acreditación con la previsualización habitual.
        </p>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm" data-testid="confirm-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Pareja (leída)</th>
                <th className="px-3 py-2">Jugadores</th>
                <th className="px-3 py-2">Instancia</th>
                <th className="px-3 py-2 text-right">PJ/PG</th>
                <th className="px-4 py-2 text-right">Pts c/u</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const pts = teamPoints(scoring, r);
                return (
                  <tr key={r.teamKey}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{r.ocrText}</td>
                    <td className="px-3 py-2.5">{r.slots.map((s) => <div key={s.id}>{playerLabel(s)}</div>)}</td>
                    <td className="px-3 py-2.5">
                      <select aria-label={`Instancia de ${r.ocrText}`} value={r.stageId ?? ""}
                        onChange={(e) => setOverrides((o) => ({ ...o, [r.teamKey]: e.target.value ? Number(e.target.value) : null }))}
                        className={cn("h-8 rounded-md border-0 px-2 text-sm ring-1 ring-inset", r.stageId ? "ring-slate-300" : "bg-red-50 ring-red-400")}>
                        <option value="">Sin instancia</option>
                        {scoring.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      {r.stageKey && !stageMap.get(r.stageKey) && !(r.teamKey in overrides) && (
                        <p className="mt-0.5 text-[11px] text-red-600">La puntuación no tiene “{STAGE_KEY_LABEL[r.stageKey]}”: elegí una.</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-slate-500">{r.matchesPlayed}/{r.matchesWon}</td>
                    <td className="px-4 py-2.5 text-right text-base font-bold tabular text-slate-900">{pts.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2.5 text-sm text-slate-600 sm:px-5">
          {rows.length} parejas · {rows.length * 2} jugadores ({newPlayers} nuevos) · <strong>{total} puntos</strong> a acreditar después de confirmar.
        </p>
      </Card>

      {warnings.length > 0 && (
        <Card className="p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="size-4" />Advertencias del reconocimiento ({warnings.length})</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-900">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Card>
      )}

      <Card className="space-y-3 p-4 sm:p-5">
        {existingTeams.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-slate-700">El torneo ya tiene {existingTeams.length} pareja{existingTeams.length === 1 ? "" : "s"} cargada{existingTeams.length === 1 ? "" : "s"}:</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" checked={mode === "reemplazar"} onChange={() => setMode("reemplazar")} className="accent-brand-700" />Reemplazarlas por las del cuadro</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" checked={mode === "agregar"} onChange={() => setMode("agregar")} className="accent-brand-700" />Agregar las nuevas y actualizar el resultado de las que coinciden</label>
          </fieldset>
        )}
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-4 accent-brand-700" />
          Revisé la lista completa de jugadores, instancias y puntos{newPlayers ? ` y confirmo crear ${newPlayers} jugador${newPlayers === 1 ? "" : "es"} nuevo${newPlayers === 1 ? "" : "s"}` : ""}.
        </label>
        {missingStage.length > 0 && <p className="text-sm font-medium text-red-600">{missingStage.length} pareja{missingStage.length === 1 ? "" : "s"} sin instancia: asignala antes de importar.</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="secondary" onClick={onBack} disabled={busy}>Volver a los jugadores</Button>
          <Button icon={<Upload className="size-4" />} loading={busy} disabled={!accepted || missingStage.length > 0} onClick={() => onImport(rows, mode)}>
            Importar resultados (sin acreditar)
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="size-3.5" />El reconocimiento nunca acredita puntos: eso requiere tu confirmación en la pestaña Acreditación.</p>
      </Card>
    </div>
  );
}
