import { useEffect, useMemo, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tournamentEventSchema } from "@shared/schemas";
import { GENDER_LABEL, TOURNAMENT_STATUS_LABEL, TOURNAMENT_TYPE_LABEL, type TournamentType } from "@shared/constants";
import type { TournamentEvent } from "@shared/types";
import { SERIES, SERIES_LABEL, type Series } from "@shared/site";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { keys, useActiveGenders, useCategories, useSeasons } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

interface Option { key: string; categoryId: number; divisionId: number | null; label: string; gender: "M" | "F" }
const keyOf = (categoryId: number, divisionId: number | null) => `${categoryId}:${divisionId ?? 0}`;

/**
 * Alta y edición de un torneo (evento general). Los datos generales se cargan una sola vez y se copian a
 * cada categoría; cada categoría elegida es una competencia independiente (parejas, fixture, puntos).
 */
export function TorneoForm({ event, onClose, onSaved }: { event: TournamentEvent | null; onClose: () => void; onSaved?: (e: TournamentEvent) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const seasons = useSeasons();
  const categories = useCategories();
  const activeGenders = useActiveGenders();
  const openSeasons = (seasons.data ?? []).filter((s) => s.status !== "cerrada");
  const defaultSeason = openSeasons.find((s) => s.status === "activa") ?? openSeasons[0];
  const hasTeams = !!event?.tournaments.some((t) => t.teamCount > 0);

  const form = useForm({
    seasonId: String(event?.seasonId ?? defaultSeason?.id ?? ""),
    name: event?.name ?? "",
    type: (event?.type ?? "largo") as TournamentType,
    series: (event?.series ?? "") as Series | "",
    startDate: event?.startDate ?? "",
    endDate: event?.endDate ?? "",
    venue: event?.venue ?? "",
    notes: event?.notes ?? "",
    publicVisible: event?.publicVisible ?? false,
    featured: event?.featured ?? false,
    registrationOpen: event?.registrationOpen ?? false,
    publicDescription: event?.publicDescription ?? "",
    prizeInfo: event?.prizeInfo ?? "",
    selected: [] as string[],
  });
  const v = form.values;
  const { set } = form;
  useEffect(() => {
    if (!v.seasonId && defaultSeason) set("seasonId", String(defaultSeason.id));
  }, [v.seasonId, defaultSeason, set]);
  const season = openSeasons.find((s) => String(s.id) === v.seasonId);

  const existing = useMemo(() => new Set((event?.tournaments ?? []).map((t) => keyOf(t.categoryId, t.divisionId))), [event]);
  // Categorías activas de ramas activas (Damas está discontinuada). Las divisiones activas, como opción aparte.
  const options = useMemo<Option[]>(() => {
    const multi = activeGenders.length > 1;
    return (categories.data ?? [])
      .filter((c) => c.active && activeGenders.includes(c.gender))
      .sort((a, b) => a.gender.localeCompare(b.gender) || a.level - b.level || a.name.localeCompare(b.name))
      .flatMap((c) => {
        const base = `${c.name}${multi ? ` ${GENDER_LABEL[c.gender]}` : ""}`;
        return [
          { key: keyOf(c.id, null), categoryId: c.id, divisionId: null, label: base, gender: c.gender },
          ...c.divisions.filter((d) => d.active).map((d) => ({ key: keyOf(c.id, d.id), categoryId: c.id, divisionId: d.id, label: `${base} · División ${d.name}`, gender: c.gender })),
        ];
      })
      .filter((o) => !existing.has(o.key));
  }, [categories.data, activeGenders, existing]);

  const save = useMutation({
    mutationFn: (body: unknown) => (event ? api.put<{ item: TournamentEvent }>(`/events/${event.id}`, body) : api.post<{ item: TournamentEvent }>("/events", body)),
    onSuccess: ({ item }) => {
      for (const k of [keys.tournaments, keys.events, keys.dashboard, keys.seasons, keys.categories]) void qc.invalidateQueries({ queryKey: k });
      toast(event ? "Torneo actualizado" : "Torneo creado");
      onClose();
      onSaved?.(item);
    },
    onError: form.handleApiError,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const competitions = v.selected.map((k) => options.find((o) => o.key === k)!).filter(Boolean).map((o) => ({ categoryId: o.categoryId, divisionId: o.divisionId }));
    if (!event && competitions.length === 0) {
      form.setErrors({ competitions: "Elegí al menos una categoría" });
      form.setFormError("Revisá los campos marcados");
      return;
    }
    const { selected: _selected, ...rest } = v;
    void _selected;
    const parsed = tournamentEventSchema.safeParse({ ...rest, competitions });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
      form.setErrors(fields);
      form.setFormError("Revisá los campos marcados");
      return;
    }
    form.setErrors({});
    form.setFormError(null);
    save.mutate(parsed.data);
  }
  const toggle = (k: string, on: boolean) => form.set("selected", on ? [...v.selected, k] : v.selected.filter((x) => x !== k));
  const noSeasons = seasons.isSuccess && openSeasons.length === 0;

  return (
    <Modal open size="lg" onClose={onClose} title={event ? `Editar ${event.name}` : "Nuevo torneo"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="torneo-form" loading={save.isPending} disabled={noSeasons}>Guardar</Button></>}>
      {noSeasons ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">No hay temporadas abiertas. Creá o reabrí una temporada antes de cargar torneos.</p>
      ) : (
        <form id="torneo-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={form.formError} />
          <TextField label="Nombre" required placeholder="Ej.: Open Padel Time — Noviembre 2026" value={v.name} onChange={(e) => form.set("name", e.target.value)} error={form.errors.name} />

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Tipo<span className="ml-0.5 text-red-500">*</span></span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de torneo">
              {(["largo", "americano"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={v.type === t} disabled={hasTeams && v.type !== t} onClick={() => form.set("type", t)}
                  className={cn("rounded-lg px-3 py-2 text-left ring-1 ring-inset transition-colors disabled:opacity-50", v.type === t ? "bg-brand-50 ring-brand-600" : "bg-white ring-slate-300 hover:bg-slate-50")}>
                  <span className="block text-sm font-medium text-slate-900">{TOURNAMENT_TYPE_LABEL[t]}</span>
                  <span className="block text-xs text-slate-500">{t === "largo" ? "Varias fechas, con grupos y fixture" : "Satélite: un solo día, se carga el cuadro final"}</span>
                </button>
              ))}
            </div>
          </div>

          <fieldset className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
            <legend className="px-1 text-sm font-semibold text-slate-800">{event ? "Categorías" : "Categorías participantes"}<span className="ml-0.5 text-red-500">*</span></legend>
            {event && event.tournaments.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {event.tournaments.map((t) => <Badge key={t.id} tone="blue">{t.categoryName}{t.divisionName ? ` · ${t.divisionName}` : ""} · {TOURNAMENT_STATUS_LABEL[t.status]}</Badge>)}
              </div>
            )}
            {event && <p className="mb-2 text-xs text-slate-500">Agregar categorías:</p>}
            {categories.isPending ? <p className="text-sm text-slate-500">Cargando…</p> : options.length === 0 ? (
              <p className="text-sm text-slate-500">{event ? "No hay más categorías activas para agregar." : <>No hay categorías activas. <Link to="/categorias" onClick={onClose} className="font-semibold underline">Creá las categorías</Link>.</>}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Categorías">
                {options.map((o) => <Checkbox key={o.key} label={o.label} checked={v.selected.includes(o.key)} onChange={(on) => toggle(o.key, on)} />)}
              </div>
            )}
            {form.errors.competitions && <p className="mt-1 text-xs font-medium text-red-600">{form.errors.competitions}</p>}
            <p className="mt-2 text-xs text-slate-500">Cada categoría es una competencia independiente: sus parejas, {v.type === "largo" ? "grupos, fixture, " : "cuadro final, "}puntos y acreditación.</p>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Temporada" required value={v.seasonId} disabled={!!event?.tournaments.length} onChange={(e) => form.set("seasonId", e.target.value)} error={form.errors.seasonId}
              hint={season ? `Del ${season.startDate.split("-").reverse().join("/")} al ${season.endDate.split("-").reverse().join("/")}` : undefined}>
              <option value="">Elegir…</option>
              {openSeasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "activa" ? " (activa)" : ""}</option>)}
            </SelectField>
            <SelectField label="Modalidad" value={v.series} onChange={(e) => form.set("series", e.target.value as Series | "")} error={form.errors.series} hint="Según el reglamento.">
              <option value="">Sin especificar</option>
              {SERIES.map((s) => <option key={s} value={s}>{SERIES_LABEL[s]}</option>)}
            </SelectField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={v.type === "americano" ? "Fecha" : "Fecha de inicio"} required type="date" min={season?.startDate} max={season?.endDate}
              value={v.startDate} onChange={(e) => form.set("startDate", e.target.value)} error={form.errors.startDate} />
            {v.type === "largo" && (
              <TextField label="Fecha de finalización" type="date" min={v.startDate || season?.startDate} max={season?.endDate}
                value={v.endDate} onChange={(e) => form.set("endDate", e.target.value)} error={form.errors.endDate} hint="Si no la sabés, dejala vacía." />
            )}
          </div>
          <TextField label="Sede" placeholder="Club o complejo" value={v.venue} onChange={(e) => form.set("venue", e.target.value)} error={form.errors.venue} />
          <TextAreaField label="Notas internas" value={v.notes} onChange={(e) => form.set("notes", e.target.value)} error={form.errors.notes} hint="No se muestran en la web." />
          {event && <p className="text-xs text-slate-500">Estado del torneo: <b>{TOURNAMENT_STATUS_LABEL[event.status]}</b>. Cada categoría avanza por su cuenta (se inicia, finaliza y acredita en su pestaña).</p>}

          <fieldset className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
            <legend className="px-1 text-sm font-semibold text-slate-800">Web pública</legend>
            <Checkbox label="Publicar en la web" checked={v.publicVisible} onChange={(c) => form.set("publicVisible", c)}
              hint="El torneo aparece una sola vez en Inicio, Torneos y Calendario; el visitante elige la categoría. Nunca se publican notas internas ni datos personales." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Checkbox label="Destacado" checked={v.featured} onChange={(c) => form.set("featured", c)} hint="Se resalta en la portada." />
              <Checkbox label="Inscripción abierta" checked={v.registrationOpen} onChange={(c) => form.set("registrationOpen", c)} hint="Muestra el botón Inscribirme (abre WhatsApp)." />
            </div>
            <TextAreaField label="Información para la web" value={v.publicDescription} onChange={(e) => form.set("publicDescription", e.target.value)}
              error={form.errors.publicDescription} hint="Opcional. Formato, horarios, costo de inscripción…" />
            <TextAreaField label="Premios" value={v.prizeInfo} onChange={(e) => form.set("prizeInfo", e.target.value)} error={form.errors.prizeInfo}
              hint="Opcional. Se muestran en la página del torneo y en Premios." />
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
