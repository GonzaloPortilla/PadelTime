import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle2, History, RotateCcw, ShieldCheck } from "lucide-react";
import { CREDIT_STATUS_LABEL } from "@shared/constants";
import type { CreditSummary, Tournament, TournamentPreviewResponse } from "@shared/types";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, plural } from "@/lib/format";
import { keys } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Checkbox, TextAreaField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Badge, Card, CardHeader, ErrorState, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

const fmtDelta = (n: number) => (n > 0 ? `+${n}` : String(n));

export function CreditTab({ tournament }: { tournament: Tournament }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelTournament, setCancelTournament] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: [...keys.tournaments, tournament.id, "preview"],
    queryFn: () => api.get<TournamentPreviewResponse>(`/tournaments/${tournament.id}/preview`),
    refetchOnMount: "always",
  });
  const credits = useQuery({
    queryKey: [...keys.tournaments, tournament.id, "credits"],
    queryFn: async () => (await api.get<{ items: CreditSummary[] }>(`/tournaments/${tournament.id}/credits`)).items,
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: keys.tournaments });
    void qc.invalidateQueries({ queryKey: keys.rankings });
    void qc.invalidateQueries({ queryKey: keys.dashboard });
    void qc.invalidateQueries({ queryKey: keys.players });
    void qc.invalidateQueries({ queryKey: keys.movements });
  };

  const confirm = useMutation({
    mutationFn: () => api.post<{ item: CreditSummary }>(`/tournaments/${tournament.id}/credits`, { previewHash: preview.data!.previewHash, reason }),
    onSuccess: ({ item }) => {
      invalidateAll();
      setConfirming(false);
      setReason("");
      toast(item.version > 1 ? `Corrección confirmada (versión ${item.version})` : `Se acreditaron ${item.totalPoints} puntos a ${item.playerCount} jugadores`);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Ocurrió un error inesperado");
      if (e instanceof ApiError && e.code === "previsualizacion_desactualizada") void preview.refetch();
    },
  });

  const revert = useMutation({
    mutationFn: () => api.post(`/tournaments/${tournament.id}/credits/revert`, { reason, cancelTournament }),
    onSuccess: () => {
      invalidateAll();
      setReverting(false);
      setReason("");
      toast(cancelTournament ? "Torneo anulado y puntos revertidos" : "Acreditación revertida: los puntos volvieron a cero");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Ocurrió un error inesperado"),
  });

  if (preview.isPending) return <Spinner label="Calculando puntos…" />;
  if (preview.isError) return <ErrorState message={preview.error.message} onRetry={() => void preview.refetch()} />;
  const p = preview.data;
  const active = p.activeCredit;
  const isCorrection = !!active && !p.upToDate;
  const errors = p.issues.filter((i) => i.level === "error");
  const warnings = p.issues.filter((i) => i.level === "warning");
  const changes = p.diff?.filter((d) => d.change !== "igual") ?? [];

  return (
    <div className="space-y-5">
      {/* Estado de la acreditación */}
      {!active ? (
        <div className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-slate-400" />
          <div>
            <p className="font-semibold text-slate-900">Sin acreditar</p>
            <p className="text-sm text-slate-500">Revisá la previsualización. Los puntos se suman a los rankings recién cuando un organizador confirma.</p>
          </div>
        </div>
      ) : p.upToDate ? (
        <div className="flex items-start gap-3 rounded-xl bg-brand-50 p-4 ring-1 ring-brand-600/20">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-700" />
          <div>
            <p className="font-semibold text-brand-800">Acreditado · versión {active.version}</p>
            <p className="text-sm text-brand-800/80">
              {active.totalPoints} puntos a {plural(active.playerCount, "jugador", "jugadores")} · {active.createdByName ?? "—"} · {formatDateTime(active.createdAt)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold text-amber-900">Hay cambios sin acreditar</p>
            <p className="text-sm text-amber-800">
              Los resultados o la puntuación cambiaron desde la versión {active.version}. Los rankings muestran los puntos de esa versión hasta que confirmes la corrección.
            </p>
          </div>
        </div>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {errors.map((i, k) => (
            <p key={`e${k}`} className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />{i.message}
            </p>
          ))}
          {warnings.map((i, k) => (
            <p key={`w${k}`} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />{i.message}
            </p>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title={isCorrection ? "Corrección: diferencias con la versión vigente" : "Previsualización de puntos"}
          subtitle={`${plural(p.totals.teams, "pareja")} · ${plural(p.totals.players, "jugador", "jugadores")} · ${p.totals.points} puntos en total`}
        />
        {isCorrection ? (
          changes.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Cambió la configuración pero no los puntos de ningún jugador.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2">Jugador</th><th className="px-3 py-2">Categoría</th><th className="px-3 py-2">Antes</th><th className="px-3 py-2">Después</th><th className="px-5 py-2 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {changes.map((d) => (
                    <tr key={d.playerId}>
                      <td className="px-5 py-2.5"><span className="font-medium text-slate-900">{d.name}</span> <span className="font-mono text-xs text-slate-400">{d.code}</span></td>
                      <td className="px-3 py-2.5 text-slate-600">{d.categoryName}</td>
                      <td className="px-3 py-2.5 text-slate-500">{d.before ?? "—"} <span className="text-xs">{d.stageBefore ?? ""}</span></td>
                      <td className="px-3 py-2.5 text-slate-700">{d.after ?? "—"} <span className="text-xs text-slate-500">{d.stageAfter ?? (d.change === "quitado" ? "(quitado)" : "")}</span></td>
                      <td className={cn("px-5 py-2.5 text-right font-semibold tabular", d.delta > 0 ? "text-brand-700" : d.delta < 0 ? "text-red-600" : "text-slate-400")}>{fmtDelta(d.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : p.rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No hay jugadores para acreditar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="preview-table">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2">Jugador</th>
                  <th className="px-3 py-2">Suma en</th>
                  <th className="px-3 py-2">Instancia</th>
                  <th className="px-3 py-2 text-right">Instancia</th>
                  <th className="px-3 py-2 text-right">Bonus</th>
                  <th className="px-5 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {p.rows.map((r) => (
                  <tr key={r.playerId}>
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-slate-900">{r.name}</span> <span className="font-mono text-xs text-slate-400">{r.code}</span>
                      <span className="block text-xs text-slate-400">con {r.partnerName || "—"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={r.otherCategory ? "font-medium text-amber-700" : "text-slate-600"}>{r.categoryName}</span>
                      {r.otherCategory && <span className="block text-[11px] text-amber-700">categoría principal</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{r.stageLabel}</td>
                    <td className="px-3 py-2.5 text-right tabular text-slate-600">{r.stagePoints}</td>
                    <td className="px-3 py-2.5 text-right tabular text-slate-600">{r.bonusPoints || "—"}</td>
                    <td className="px-5 py-2.5 text-right text-base font-bold tabular text-slate-900">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!p.locked && (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-xs text-slate-500">
              {p.upToDate && active ? "Estos resultados ya están acreditados: no se acredita dos veces." : "Cada integrante de la pareja recibe la misma puntuación, en su categoría principal."}
            </p>
            <Button
              disabled={!p.canConfirm || p.upToDate || tournament.status === "programado"}
              onClick={() => { setError(null); setReason(""); setConfirming(true); }}
              icon={<ShieldCheck className="size-4" />}
            >
              {isCorrection ? "Confirmar corrección" : "Confirmar y acreditar puntos"}
            </Button>
          </div>
        )}
        {tournament.status === "programado" && !p.locked && (
          <p className="border-t border-slate-100 px-5 py-2 text-xs text-amber-700">El torneo figura como programado: inicialo desde el Resumen antes de acreditar.</p>
        )}
      </Card>

      {credits.data && credits.data.length > 0 && (
        <Card>
          <CardHeader title="Historial de acreditaciones" subtitle="Cada confirmación, corrección o reversión queda registrada" action={<History className="size-4 text-slate-400" />} />
          <ol className="divide-y divide-slate-100">
            {credits.data.map((c) => (
              <li key={c.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">Versión {c.version}</span>
                  <Badge tone={c.status === "vigente" ? "green" : c.status === "revertida" ? "red" : "gray"}>{CREDIT_STATUS_LABEL[c.status]}</Badge>
                  <span className="text-sm text-slate-500">{c.totalPoints} pts · {plural(c.playerCount, "jugador", "jugadores")}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">Confirmada por {c.createdByName ?? "—"} · {formatDateTime(c.createdAt)}{c.reason ? ` · Motivo: ${c.reason}` : ""}</p>
                {c.closedAt && (
                  <p className="text-xs text-slate-500">
                    {c.status === "revertida" ? "Revertida" : "Reemplazada"} por {c.closedByName ?? "—"} · {formatDateTime(c.closedAt)}{c.closeReason ? ` · ${c.closeReason}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {active && !p.locked && (
            <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-xs text-slate-500">Revertir descuenta todos los puntos de la versión vigente mediante contraasientos. El historial se conserva.</p>
              <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" icon={<RotateCcw className="size-4" />}
                onClick={() => { setError(null); setReason(""); setCancelTournament(false); setReverting(true); }}>
                Revertir acreditación
              </Button>
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-slate-500">
        Los puntos impactan en los <Link to="/rankings" className="font-medium text-brand-700 hover:underline">rankings</Link> y quedan en el{" "}
        <Link to={`/movimientos?tournamentId=${tournament.id}`} className="font-medium text-brand-700 hover:underline">registro de movimientos</Link>.
      </p>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={isCorrection ? "Confirmar corrección" : "Confirmar acreditación"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Volver</Button>
            <Button loading={confirm.isPending} onClick={() => confirm.mutate()} disabled={isCorrection && !reason.trim()}>
              {isCorrection ? "Confirmar corrección" : "Acreditar puntos"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          {isCorrection ? (
            <p>Se reemplazará la versión {active!.version} por una nueva: se descuentan sus puntos y se acreditan los nuevos, en una sola operación. {plural(changes.length, "jugador cambia", "jugadores cambian")} de puntaje.</p>
          ) : (
            <p>Se acreditarán <strong className="text-slate-900">{p.totals.points} puntos</strong> a <strong className="text-slate-900">{plural(p.totals.players, "jugador", "jugadores")}</strong> de {plural(p.totals.teams, "pareja")}. El torneo quedará finalizado.</p>
          )}
          {(isCorrection || warnings.length > 0) && (
            <TextAreaField label={isCorrection ? "Motivo de la corrección" : "Observaciones (opcional)"} required={isCorrection} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={isCorrection ? "Ej.: se invirtió el resultado de la final" : undefined} />
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 font-medium text-red-700">{error}</p>}
        </div>
      </Modal>

      <Modal
        open={reverting}
        onClose={() => setReverting(false)}
        title="Revertir acreditación"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReverting(false)}>Volver</Button>
            <Button variant="danger" loading={revert.isPending} disabled={!reason.trim()} onClick={() => revert.mutate()}>
              {cancelTournament ? "Anular torneo" : "Revertir"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>Se descontarán los {active?.totalPoints ?? 0} puntos de la versión {active?.version}. Después vas a poder corregir los resultados y volver a acreditar.</p>
          <TextAreaField label="Motivo" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: se cargó el torneo equivocado" />
          <Checkbox label="Anular el torneo" checked={cancelTournament} onChange={setCancelTournament} hint="El torneo pasa a cancelado y no vuelve a puntuar (salvo que se reprograme)." />
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 font-medium text-red-700">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
