import { useState } from "react";
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
  const save = useFixtureMutation(ctx.tid, (body: unknown) => fx.put(ctx.tid, `/matches/${match.id}/result`, body), correction ? "Resultado corregido" : "Resultado cargado");

  const parsed: SetScore[] = sets.filter(([a, b]) => a !== "" || b !== "").map(([a, b]) => [Number(a || 0), Number(b || 0)]);
  const check = checkScore(f, status, status === "wo" ? [] : parsed, status === "jugado" ? null : winner);
  const t1 = teamName(ctx.state, match.team1Id);
  const t2 = teamName(ctx.state, match.team2Id);
  const needsWinner = status !== "jugado";
  const setCell = (i: number, side: 0 | 1, v: string) => setSets((prev) => prev.map((row, j) => (j === i ? (side === 0 ? [v.replace(/\D/g, "").slice(0, 2), row[1]!] : [row[0]!, v.replace(/\D/g, "").slice(0, 2)]) : row)));

  const submit = () => {
    if (!check.ok) return;
    save.mutate({ version: match.version, status, sets: check.sets, winner: check.winner, notes: notes || null, reason: reason || null }, { onSuccess: onClose });
  };

  return (
    <Modal open onClose={onClose} title={correction ? "Corregir resultado" : "Cargar resultado"} description={`${t1} vs ${t2}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={save.isPending} disabled={!check.ok || (correction && reason.trim().length < 5)}>Guardar</Button></>}>
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
        {correction && (
          <TextField label="Motivo de la corrección" required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
            hint="Obligatorio. Si el cambio afecta partidos posteriores ya jugados, no se modifican: queda un conflicto para resolver." />
        )}
      </div>
    </Modal>
  );
}
