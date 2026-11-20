import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RotateCcw } from "lucide-react";
import { GENDER_LABEL } from "@shared/constants";
import type { RankingImportRecord, RankingImportRowDetail } from "@shared/types";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { keys } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, EmptyState, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

export const importKeys = { list: ["ranking-imports"] as const, detail: (id: number) => ["ranking-imports", id] as const };

function DetailDialog({ item, onClose }: { item: RankingImportRecord; onClose: () => void }) {
  const q = useQuery({
    queryKey: importKeys.detail(item.id),
    queryFn: () => api.get<{ item: RankingImportRecord; rows: RankingImportRowDetail[] }>(`/ranking-imports/${item.id}`),
  });
  return (
    <Modal open onClose={onClose} size="lg" title={`Importación #${item.id}`} description={`${item.fileName} · ${formatDateTime(item.createdAt)}`}>
      {q.isPending ? <Spinner /> : q.isError ? <FormError message={q.error.message} /> : (
        <div className="space-y-3">
          {item.warnings.length > 0 && (
            <details className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
              <summary className="cursor-pointer font-medium">Advertencias aceptadas ({item.warnings.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">{item.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          <div className="max-h-96 overflow-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-xs" data-testid="import-detail-rows">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">Fila</th><th className="px-2 py-1.5">Archivo</th><th className="px-2 py-1.5">Jugador</th><th className="px-2 py-1.5">Ranking</th><th className="px-2 py-1.5 text-right">Pts</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.rows.map((r) => (
                  <tr key={`${r.rowNumber}-${r.playerId}-${r.categoryName}`} className={r.active ? "" : "text-slate-400 line-through"}>
                    <td className="px-2 py-1 tabular">{r.rowNumber}</td>
                    <td className="px-2 py-1">{r.sourceName}</td>
                    <td className="px-2 py-1">{r.playerName} <span className="font-mono text-slate-400">{r.playerCode}</span></td>
                    <td className="px-2 py-1">{r.categoryName}{r.divisionName ? ` ${r.divisionName}` : ""} · {r.seasonName}</td>
                    <td className="px-2 py-1 text-right tabular">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RevertDialog({ item, onClose }: { item: RankingImportRecord; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.post<{ reversed: number }>(`/ranking-imports/${item.id}/revert`, { reason }),
    onSuccess: (r) => {
      toast(`Importación revertida: ${r.reversed} saldos anulados`);
      void qc.invalidateQueries({ queryKey: importKeys.list });
      void qc.invalidateQueries({ queryKey: keys.rankings });
      void qc.invalidateQueries({ queryKey: keys.movements });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Revertir importación" description={item.fileName}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" loading={m.isPending} disabled={!reason.trim()} onClick={() => m.mutate()}>Revertir {item.rowCount} saldos</Button>
      </>}>
      <div className="space-y-3 text-sm text-slate-600">
        <p>Se registra un contraasiento por cada saldo inicial de esta importación ({item.totalPoints.toLocaleString("es-AR")} pts en total). El historial se conserva y los rankings se recalculan al instante, también en la web.</p>
        {item.createdPlayers > 0 && <p>Los {item.createdPlayers} jugadores creados por la importación se conservan; si no corresponden, podés desactivarlos desde Jugadores.</p>}
        <label className="block">
          <span className="font-medium text-slate-700">Motivo <span className="text-red-600">*</span></span>
          <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} aria-label="Motivo de la reversión" autoFocus
            className="mt-1 block h-9 w-full rounded-lg border-0 px-3 ring-1 ring-inset ring-slate-300" placeholder="Ej.: archivo equivocado" />
        </label>
        <FormError message={m.error?.message ?? null} />
      </div>
    </Modal>
  );
}

export function ImportHistory() {
  const q = useQuery({ queryKey: importKeys.list, queryFn: async () => (await api.get<{ items: RankingImportRecord[] }>("/ranking-imports")).items });
  const [detail, setDetail] = useState<RankingImportRecord | null>(null);
  const [revert, setRevert] = useState<RankingImportRecord | null>(null);
  return (
    <Card>
      <CardHeader title="Importaciones realizadas" subtitle="Cada importación queda registrada y se puede revertir completa." />
      {q.isPending ? <Spinner /> : q.isError ? <FormError message={q.error.message} /> : q.data.length === 0 ? (
        <EmptyState icon={<History className="size-6" />} title="Sin importaciones" description="Cuando importes un ranking, aparecerá acá." />
      ) : (
        <ul className="divide-y divide-slate-100" data-testid="import-history">
          {q.data.map((it) => (
            <li key={it.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">#{it.id} · {it.fileName}</span>
                  {it.status === "vigente" ? <Badge tone="green">Vigente</Badge> : <Badge tone="gray">Revertida</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatDateTime(it.createdAt)} · {it.createdByName ?? "—"} · {it.rowCount} saldos · {it.totalPoints.toLocaleString("es-AR")} pts
                  {it.createdPlayers > 0 && ` · ${it.createdPlayers} jugadores nuevos`}{it.skippedRows > 0 && ` · ${it.skippedRows} filas omitidas`}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {it.rankings.slice(0, 10).map((r) => (
                    <Badge key={`${r.seasonId}:${r.categoryId}:${r.divisionId ?? 0}`}>{r.categoryName} {GENDER_LABEL[r.gender].slice(0, 3)}.{r.divisionName ? ` ${r.divisionName}` : ""} · {r.seasonName}</Badge>
                  ))}
                </div>
                {it.notes && <p className="mt-1 text-xs italic text-slate-500">{it.notes}</p>}
                {it.status === "revertida" && <p className="mt-1 text-xs text-slate-500">Revertida el {formatDateTime(it.revertedAt!)} por {it.revertedByName ?? "—"}. Motivo: {it.revertReason}</p>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDetail(it)}>Detalle</Button>
                {it.status === "vigente" && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} className="text-red-600" onClick={() => setRevert(it)}>Revertir</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {detail && <DetailDialog item={detail} onClose={() => setDetail(null)} />}
      {revert && <RevertDialog item={revert} onClose={() => setRevert(null)} />}
    </Card>
  );
}
