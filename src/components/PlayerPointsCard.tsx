import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { adjustmentSchema } from "@shared/schemas";
import type { PlayerDetail, PlayerPointsResponse, PointMovement } from "@shared/types";
import { api, ApiError } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { keys, useSeasons } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { FormError, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Card, CardHeader, ErrorState, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { MovementList } from "./MovementList";
import { cn } from "@/lib/cn";

function AdjustmentForm({ player, onClose }: { player: PlayerDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const seasons = useSeasons();
  const open = (seasons.data ?? []).filter((s) => s.status !== "cerrada");
  const defaultSeasonId = String(open.find((s) => s.status === "activa")?.id ?? open[0]?.id ?? "");
  const form = useForm({ seasonId: defaultSeasonId, points: "", reason: "" });
  // Si las temporadas llegan después de abrir el formulario, se preselecciona la activa.
  const { set } = form;
  useEffect(() => {
    if (!form.values.seasonId && defaultSeasonId) set("seasonId", defaultSeasonId);
  }, [form.values.seasonId, defaultSeasonId, set]);
  const save = useMutation({
    mutationFn: (body: unknown) => api.post("/movements/adjustments", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.players });
      void qc.invalidateQueries({ queryKey: keys.rankings });
      void qc.invalidateQueries({ queryKey: keys.movements });
      toast("Ajuste registrado");
      onClose();
    },
    onError: form.handleApiError,
  });
  return (
    <Modal open onClose={onClose} title="Ajuste manual de puntos"
      description={`Se registra en la categoría principal actual (${player.mainCategoryName}) y queda en el historial con su motivo.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="adj-form" loading={save.isPending}>Registrar ajuste</Button></>}>
      <form id="adj-form" className="space-y-4" noValidate onSubmit={(e) => {
        e.preventDefault();
        const data = form.validate(adjustmentSchema.omit({ playerId: true }));
        if (data) save.mutate({ ...data, playerId: player.id });
      }}>
        <FormError message={form.formError} />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Temporada" value={form.values.seasonId} onChange={(e) => form.set("seasonId", e.target.value)} error={form.errors.seasonId}>
            {open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <TextField label="Puntos" type="number" inputMode="numeric" placeholder="Ej.: -10 o 5" value={form.values.points} onChange={(e) => form.set("points", e.target.value)}
            error={form.errors.points} hint="Negativo para descontar." />
        </div>
        <TextAreaField label="Motivo" required value={form.values.reason} onChange={(e) => form.set("reason", e.target.value)} error={form.errors.reason} placeholder="Ej.: sanción por W.O. en el Apertura" />
      </form>
    </Modal>
  );
}

export function PlayerPointsCard({ player }: { player: PlayerDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adjusting, setAdjusting] = useState(false);
  const [annulling, setAnnulling] = useState<PointMovement | null>(null);
  const [annulReason, setAnnulReason] = useState("");
  const [annulError, setAnnulError] = useState<string | null>(null);
  const [seasonFilter, setSeasonFilter] = useState<string>("");
  const q = useQuery({
    queryKey: [...keys.players, "points", player.id],
    queryFn: () => api.get<PlayerPointsResponse>(`/players/${player.id}/points`),
  });
  const annul = useMutation({
    mutationFn: () => api.post(`/movements/${annulling!.id}/annul`, { reason: annulReason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.players });
      void qc.invalidateQueries({ queryKey: keys.rankings });
      void qc.invalidateQueries({ queryKey: keys.movements });
      toast("Ajuste anulado");
      setAnnulling(null);
    },
    onError: (e) => setAnnulError(e instanceof ApiError ? e.message : "Error inesperado"),
  });

  const movements = useMemo(
    () => (q.data?.movements ?? []).filter((m) => !seasonFilter || String(m.seasonId) === seasonFilter),
    [q.data, seasonFilter],
  );
  const seasonsInHistory = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of q.data?.summary ?? []) m.set(s.seasonId, s.seasonName);
    return [...m.entries()];
  }, [q.data]);

  return (
    <Card className="mt-6">
      <CardHeader title="Historial de puntos" subtitle="Movimientos registrados: acreditaciones, correcciones y ajustes"
        action={<Button size="sm" variant="subtle" icon={<Plus className="size-4" />} onClick={() => setAdjusting(true)}>Ajuste</Button>} />
      {q.isPending ? <Spinner /> : q.isError ? <ErrorState message={q.error.message} /> : q.data.summary.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">Todavía no tiene puntos registrados.</p>
      ) : (
        <>
          <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
            {q.data.summary.map((s) => (
              <button key={`${s.seasonId}-${s.categoryId}`} type="button" onClick={() => setSeasonFilter(seasonFilter === String(s.seasonId) ? "" : String(s.seasonId))}
                className={cn("rounded-lg p-3 text-left ring-1 ring-inset transition-colors", seasonFilter === String(s.seasonId) ? "bg-brand-50 ring-brand-600/40" : "bg-slate-50 ring-slate-200 hover:bg-slate-100")}>
                <p className="text-xs text-slate-500">{s.seasonName} · {s.categoryName}</p>
                <p className="text-2xl font-bold tabular text-slate-900">{s.points} <span className="text-sm font-medium text-slate-500">pts</span></p>
              </button>
            ))}
          </div>
          {seasonsInHistory.length > 1 && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs sm:px-5">
              <span className="text-slate-500">Mostrando:</span>
              <select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)} aria-label="Filtrar movimientos por temporada" className="rounded-md border-0 bg-transparent py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                <option value="">Todas las temporadas</option>
                {seasonsInHistory.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
          )}
          <MovementList items={movements} onAnnul={(m) => { setAnnulReason(""); setAnnulError(null); setAnnulling(m); }} />
        </>
      )}
      {adjusting && <AdjustmentForm player={player} onClose={() => setAdjusting(false)} />}
      <Modal open={!!annulling} onClose={() => setAnnulling(null)} title="Anular ajuste"
        footer={<><Button variant="secondary" onClick={() => setAnnulling(null)}>Volver</Button><Button variant="danger" disabled={!annulReason.trim()} loading={annul.isPending} onClick={() => annul.mutate()}>Anular ajuste</Button></>}>
        <div className="space-y-3 text-sm text-slate-600">
          <p>Se registrará un contraasiento de {annulling ? -annulling.points : 0} puntos. El ajuste original queda en el historial.</p>
          <TextAreaField label="Motivo" required value={annulReason} onChange={(e) => setAnnulReason(e.target.value)} />
          {annulError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 font-medium text-red-700">{annulError}</p>}
        </div>
      </Modal>
    </Card>
  );
}
