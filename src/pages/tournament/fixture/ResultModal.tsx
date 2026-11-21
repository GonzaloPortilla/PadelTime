import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MATCH_STATUS_LABEL, RESULT_STATUSES, checkScore, isDecided, type FixtureMatchRow, type ResultStatus, type SetScore } from "@shared/fixture";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectField, TextField } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { ErrorNote, fx, teamName, useFixtureMutation, type FxCtx } from "./common";

/** Carga o corrección del resultado de un partido. El marcador se valida igual que en el servidor. */
export function ResultModal({ ctx, match, onClose }: { ctx: FxCtx; match: FixtureMatchRow; onClose: () => void }) {
  const f = ctx.state.config.match;
  const maxSets = f.setsToWin * 2 - 1;
  const correction = isDecided(match.status) && match.status !== "bye";
  const [status, setStatus] = useState<ResultStatus>(correction ? (match.status as ResultStatus) : "jugado");
  const [sets, setSets] = useState<string[][]>(() => Array.from({ length: maxSets }, (_, i) => (match.sets[i] ? match.sets[i]!.map(String) : ["", ""])));
  const [winner, setWinner] = useState<1 | 2 | null>(match.winner);
  const [notes, setNotes] = useState(match.notes ?? "");
  const [reason, setReason] = useState("");
  // Fase 10: antes de guardar una corrección se muestran sus consecuencias (sin guardar nada).
  interface Effects { standings: { group: string; team: string; before: number | null; after: number }[]; bracket: { matchId: number; before: string[]; after: string[] }[]; conflicts: string[]; finalChanges: { team: string; before: string | null; after: string }[]; creditedVersion: number | null }
  const [effects, setEffects] = useState<{ key: string; data: Effects } | null>(null);
  const review = useMutation({ mutationFn: (body: unknown) => api.post<Effects>(`/tournaments/${ctx.tid}/fixture/matches/${match.id}/result-preview`, body) });
  const save = useFixtureMutation(ctx.tid, (body: unknown) => fx.put(ctx.tid, `/matches/${match.id}/result`, body), correction ? "Resultado corregido" : "Resultado cargado");

  const parsed: SetScore[] = sets.filter(([a, b]) => a !== "" || b !== "").map(([a, b]) => [Number(a || 0), Number(b || 0)]);
  const check = checkScore(f, status, status === "wo" ? [] : parsed, status === "jugado" ? null : winner);
  const t1 = teamName(ctx.state, match.team1Id);
  const t2 = teamName(ctx.state, match.team2Id);
  const needsWinner = status !== "jugado";
  const setCell = (i: number, side: 0 | 1, v: string) => setSets((prev) => prev.map((row, j) => (j === i ? (side === 0 ? [v.replace(/\D/g, "").slice(0, 2), row[1]!] : [row[0]!, v.replace(/\D/g, "").slice(0, 2)]) : row)));

  const bodyKey = JSON.stringify({ status, sets: check.ok ? check.sets : null, winner: check.ok ? check.winner : null });
  const reviewed = effects?.key === bodyKey;
  const doReview = () => check.ok && review.mutate({ status, sets: check.sets, winner: check.winner }, { onSuccess: (data) => setEffects({ key: bodyKey, data }) });
  const submit = () => {
    if (!check.ok) return;
    save.mutate({ version: match.version, status, sets: check.sets, winner: check.winner, notes: notes || null, reason: reason || null }, { onSuccess: onClose });
  };

  return (
    <Modal open onClose={onClose} title={correction ? "Corregir resultado" : "Cargar resultado"} description={`${t1} vs ${t2}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>{correction && !reviewed
        ? <Button onClick={doReview} loading={review.isPending} disabled={!check.ok}>Revisar cambios</Button>
        : <Button onClick={submit} loading={save.isPending} disabled={!check.ok || (correction && reason.trim().length < 5)}>Guardar</Button>}</>}>
      <div className="space-y-4">
        <ErrorNote message={save.error} />
        <SelectField label="Tipo de resultado" value={status} onChange={(e) => setStatus(e.target.value as ResultStatus)}>
          {RESULT_STATUSES.map((s) => <option key={s} value={s}>{MATCH_STATUS_LABEL[s]}</option>)}
        </SelectField>
        {status !== "wo" && (
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Marcador {status === "jugado" ? "" : "(parcial u opcional)"}</p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead><tr><th className="pr-3 text-left font-medium text-slate-500">Pareja</th>{sets.map((_, i) => <th key={i} className="px-1 text-center font-medium text-slate-500">{i === maxSets - 1 && f.finalSet === "super_tiebreak" ? "STB" : `Set ${i + 1}`}</th>)}</tr></thead>
                <tbody>
                  {[0, 1].map((side) => (
                    <tr key={side}>
                      <td className="max-w-40 truncate pr-3 py-1 font-medium text-slate-800">{side === 0 ? t1 : t2}</td>
                      {sets.map((row, i) => (
                        <td key={i} className="px-1 py-1">
                          <input inputMode="numeric" aria-label={`${side === 0 ? t1 : t2}, set ${i + 1}`} value={row[side]} onChange={(e) => setCell(i, side as 0 | 1, e.target.value)}
                            className="h-10 w-12 rounded-lg border-0 text-center text-base ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Al mejor de {maxSets} set{maxSets > 1 ? "s" : ""} a {f.gamesPerSet} games{f.tiebreak ? `, tie break en ${f.gamesPerSet}-${f.gamesPerSet}` : ", con diferencia de 2"}{f.finalSet === "super_tiebreak" ? `; el último set es súper tie break a ${f.superTiebreakPoints}` : ""}.
            </p>
          </div>
        )}
        {needsWinner && (
          <div role="radiogroup" aria-label="Pareja ganadora">
            <p className="mb-1 text-sm font-medium text-slate-700">Gana{status === "retiro" ? " (la pareja que no se retiró)" : ""}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {([1, 2] as const).map((w) => (
                <button key={w} type="button" role="radio" aria-checked={winner === w} onClick={() => setWinner(w)}
                  className={cn("rounded-lg px-3 py-2 text-left text-sm ring-1 ring-inset", winner === w ? "bg-brand-50 font-semibold ring-brand-600" : "bg-white ring-slate-300 hover:bg-slate-50")}>
                  {w === 1 ? t1 : t2}
                </button>
              ))}
            </div>
          </div>
        )}
        {check.ok ? (
          <p className="rounded-lg bg-ball-50 p-2.5 text-sm text-ball-700 ring-1 ring-inset ring-ball-500/25">Gana <b>{check.winner === 1 ? t1 : check.winner === 2 ? t2 : "—"}</b></p>
        ) : (
          <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">{check.error}</p>
        )}
        <TextField label="Observaciones" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} hint="Opcional. Se guardan en el historial." />
        {correction && reviewed && effects && <EffectsList e={effects.data} />}
        {correction && (
          <TextField label="Motivo de la corrección" required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
            hint="Obligatorio. Si el cambio afecta partidos posteriores ya jugados, no se modifican: queda un conflicto para resolver." />
        )}
      </div>
    </Modal>
  );
}

function EffectsList({ e }: { e: { standings: { group: string; team: string; before: number | null; after: number }[]; bracket: { matchId: number; before: string[]; after: string[] }[]; conflicts: string[]; finalChanges: { team: string; before: string | null; after: string }[]; creditedVersion: number | null } }) {
  const none = !e.standings.length && !e.bracket.length && !e.conflicts.length && !e.finalChanges.length;
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200" data-testid="correction-effects">
      <p className="font-semibold text-slate-800">Qué cambia al guardar</p>
      {none && <p className="text-slate-600">No cambia ninguna posición ni otro partido.</p>}
      {e.standings.map((x, i) => <p key={`s${i}`}>Grupo {x.group}: {x.team} pasa del {x.before ?? "—"}° al <b>{x.after}°</b>.</p>)}
      {e.bracket.map((x, i) => <p key={`b${i}`}>Se actualiza un cruce sin jugar: {x.before.join(" vs ")} → <b>{x.after.join(" vs ")}</b>.</p>)}
      {e.conflicts.map((x, i) => <p key={`c${i}`} className="text-red-700">Conflicto: {x} No se modifica solo: lo resuelve un administrador.</p>)}
      {e.finalChanges.map((x, i) => <p key={`f${i}`}>{x.team}: {x.before ?? "—"} → <b>{x.after}</b>.</p>)}
      {e.creditedVersion !== null && (e.finalChanges.length > 0 || e.conflicts.length > 0) && (
        <p className="rounded-md bg-amber-50 p-2 text-amber-900 ring-1 ring-inset ring-amber-200">El torneo tiene puntos acreditados (v{e.creditedVersion}): los puntos no cambian solos. Después vas a tener que aplicar las posiciones en «Puntos» y confirmar la corrección en Acreditación.</p>
      )}
    </div>
  );
}
