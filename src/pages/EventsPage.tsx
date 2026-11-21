import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { tournamentEventSchema } from "@shared/schemas";
import { SERIES, SERIES_LABEL, type Series } from "@shared/site";
import type { TournamentEvent } from "@shared/types";
import { api } from "@/lib/api";
import { formatRange } from "@/lib/format";
import { useForm } from "@/lib/useForm";
import { keys, useActiveGenders, useCategories, useEvents, useSeasons } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Checkbox, FilterSelect, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { TournamentStatusBadge } from "@/components/ui/badges";
import { useToast } from "@/components/ui/Toast";

/** Eventos con varias categorías (Fase 9). Cada categoría es un torneo largo con su propio fixture y puntos. */
export function TournamentEventsPage() {
  const seasons = useSeasons();
  const [seasonId, setSeasonId] = useState("");
  const events = useEvents(seasonId || null);
  const [editing, setEditing] = useState<TournamentEvent | "new" | null>(null);
  const [deleting, setDeleting] = useState<TournamentEvent | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  return (
    <>
      <PageHeader
        title="Eventos"
        description="Un evento agrupa varias categorías de un mismo torneo largo (por ejemplo, Qatar Major 2000: C5, C6 y C7). Cada categoría tiene sus parejas, fixture y puntos."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo evento</Button>}
      />
      <Card>
        <div className="border-b border-slate-100 p-3 sm:p-4">
          <FilterSelect value={seasonId} aria-label="Filtrar por temporada" onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">Todas las temporadas</option>
            {(seasons.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FilterSelect>
        </div>
        {events.isPending ? <Spinner /> : events.isError ? <ErrorState message={events.error.message} onRetry={() => void events.refetch()} /> :
          events.data.length === 0 ? (
            <EmptyState icon={<Layers className="size-6" />} title="Todavía no hay eventos"
              description="Creá un evento y elegí sus categorías: se arma un torneo largo por categoría."
              action={<Button variant="secondary" onClick={() => setEditing("new")}>Nuevo evento</Button>} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.data.map((ev) => (
                <li key={ev.id} className="p-4 sm:p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-bold uppercase tracking-wide text-navy">{ev.name}</h2>
                      <p className="text-sm text-slate-500">
                        {ev.seasonName} · {formatRange(ev.startDate, ev.endDate)}{ev.venue ? ` · ${ev.venue}` : ""}
                        {ev.series ? <> · <Badge tone="blue">{SERIES_LABEL[ev.series]}</Badge></> : null}
                      </p>
                    </div>
                    {ev.seasonStatus !== "cerrada" && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(ev)}>Editar</Button>
                        <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(ev)} aria-label={`Eliminar ${ev.name}`} />
                      </div>
                    )}
                  </div>
                  {ev.tournaments.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Sin categorías. Editá el evento para agregarlas.</p>
                  ) : (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {ev.tournaments.map((t) => (
                        <li key={t.id}>
                          <Link to={`/torneos/${t.id}?tab=fixture`} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200 hover:bg-brand-50 hover:ring-brand-300">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-slate-900">{t.categoryName}</p>
                              <p className="text-xs text-slate-500">{t.teamCount} pareja{t.teamCount === 1 ? "" : "s"}</p>
                            </div>
                            <TournamentStatusBadge status={t.status} />
                            <ChevronRight className="size-4 text-slate-300" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
      </Card>
      {editing && <EventForm event={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Eliminar evento"
        message="Se elimina sólo el agrupamiento: las categorías quedan como torneos sueltos, con sus parejas, fixture y puntos."
        confirmLabel="Eliminar evento"
        onConfirm={async () => {
          await api.delete(`/events/${deleting!.id}`);
          void qc.invalidateQueries({ queryKey: keys.events });
          void qc.invalidateQueries({ queryKey: keys.tournaments });
          toast("Evento eliminado");
        }} />
    </>
  );
}

function EventForm({ event, onClose }: { event: TournamentEvent | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const seasons = useSeasons();
  const categories = useCategories();
  const activeGenders = useActiveGenders();
  const openSeasons = (seasons.data ?? []).filter((s) => s.status !== "cerrada");
  const defaultSeason = openSeasons.find((s) => s.status === "activa") ?? openSeasons[0];
  const form = useForm({
    seasonId: String(event?.seasonId ?? defaultSeason?.id ?? ""),
    name: event?.name ?? "",
    series: (event?.series ?? "") as Series | "",
    startDate: event?.startDate ?? "",
    endDate: event?.endDate ?? "",
    venue: event?.venue ?? "",
    notes: event?.notes ?? "",
    publicVisible: false,
    categoryIds: [] as number[],
    applyToCategories: false,
  });
  const v = form.values;
  const existing = new Set((event?.tournaments ?? []).map((t) => t.categoryId));
  // Damas está discontinuada: sólo ramas activas y categorías activas.
  const available = useMemo(
    () => (categories.data ?? []).filter((c) => c.active && activeGenders.includes(c.gender) && !existing.has(c.id)).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
    [categories.data, activeGenders, existing],
  );
  const save = useMutation({
    mutationFn: (body: unknown) => (event ? api.put(`/events/${event.id}`, body) : api.post("/events", body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.events });
      void qc.invalidateQueries({ queryKey: keys.tournaments });
      toast(event ? "Evento actualizado" : "Evento creado");
      onClose();
    },
    onError: form.handleApiError,
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const data = form.validate(tournamentEventSchema);
    if (data) save.mutate(data);
  };
  const toggle = (id: number, on: boolean) => form.set("categoryIds", on ? [...v.categoryIds, id] : v.categoryIds.filter((x) => x !== id));
  const season = openSeasons.find((s) => String(s.id) === v.seasonId);

  return (
    <Modal open size="lg" onClose={onClose} title={event ? `Editar ${event.name}` : "Nuevo evento"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="event-form" loading={save.isPending}>Guardar</Button></>}>
      <form id="event-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={form.formError} />
        <TextField label="Nombre" required placeholder="Ej.: Qatar Major 2000" value={v.name} onChange={(e) => form.set("name", e.target.value)} error={form.errors.name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Temporada" required value={v.seasonId} disabled={!!event?.tournaments.length} onChange={(e) => form.set("seasonId", e.target.value)} error={form.errors.seasonId}>
            <option value="">Elegir…</option>
            {openSeasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <SelectField label="Modalidad" value={v.series} onChange={(e) => form.set("series", e.target.value as Series | "")} error={form.errors.series}>
            <option value="">Sin especificar</option>
            {SERIES.map((s) => <option key={s} value={s}>{SERIES_LABEL[s]}</option>)}
          </SelectField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Fecha de inicio" required type="date" min={season?.startDate} max={season?.endDate} value={v.startDate} onChange={(e) => form.set("startDate", e.target.value)} error={form.errors.startDate} />
          <TextField label="Fecha de finalización" required type="date" min={v.startDate || season?.startDate} max={season?.endDate} value={v.endDate} onChange={(e) => form.set("endDate", e.target.value)} error={form.errors.endDate} />
        </div>
        <TextField label="Sede" value={v.venue} onChange={(e) => form.set("venue", e.target.value)} error={form.errors.venue} />
        <TextAreaField label="Notas internas" value={v.notes} onChange={(e) => form.set("notes", e.target.value)} error={form.errors.notes} />

        <fieldset className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
          <legend className="px-1 text-sm font-semibold text-slate-800">{event ? "Agregar categorías" : "Categorías"}</legend>
          {event && event.tournaments.length > 0 && <p className="mb-2 text-xs text-slate-500">Ya incluidas: {event.tournaments.map((t) => t.categoryName).join(", ")}.</p>}
          {available.length === 0 ? <p className="text-sm text-slate-500">No hay más categorías activas para agregar.</p> : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {available.map((c) => <Checkbox key={c.id} label={c.name} checked={v.categoryIds.includes(c.id)} onChange={(on) => toggle(c.id, on)} />)}
            </div>
          )}
          {form.errors.categoryIds && <p className="mt-1 text-xs font-medium text-red-600">{form.errors.categoryIds}</p>}
          <p className="mt-2 text-xs text-slate-500">Se crea un torneo largo por categoría, con la puntuación predeterminada (editable en cada uno).</p>
        </fieldset>
        {!event && <Checkbox label="Publicar las categorías en la web" checked={v.publicVisible} onChange={(c) => form.set("publicVisible", c)} hint="Se puede cambiar después en cada categoría." />}
        {event && event.tournaments.length > 0 && (
          <Checkbox label="Copiar nombre, fechas, sede y modalidad a las categorías" checked={v.applyToCategories} onChange={(c) => form.set("applyToCategories", c)}
            hint="No se modifican las categorías con puntos acreditados." />
        )}
      </form>
    </Modal>
  );
}
