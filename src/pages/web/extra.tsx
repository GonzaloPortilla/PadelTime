import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CalendarDays, Handshake, Pencil, Plus, Trash2 } from "lucide-react";
import { EVENT_KINDS, EVENT_KIND_LABEL } from "@shared/site";
import { ApiError, api } from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { SiteSettingsCard } from "../publication/SiteSettingsCard";
import { MediaField } from "./media";

const back = <Link to="/web" className="text-sm font-medium text-brand-700 hover:underline">← Contenidos</Link>;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : null);

// ─────────────────────────── Patrocinadores ───────────────────────────
interface Sponsor { id: number; name: string; mediaId: string; url: string | null; active: boolean; version: number; logoUrl: string | null }
const sponsorsKey = ["cms", "sponsors"] as const;

function SponsorForm({ sponsor, onClose }: { sponsor: Sponsor | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(sponsor?.name ?? "");
  const [mediaId, setMediaId] = useState<string | null>(sponsor?.mediaId ?? null);
  const [url, setUrl] = useState(sponsor?.url ?? "");
  const [active, setActive] = useState(sponsor?.active ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, mediaId, url, active, version: sponsor?.version };
      return sponsor ? api.put(`/cms/sponsors/${sponsor.id}`, body) : api.post("/cms/sponsors", body);
    },
    onSuccess: () => { toast(sponsor ? "Patrocinador actualizado" : "Patrocinador agregado"); void qc.invalidateQueries({ queryKey: sponsorsKey }); onClose(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return (
    <Modal open onClose={onClose} title={sponsor ? `Editar ${sponsor.name}` : "Nuevo patrocinador"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="sponsor-form" loading={save.isPending} disabled={!name.trim() || !mediaId}>Guardar</Button></>}>
      <form id="sponsor-form" onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={errText(save.error)} />
        <TextField label="Nombre" required value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <MediaField label="Logo" kind="imagen" value={mediaId} allowEmpty={false} onChange={setMediaId} hint="Ideal: PNG o WebP con fondo transparente." />
        <TextField label="Enlace (opcional)" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Checkbox label="Mostrar en la web" checked={active} onChange={setActive} />
      </form>
    </Modal>
  );
}

export function SponsorsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: sponsorsKey, queryFn: async () => (await api.get<{ items: Sponsor[] }>("/cms/sponsors")).items });
  const [editing, setEditing] = useState<Sponsor | null | "new">(null);
  const [deleting, setDeleting] = useState<Sponsor | null>(null);
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.put("/cms/sponsors-order", { ids }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sponsorsKey }),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = q.data!.map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    reorder.mutate(ids);
  };
  return (
    <>
      <PageHeader title="Patrocinadores" description="Se muestran en la sección “Patrocinadores” del inicio (podés moverla u ocultarla desde la página Inicio)."
        actions={<div className="flex items-center gap-3">{back}<Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Agregar</Button></div>} />
      <Card>
        {q.isPending ? <Spinner /> : q.isError ? <ErrorState message={q.error.message} /> : q.data.length === 0 ? (
          <EmptyState icon={<Handshake className="size-6" />} title="Sin patrocinadores" description="Agregá el logo y el enlace de cada patrocinador." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {q.data.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200">{s.logoUrl && <img src={s.logoUrl} alt="" className="max-h-10 max-w-[72px] object-contain" />}</div>
                <div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-900">{s.name}</p><p className="truncate text-xs text-slate-500">{s.url ?? "Sin enlace"}</p></div>
                {!s.active && <Badge tone="gray">Oculto</Badge>}
                <IconButton label={`Subir ${s.name}`} disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp className="size-4" /></IconButton>
                <IconButton label={`Bajar ${s.name}`} disabled={i === q.data.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown className="size-4" /></IconButton>
                <IconButton label={`Editar ${s.name}`} onClick={() => setEditing(s)}><Pencil className="size-4" /></IconButton>
                <IconButton label={`Quitar ${s.name}`} onClick={() => setDeleting(s)}><Trash2 className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <SponsorForm sponsor={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Quitar patrocinador" confirmLabel="Quitar"
        message={`Se quita ${deleting?.name} de la web. El logo queda en la biblioteca de medios.`}
        onConfirm={async () => { await api.delete(`/cms/sponsors/${deleting!.id}`); toast("Patrocinador quitado"); void qc.invalidateQueries({ queryKey: sponsorsKey }); }} />
    </>
  );
}

// ─────────────────────────── Calendario ───────────────────────────
interface EventItem { id: number; title: string; kind: (typeof EVENT_KINDS)[number]; startsOn: string; endsOn: string | null; startTime: string | null; location: string | null; description: string | null; public: boolean; version: number }
const eventsKey = ["cms", "events"] as const;

function EventForm({ ev, onClose }: { ev: EventItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    title: ev?.title ?? "", kind: ev?.kind ?? ("cancha_abierta" as EventItem["kind"]), startsOn: ev?.startsOn ?? "", endsOn: ev?.endsOn ?? "",
    startTime: ev?.startTime ?? "", location: ev?.location ?? "", description: ev?.description ?? "", public: ev?.public ?? true,
  });
  const save = useMutation({
    mutationFn: () => (ev ? api.put(`/cms/events/${ev.id}`, { ...f, version: ev.version }) : api.post("/cms/events", f)),
    onSuccess: () => { toast(ev ? "Evento actualizado" : "Evento agregado al calendario"); void qc.invalidateQueries({ queryKey: eventsKey }); onClose(); },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  return (
    <Modal open onClose={onClose} title={ev ? "Editar evento" : "Nuevo evento"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="event-form" loading={save.isPending} disabled={!f.title.trim() || !f.startsOn}>Guardar</Button></>}>
      <form id="event-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4" noValidate>
        <FormError message={errText(save.error)} />
        <TextField label="Título" required value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} error={fields.title} />
        <SelectField label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as EventItem["kind"] })}>
          {EVENT_KINDS.map((k) => <option key={k} value={k}>{EVENT_KIND_LABEL[k]}</option>)}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Fecha" type="date" required value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} error={fields.startsOn} />
          <TextField label="Hasta (opcional)" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} error={fields.endsOn} />
          <TextField label="Hora (opcional)" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} error={fields.startTime} />
        </div>
        <TextField label="Lugar (opcional)" value={f.location} maxLength={120} onChange={(e) => setF({ ...f, location: e.target.value })} />
        <TextAreaField label="Detalle (opcional)" rows={2} value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Checkbox label="Mostrar en la web" checked={f.public} onChange={(v) => setF({ ...f, public: v })} />
      </form>
    </Modal>
  );
}

