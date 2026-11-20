import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Lock, LockOpen, Pencil, Play, Plus, Trash2, Trophy } from "lucide-react";
import { seasonSchema } from "@shared/schemas";
import type { SeasonStatus } from "@shared/constants";
import type { Season } from "@shared/types";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { formatDate, plural } from "@/lib/format";
import { keys, useSeasons } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { FormError, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { SeasonStatusBadge } from "@/components/ui/badges";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthContext";

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.seasons });
    void qc.invalidateQueries({ queryKey: keys.dashboard });
    void qc.invalidateQueries({ queryKey: keys.tournaments });
  };
}

function SeasonForm({ season, onClose }: { season: Season | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const nextYear = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 1 : 0);
  const form = useForm({
    name: season?.name ?? `Temporada ${nextYear}`,
    year: String(season?.year ?? nextYear),
    startDate: season?.startDate ?? `${nextYear}-01-01`,
    endDate: season?.endDate ?? `${nextYear}-12-31`,
    notes: season?.notes ?? "",
  });
  const save = useMutation({
    mutationFn: (body: unknown) => (season ? api.put(`/seasons/${season.id}`, body) : api.post("/seasons", body)),
    onSuccess: () => {
      invalidate();
      toast(season ? "Temporada actualizada" : "Temporada creada");
      onClose();
    },
    onError: form.handleApiError,
  });

  // Al cambiar el año en una temporada nueva, se sugieren nombre y fechas.
  const onYear = (y: string) => {
    form.set("year", y);
    if (!season && /^\d{4}$/.test(y)) {
      form.set("name", `Temporada ${y}`);
      form.set("startDate", `${y}-01-01`);
      form.set("endDate", `${y}-12-31`);
    }
  };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const data = form.validate(seasonSchema);
    if (data) save.mutate(data);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={season ? `Editar ${season.name}` : "Nueva temporada"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="season-form" loading={save.isPending}>Guardar</Button>
        </>
      }
    >
      <form id="season-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={form.formError} />
        <div className="grid grid-cols-3 gap-4">
          <TextField label="Año" required type="number" inputMode="numeric" value={form.values.year} onChange={(e) => onYear(e.target.value)} error={form.errors.year} />
          <TextField label="Nombre" required containerClassName="col-span-2" value={form.values.name} onChange={(e) => form.set("name", e.target.value)} error={form.errors.name} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Inicio" required type="date" value={form.values.startDate} onChange={(e) => form.set("startDate", e.target.value)} error={form.errors.startDate} />
          <TextField label="Fin" required type="date" value={form.values.endDate} onChange={(e) => form.set("endDate", e.target.value)} error={form.errors.endDate} />
        </div>
        <TextAreaField label="Notas" value={form.values.notes} onChange={(e) => form.set("notes", e.target.value)} error={form.errors.notes} />
      </form>
    </Modal>
  );
}

type Action = { season: Season; kind: "status"; status: SeasonStatus } | { season: Season; kind: "delete" };

const ACTION_TEXT: Record<SeasonStatus, { title: string; message: string; label: string }> = {
  activa: { title: "Activar temporada", message: "Pasará a ser la temporada vigente. Sólo puede haber una activa a la vez.", label: "Activar" },
  cerrada: { title: "Cerrar temporada", message: "Una vez cerrada no se podrán crear ni modificar sus torneos ni sus puntos: el ranking queda como histórico. Sólo un administrador puede reabrirla.", label: "Cerrar temporada" },
  planificada: { title: "Reabrir temporada", message: "La temporada volverá a estado planificada y se podrán modificar sus torneos y puntos históricos. Hacelo sólo para corregir un error y volvé a cerrarla al terminar.", label: "Reabrir" },
};

export function SeasonsPage() {
  const seasons = useSeasons();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const invalidate = useInvalidate();
  const toast = useToast();
  const [editing, setEditing] = useState<Season | null | "new">(null);
  const [action, setAction] = useState<Action | null>(null);

  async function runAction() {
    if (!action) return;
    if (action.kind === "delete") {
      await api.delete(`/seasons/${action.season.id}`);
      toast("Temporada eliminada");
    } else {
      await api.patch(`/seasons/${action.season.id}/status`, { status: action.status });
      toast(`${action.season.name}: ${ACTION_TEXT[action.status].label.toLowerCase()} ✓`);
    }
    invalidate();
  }

  return (
    <>
      <PageHeader
        title="Temporadas"
        description="Temporadas anuales. Los rankings se acumulan dentro de cada temporada."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nueva temporada</Button>}
      />
      {seasons.isPending ? <Spinner /> : seasons.isError ? <ErrorState message={seasons.error.message} onRetry={() => void seasons.refetch()} /> :
        seasons.data.length === 0 ? (
          <Card>
            <EmptyState icon={<CalendarRange className="size-6" />} title="Todavía no hay temporadas"
              description="Creá la temporada del año para poder cargar torneos."
              action={<Button onClick={() => setEditing("new")}>Crear temporada</Button>} />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {seasons.data.map((s) => (
              <Card key={s.id} className={cn("flex flex-col", s.status === "activa" && "ring-2 ring-brand-600")}>
                <div className="flex-1 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{s.name}</h2>
                      <p className="text-sm text-slate-500">{formatDate(s.startDate)} al {formatDate(s.endDate)}</p>
                    </div>
                    <SeasonStatusBadge status={s.status} />
                  </div>
                  <div className="mt-4 flex items-center gap-4 text-sm">
                    <Link to={`/torneos?seasonId=${s.id}`} className="flex items-center gap-1.5 text-slate-600 hover:text-brand-700">
                      <Trophy className="size-4 text-slate-400" /> {plural(s.tournamentCount, "torneo")}
                    </Link>
                    <span className="text-slate-400">{s.finishedCount} finalizados</span>
                  </div>
                  {s.notes && <p className="mt-3 text-xs text-slate-500">{s.notes}</p>}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
                  {s.status !== "cerrada" && (
                    <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(s)}>Editar</Button>
                  )}
                  {s.status === "planificada" && (
                    <Button size="sm" variant="subtle" icon={<Play className="size-3.5" />} onClick={() => setAction({ season: s, kind: "status", status: "activa" })}>Activar</Button>
                  )}
                  {s.status === "activa" && (
                    <Button size="sm" variant="ghost" icon={<Lock className="size-3.5" />} onClick={() => setAction({ season: s, kind: "status", status: "cerrada" })}>Cerrar</Button>
                  )}
                  {s.status === "cerrada" && isAdmin && (
                    <Button size="sm" variant="ghost" icon={<LockOpen className="size-3.5" />} onClick={() => setAction({ season: s, kind: "status", status: "planificada" })}>Reabrir</Button>
                  )}
                  {s.tournamentCount === 0 && s.status !== "activa" && (
                    <Button size="sm" variant="ghost" className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700" icon={<Trash2 className="size-3.5" />}
                      onClick={() => setAction({ season: s, kind: "delete" })}>Eliminar</Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

      {editing && <SeasonForm season={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        title={action?.kind === "delete" ? "Eliminar temporada" : action ? ACTION_TEXT[action.status].title : ""}
        message={action?.kind === "delete" ? `Se eliminará ${action.season.name}. No tiene torneos cargados.` : action ? ACTION_TEXT[action.status].message : ""}
        confirmLabel={action?.kind === "delete" ? "Eliminar" : action ? ACTION_TEXT[action.status].label : ""}
        tone={action?.kind === "delete" || (action?.kind === "status" && action.status === "cerrada") ? "danger" : "primary"}
        onConfirm={runAction}
      />
    </>
  );
}
