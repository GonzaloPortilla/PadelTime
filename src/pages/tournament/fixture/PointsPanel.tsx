import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { placementLabel } from "@shared/fixture";
import type { DiffRow, Preview } from "@shared/scoring";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Badge, Card, CardHeader, EmptyState, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { ErrorNote, fx, useFixtureMutation, type FxCtx } from "./common";

interface FinalRow {
  teamId: number; name: string; key: string; label: string; stageId: number | null; stageLabel: string | null;
  matchesPlayed: number; matchesWon: number;
  before: { stageId: number | null; stageLabel: string | null; matchesPlayed: number; matchesWon: number } | null;
}
interface FinalPreview {
  complete: boolean; pending: number; stageMap: Record<string, number | null>; review: string[]; rows: FinalRow[];
  preview: Preview; previewHash: string; creditedVersion: number | null; applied: boolean; diff: DiffRow[] | null;
}

const fmtDelta = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Fixture → puntos. Las posiciones finales se convierten en la instancia y los partidos de cada pareja
 * (las mismas entradas que se cargaban a mano), y los puntos los calcula el motor de puntuación de siempre.
 * Aplicar NO acredita: la confirmación se hace en Acreditación, con el flujo existente.
 */
export function PointsPanel({ ctx, onGoToCredit }: { ctx: FxCtx; onGoToCredit?: () => void }) {
  const f = ctx.state.final;
  const [map, setMap] = useState<Record<string, number | null> | null>(null);
  const [data, setData] = useState<FinalPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const load = useMutation({
    mutationFn: (stageMap: Record<string, number | null> | null) => api.post<FinalPreview>(`/tournaments/${ctx.tid}/fixture/final/preview`, { stageMap }),
    onSuccess: (d) => { setData(d); if (d.complete) setMap(d.stageMap); },
  });
  const apply = useFixtureMutation(ctx.tid, (body: unknown) => fx.post(ctx.tid, "/final", body), "Posiciones finales aplicadas al torneo");
  // Se recalcula cuando cambia el fixture (otra versión) o la equivalencia elegida.
  const mapKey = JSON.stringify(map);
  useEffect(() => {
    if (f.complete) load.mutate(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.state.version, mapKey, f.complete]);

  const keys = useMemo(() => [...new Set(f.placements.map((p) => p.key))], [f.placements]);
  if (!f.complete) {
    return <Card><EmptyState title="La competencia todavía no terminó" description={f.pending ? `Faltan ${f.pending} partido(s) con resultado. Cuando terminen los cuadros, acá vas a ver las posiciones finales y los puntos.` : "Armá los cuadros de Oro / Plata para completar la competencia."} /></Card>;
  }
  if (!data || !map || !data.complete) return <Spinner label="Calculando posiciones finales y puntos…" />;

  const credited = data.creditedVersion !== null;
  const errors = data.preview.issues.filter((i) => i.level === "error");
  const warnings = data.preview.issues.filter((i) => i.level === "warning");
  const changes = data.diff?.filter((d) => d.change !== "igual") ?? [];
  const teamChanges = data.rows.filter((r) => r.before && (r.before.stageId !== r.stageId || r.before.matchesPlayed !== r.matchesPlayed || r.before.matchesWon !== r.matchesWon));
  const pointsOf = (teamId: number) => data.preview.rows.find((r) => r.teamId === teamId)?.points ?? 0;
  const savedMatches = JSON.stringify(f.stageMap) === JSON.stringify(map);
  const upToDate = f.applied && savedMatches;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Posiciones finales y puntos" subtitle="La instancia de cada posición sale de la puntuación del torneo (pestaña Puntuación). Los puntos los calcula el mismo motor que la acreditación." />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {upToDate ? <Badge tone="green"><CheckCircle2 className="size-3" />Aplicadas al torneo</Badge> : <Badge tone="amber">Sin aplicar</Badge>}
            {credited && <Badge tone="blue"><ShieldCheck className="size-3" />Acreditado v{data.creditedVersion}</Badge>}
            {credited && changes.length > 0 && <Badge tone="red"><AlertTriangle className="size-3" />Los puntos acreditados no coinciden con el fixture</Badge>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2 text-left">Posición final</th><th className="px-3 py-2 text-left">Instancia de puntuación</th><th className="px-3 py-2 text-right">Parejas</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((k) => (
                  <tr key={k}>
                    <td className="px-3 py-2 font-medium">{placementLabel(k)}{data.review.includes(k) && <span className="ml-2 align-middle"><Badge tone="amber">Revisar</Badge></span>}</td>
                    <td className="px-3 py-2">
                      <select aria-label={`Instancia para ${placementLabel(k)}`} value={map[k] ?? ""} disabled={ctx.readOnly}
                        onChange={(e) => setMap({ ...map, [k]: e.target.value ? Number(e.target.value) : null })}
                        className={cn("h-9 w-full max-w-60 rounded-lg border-0 text-sm ring-1 ring-inset", map[k] ? "ring-slate-300" : "ring-amber-400")}>
                        <option value="">Sin asignar</option>
                        {f.stages.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.points} pts)</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.placements.filter((p) => p.key === k).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.review.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
              El reglamento publicado no define cuántos puntos da la Copa de Plata: se propone «Fase de grupos». Si corresponde otra cosa, agregá la instancia en Puntuación y elegila acá.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Distribución de puntos" subtitle={`${data.preview.totals.players} jugadores · ${data.preview.totals.points} puntos en total. Cada integrante recibe los puntos de su pareja en su categoría principal.`} />
        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="mx-4 mb-3 space-y-1 sm:mx-5">
            {[...errors, ...warnings].map((i, k) => (
              <li key={k} className={cn("rounded-lg p-2.5 text-xs ring-1 ring-inset", i.level === "error" ? "bg-red-50 text-red-700 ring-red-200" : "bg-amber-50 text-amber-900 ring-amber-200")}>{i.message}</li>
            ))}
          </ul>
        )}
        <ul className="divide-y divide-slate-100">
          {data.rows.map((r) => (
            <li key={r.teamId} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-slate-500">{r.label} → {r.stageLabel ?? "sin asignar"} · {r.matchesPlayed} PJ / {r.matchesWon} PG</p>
              </div>
              {r.before && (r.before.stageId !== r.stageId) && r.before.stageLabel && <span className="text-xs text-slate-500">antes: {r.before.stageLabel}</span>}
              <span className="font-display text-base font-semibold tabular-nums text-navy">{pointsOf(r.teamId)} pts c/u</span>
            </li>
          ))}
        </ul>
      </Card>

      {credited && changes.length > 0 && (
        <Card>
          <CardHeader title="Diferencias con la acreditación vigente" subtitle="Al aplicar y confirmar la corrección se revierte la versión actual y se acredita la nueva, en una sola operación." />
          <ul className="divide-y divide-slate-100">
            {changes.map((d) => (
              <li key={d.playerId} className="flex items-center gap-3 px-4 py-2 text-sm sm:px-5">
                <span className="min-w-0 flex-1 truncate">{d.name} <span className="text-xs text-slate-500">({d.categoryName})</span></span>
                <span className="tabular-nums text-slate-500">{d.before ?? 0} <ArrowRight className="inline size-3" /> {d.after ?? 0}</span>
                <span className={cn("w-12 text-right font-semibold tabular-nums", d.delta > 0 ? "text-ball-700" : "text-red-600")}>{fmtDelta(d.delta)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!ctx.readOnly && (
        <div className="space-y-2">
          <ErrorNote message={apply.error ?? (load.error instanceof Error ? load.error.message : null)} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={errors.length > 0 || upToDate} loading={apply.isPending} onClick={() => setConfirming(true)}>
              {credited ? "Aplicar corrección al torneo" : "Aplicar posiciones al torneo"}
            </Button>
            {onGoToCredit && <Button variant="secondary" icon={<ShieldCheck className="size-4" />} disabled={!upToDate} onClick={onGoToCredit}>{credited ? "Confirmar corrección en Acreditación" : "Ir a Acreditación"}</Button>}
          </div>
          <p className="text-xs text-slate-500">Aplicar no acredita puntos: completa la instancia y los partidos de cada pareja. Los puntos se confirman en Acreditación.</p>
        </div>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title={credited ? "Aplicar corrección" : "Aplicar posiciones finales"}
        description={teamChanges.length ? `Cambia la instancia o los partidos de ${teamChanges.length} pareja(s).` : "Se completan las instancias y partidos de todas las parejas."}
        footer={<><Button variant="secondary" onClick={() => setConfirming(false)}>Cancelar</Button>
          <Button loading={apply.isPending} disabled={credited && reason.trim().length < 5}
            onClick={() => apply.mutate({ version: ctx.state.version, stageMap: map, reason: reason || null }, { onSuccess: () => { setConfirming(false); setReason(""); } })}>Aplicar</Button></>}>
        <div className="space-y-3">
          {teamChanges.length > 0 && (
            <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
              {teamChanges.map((r) => (
                <li key={r.teamId} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <b>{r.name}</b>: {r.before?.stageLabel ?? "sin instancia"} ({r.before?.matchesPlayed ?? 0}/{r.before?.matchesWon ?? 0}) → <b>{r.stageLabel}</b> ({r.matchesPlayed}/{r.matchesWon})
                </li>
              ))}
            </ul>
          )}
          {credited && <TextField label="Motivo de la corrección" required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} hint="Queda en la auditoría. Después confirmá la corrección de puntos en Acreditación." />}
        </div>
      </Modal>
    </div>
  );
}