export function EventsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const q = useQuery({ queryKey: eventsKey, queryFn: async () => (await api.get<{ items: EventItem[] }>(`/cms/events?desde=${today}`)).items });
  const [editing, setEditing] = useState<EventItem | null | "new">(null);
  const [deleting, setDeleting] = useState<EventItem | null>(null);
  return (
    <>
      <PageHeader title="Calendario" description="Canchas abiertas, cenas, cierres de inscripción y otros eventos. Los torneos publicados aparecen solos."
        actions={<div className="flex items-center gap-3">{back}<Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo evento</Button></div>} />
      <Card>
        {q.isPending ? <Spinner /> : q.isError ? <ErrorState message={q.error.message} /> : q.data.length === 0 ? (
          <EmptyState icon={<CalendarDays className="size-6" />} title="No hay eventos próximos" description="Las canchas abiertas que cargues acá aparecen en el calendario y en la página Cancha abierta." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {q.data.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="w-16 shrink-0 text-center font-display text-navy"><b className="block text-xl">{e.startsOn.slice(8, 10)}</b><span className="text-xs uppercase">{new Date(`${e.startsOn}T12:00:00`).toLocaleString("es-AR", { month: "short" })}</span></div>
                <div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-900">{e.title}</p><p className="truncate text-xs text-slate-500">{EVENT_KIND_LABEL[e.kind]}{e.startTime ? ` · ${e.startTime}` : ""}{e.location ? ` · ${e.location}` : ""}</p></div>
                {!e.public && <Badge tone="gray">Oculto</Badge>}
                <IconButton label={`Editar ${e.title}`} onClick={() => setEditing(e)}><Pencil className="size-4" /></IconButton>
                <IconButton label={`Quitar ${e.title}`} onClick={() => setDeleting(e)}><Trash2 className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <EventForm ev={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Quitar evento" confirmLabel="Quitar" message={`Se quita “${deleting?.title}” del calendario.`}
        onConfirm={async () => { await api.delete(`/cms/events/${deleting!.id}`); toast("Evento quitado"); void qc.invalidateQueries({ queryKey: eventsKey }); }} />
    </>
  );
}

// ─────────────────────────── Datos de la web ───────────────────────────
export function SiteDataPage() {
  return (
    <>
      <PageHeader title="Datos de la web" description="Contacto, inscripciones por WhatsApp, sede y aviso destacado." actions={back} />
      <div className="max-w-3xl"><SiteSettingsCard /></div>
    </>
  );
}
