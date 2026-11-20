import { useEffect, useMemo, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tournamentSchema } from "@shared/schemas";
import { GENDER_LABEL, TOURNAMENT_TYPE_LABEL, type TournamentType } from "@shared/constants";
import type { Tournament } from "@shared/types";
import { SERIES, SERIES_LABEL, tournamentPath, type Series } from "@shared/site";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { keys, useActiveGenders, useCategories, useSeasons } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

export function TournamentForm({ tournament, onClose, onSaved }: { tournament: Tournament | null; onClose: () => void; onSaved?: (t: Tournament) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const seasons = useSeasons();
  const categories = useCategories();
  const activeGenders = useActiveGenders();
  const openSeasons = (seasons.data ?? []).filter((s) => s.status !== "cerrada");
  const defaultSeason = openSeasons.find((s) => s.status === "activa") ?? openSeasons[0];

  const form = useForm({
    seasonId: String(tournament?.seasonId ?? defaultSeason?.id ?? ""),
    name: tournament?.name ?? "",
    type: (tournament?.type ?? "largo") as TournamentType,
    categoryId: String(tournament?.categoryId ?? ""),
    divisionId: String(tournament?.divisionId ?? ""),
    startDate: tournament?.startDate ?? "",
    endDate: tournament?.endDate ?? "",
    venue: tournament?.venue ?? "",
    notes: tournament?.notes ?? "",
    publicVisible: tournament?.publicVisible ?? false,
    featured: tournament?.featured ?? false,
    registrationOpen: tournament?.registrationOpen ?? false,
    series: (tournament?.series ?? "") as Series | "",
    publicDescription: tournament?.publicDescription ?? "",
    prizeInfo: tournament?.prizeInfo ?? "",
  });
  const v = form.values;
  // Si las temporadas cargan después de abrir el formulario, se preselecciona la activa.
  const { set } = form;
  useEffect(() => {
    if (!v.seasonId && defaultSeason) set("seasonId", String(defaultSeason.id));
  }, [v.seasonId, defaultSeason, set]);

  const season = openSeasons.find((s) => String(s.id) === v.seasonId);
  const selectableCategories = useMemo(
    // Sólo categorías activas de ramas activas (Damas está discontinuada); al editar se conserva la del torneo.
    () => (categories.data ?? []).filter((c) => (c.active && activeGenders.includes(c.gender)) || c.id === tournament?.categoryId),
    [categories.data, tournament?.categoryId, activeGenders],
  );
  const category = selectableCategories.find((c) => String(c.id) === v.categoryId);
  const divisions = (category?.divisions ?? []).filter((d) => d.active || d.id === tournament?.divisionId);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      tournament ? api.put<{ item: Tournament }>(`/tournaments/${tournament.id}`, body) : api.post<{ item: Tournament }>("/tournaments", body),
    onSuccess: ({ item }) => {
      void qc.invalidateQueries({ queryKey: keys.tournaments });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
      void qc.invalidateQueries({ queryKey: keys.seasons });
      void qc.invalidateQueries({ queryKey: keys.categories });
      toast(tournament ? "Torneo actualizado" : "Torneo creado");
      // Primero se cierra (puede tocar la URL del listado) y después se notifica:
      // así una navegación hecha en onSaved no queda pisada por el cierre.
      onClose();
      onSaved?.(item);
    },
    onError: form.handleApiError,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const data = form.validate(tournamentSchema);
    if (data) save.mutate(data);
  }

  const noSeasons = seasons.isSuccess && openSeasons.length === 0;
  const noCategories = categories.isSuccess && selectableCategories.length === 0;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={tournament ? `Editar ${tournament.name}` : "Nuevo torneo"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="tournament-form" loading={save.isPending} disabled={noSeasons}>Guardar</Button>
        </>
      }
    >
      {noSeasons ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          No hay temporadas abiertas. Creá o reabrí una temporada antes de cargar torneos.
        </p>
      ) : (
        <form id="tournament-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={form.formError} />
          <TextField label="Nombre" required placeholder="Ej.: Torneo Apertura" value={v.name} onChange={(e) => form.set("name", e.target.value)} error={form.errors.name} />

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Tipo<span className="ml-0.5 text-red-500">*</span></span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de torneo">
              {(["largo", "americano"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={v.type === t} onClick={() => form.set("type", t)}
                  className={cn("rounded-lg px-3 py-2 text-left ring-1 ring-inset transition-colors",
                    v.type === t ? "bg-brand-50 ring-brand-600" : "bg-white ring-slate-300 hover:bg-slate-50")}>
                  <span className="block text-sm font-medium text-slate-900">{TOURNAMENT_TYPE_LABEL[t]}</span>
                  <span className="block text-xs text-slate-500">{t === "largo" ? "Se juega en varias fechas" : "Se juega en un solo día"}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Temporada" required value={v.seasonId} onChange={(e) => form.set("seasonId", e.target.value)} error={form.errors.seasonId}
              hint={season ? `Del ${season.startDate.split("-").reverse().join("/")} al ${season.endDate.split("-").reverse().join("/")}` : undefined}>
              <option value="">Elegir…</option>
              {openSeasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "activa" ? " (activa)" : ""}</option>)}
            </SelectField>
            <SelectField label="Categoría" required value={v.categoryId} disabled={noCategories || categories.isError}
              onChange={(e) => { form.set("categoryId", e.target.value); form.set("divisionId", ""); }} error={form.errors.categoryId}
              hint={categories.isError ? "No se pudieron cargar las categorías. Cerrá y volvé a intentar." : undefined}>
              <option value="">{categories.isPending ? "Cargando…" : noCategories ? "No hay categorías activas" : "Elegir…"}</option>
              {/* Sólo se dibujan los grupos que tienen opciones: un grupo vacío no se puede elegir. */}
              {(["M", "F"] as const).map((g) => {
                const list = selectableCategories.filter((c) => c.gender === g);
                if (list.length === 0) return null;
                return (
                  <optgroup key={g} label={GENDER_LABEL[g]}>
                    {list.map((c) => <option key={c.id} value={c.id}>{c.name} · {GENDER_LABEL[g]}</option>)}
                  </optgroup>
                );
              })}
            </SelectField>
          </div>
          {noCategories && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              No hay categorías activas. <Link to="/categorias" onClick={onClose} className="font-semibold underline">Creá las categorías</Link> (por ejemplo 4ta Caballeros) antes de cargar torneos.
            </p>
          )}

          {divisions.length > 0 && (
            <SelectField label="División" value={v.divisionId} onChange={(e) => form.set("divisionId", e.target.value)} error={form.errors.divisionId} hint="Opcional.">
              <option value="">Sin división</option>
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
          )}

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

          <fieldset className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
            <legend className="px-1 text-sm font-semibold text-slate-800">Web pública</legend>
            <Checkbox label="Publicar en la web" checked={v.publicVisible} onChange={(c) => form.set("publicVisible", c)}
              hint="El torneo aparece en Inicio, Torneos y Calendario. Sólo se publica información de la web: nunca notas internas ni datos personales." />
            {tournament?.publicVisible && (
              <a href={tournamentPath(tournament)} target="_blank" rel="noopener" className="ml-7 inline-block text-sm font-medium text-brand-700 hover:underline">Ver la página del torneo ↗</a>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Modalidad" value={v.series} onChange={(e) => form.set("series", e.target.value as Series | "")} error={form.errors.series}
                hint="Según el reglamento. Se usa para filtrar en la web.">
                <option value="">Sin especificar</option>
                {SERIES.map((s) => <option key={s} value={s}>{SERIES_LABEL[s]}</option>)}
              </SelectField>
              <div className="space-y-3 pt-1">
                <Checkbox label="Destacado" checked={v.featured} onChange={(c) => form.set("featured", c)} hint="Se resalta en la portada." />
                <Checkbox label="Inscripción abierta" checked={v.registrationOpen} onChange={(c) => form.set("registrationOpen", c)}
                  hint="Muestra el botón Inscribirme (abre WhatsApp)." />
              </div>
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
