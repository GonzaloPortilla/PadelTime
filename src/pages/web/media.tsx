import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText, ImagePlus, Images, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { ACCEPT, fmtBytes, uploadFile, type MediaItem } from "@/lib/cms";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

export const mediaKey = ["media"] as const;

export function useMedia() {
  return useQuery({ queryKey: mediaKey, queryFn: async () => (await api.get<{ items: MediaItem[] }>("/media")).items, staleTime: 15_000 });
}

/** Botón para subir archivos (varios a la vez). Devuelve los archivos subidos o ya existentes. */
export function UploadButton({ onUploaded, label = "Subir archivos", accept = ACCEPT, multiple = true }: { onUploaded?: (items: MediaItem[]) => void; label?: string; accept?: string; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const done: MediaItem[] = [];
    let dups = 0;
    for (const [i, f] of [...files].entries()) {
      setBusy(`Subiendo ${i + 1} de ${files.length}…`);
      try {
        const r = await uploadFile(f);
        done.push(r.item);
        if (r.duplicate) dups++;
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo subir el archivo");
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    void qc.invalidateQueries({ queryKey: mediaKey });
    if (done.length) toast(dups ? `${done.length} archivo(s) listos (${dups} ya estaban en la biblioteca)` : `${done.length} archivo(s) subidos`);
    onUploaded?.(done);
  };
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept={accept} multiple={multiple} className="sr-only" aria-label={label} onChange={(e) => void run(e.target.files)} />
      <Button icon={<Upload className="size-4" />} loading={!!busy} onClick={() => input.current?.click()}>{busy ?? label}</Button>
      <FormError message={error} />
    </div>
  );
}

function Thumb({ m, className }: { m: MediaItem; className?: string }) {
  return m.kind === "imagen"
    ? <img src={m.url} alt={m.alt ?? ""} loading="lazy" className={cn("size-full object-cover", className)} />
    : <div className={cn("flex size-full flex-col items-center justify-center gap-1 bg-slate-50 text-slate-500", className)}><FileText className="size-8" /><span className="text-xs font-semibold">PDF</span></div>;
}

/** Selector de archivos de la biblioteca (con subida en el momento). */
export function MediaPicker({ open, onClose, kind, multiple = false, onPick }: { open: boolean; onClose: () => void; kind: "imagen" | "documento"; multiple?: boolean; onPick: (items: MediaItem[]) => void }) {
  const media = useMedia();
  const [selected, setSelected] = useState<string[]>([]);
  const list = (media.data ?? []).filter((m) => m.kind === kind);
  const toggle = (id: string) => setSelected((s) => (multiple ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  const confirm = (ids = selected) => {
    onPick(ids.map((id) => list.find((m) => m.id === id)).filter((m): m is MediaItem => !!m));
    setSelected([]);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title={kind === "imagen" ? (multiple ? "Elegir imágenes" : "Elegir imagen") : "Elegir documento"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!selected.length} onClick={() => confirm()}>Usar {multiple && selected.length > 1 ? `${selected.length} archivos` : "selección"}</Button></>}>
      <div className="space-y-4">
        <UploadButton label={kind === "imagen" ? "Subir imagen" : "Subir PDF"} accept={kind === "imagen" ? ".jpg,.jpeg,.png,.webp,image/*" : ".pdf,application/pdf"}
          multiple={multiple} onUploaded={(items) => { const ids = items.filter((i) => i.kind === kind).map((i) => i.id); if (ids.length) (multiple ? setSelected((s) => [...new Set([...s, ...ids])]) : confirm(ids.slice(0, 1))); }} />
        {media.isPending ? <Spinner /> : list.length === 0 ? <p className="text-sm text-slate-500">La biblioteca está vacía: subí el primer archivo.</p> : (
          <ul className="grid max-h-[52vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" aria-label="Biblioteca">
            {list.map((m) => {
              const on = selected.includes(m.id);
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => toggle(m.id)} onDoubleClick={() => !multiple && confirm([m.id])} aria-pressed={on} title={m.title}
                    className={cn("relative block aspect-square w-full overflow-hidden rounded-lg ring-2 ring-offset-1 transition", on ? "ring-brand-600" : "ring-transparent hover:ring-slate-300")}>
                    <Thumb m={m} />
                    {on && <span className="absolute right-1 top-1 rounded-full bg-brand-700 p-0.5 text-white"><Check className="size-3.5" /></span>}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[11px] text-white">{m.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/** Vista compacta de un archivo elegido, con botones para cambiarlo o quitarlo. */
export function MediaField({ label, kind, value, onChange, hint, allowEmpty = true }: { label: string; kind: "imagen" | "documento"; value: string | null | undefined; onChange: (id: string | null) => void; hint?: string; allowEmpty?: boolean }) {
  const media = useMedia();
  const [open, setOpen] = useState(false);
  const item = value ? media.data?.find((m) => m.id === value) : undefined;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
      <div className="flex items-center gap-3">
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">{item ? <Thumb m={item} /> : <div className="flex size-full items-center justify-center text-slate-400"><Images className="size-6" /></div>}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-slate-700">{item ? item.title : value ? "Archivo no encontrado" : "Sin archivo"}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<ImagePlus className="size-4" />} onClick={() => setOpen(true)}>{value ? "Cambiar" : "Elegir"}</Button>
            {value && allowEmpty && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Quitar</Button>}
          </div>
        </div>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <MediaPicker open={open} onClose={() => setOpen(false)} kind={kind} onPick={(items) => onChange(items[0]?.id ?? null)} />
    </div>
  );
}

function MediaCard({ m, canDelete, onDelete }: { m: MediaItem; canDelete: boolean; onDelete: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(m.title);
  const [alt, setAlt] = useState(m.alt ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/media/${m.id}`, { title, alt }),
    onSuccess: () => { toast("Datos del archivo guardados"); void qc.invalidateQueries({ queryKey: mediaKey }); },
  });
  const dirty = title !== m.title || alt !== (m.alt ?? "");
  const used = m.usedIn ?? [];
  return (
    <Card className="flex flex-col">
      <a href={m.url} target="_blank" rel="noopener" className="block aspect-[4/3] overflow-hidden bg-slate-100"><Thumb m={m} /></a>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <TextField label="Título" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        {m.kind === "imagen" && <TextField label="Texto alternativo" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} hint="Describe la imagen para lectores de pantalla y buscadores." />}
        <p className="text-xs text-slate-500">{m.kind === "imagen" && m.width ? `${m.width}×${m.height} · ` : ""}{fmtBytes(m.bytes)} · {m.createdByName ?? "—"}</p>
        {used.length ? <div className="flex flex-wrap gap-1">{used.map((u) => <Badge key={u} tone="blue">{u}</Badge>)}</div> : <Badge tone="gray">Sin usar</Badge>}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={!dirty || !title.trim()} loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button>
          {canDelete && <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} disabled={used.length > 0} onClick={onDelete} title={used.length ? "Está en uso: quitalo de esos contenidos primero" : undefined}>Borrar</Button>}
        </div>
        <FormError message={save.error?.message ?? null} />
      </div>
    </Card>
  );
}

export function MediaLibraryPage() {
  const media = useMedia();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"todos" | "imagen" | "documento">("todos");
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const isAdmin = user?.role === "admin";
  const list = (media.data ?? []).filter((m) => filter === "todos" || m.kind === filter);
  return (
    <>
      <PageHeader title="Multimedia" description="Fotos, logos y documentos PDF de la web. Las imágenes se optimizan al subirlas y no se guardan dos veces." actions={<UploadButton />} />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Tipo de archivo">
        {(["todos", "imagen", "documento"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset", filter === k ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-600 ring-slate-200")}>
            {k === "todos" ? "Todos" : k === "imagen" ? "Imágenes" : "Documentos"}
          </button>
        ))}
      </div>
      {media.isPending ? <Spinner /> : media.isError ? <ErrorState message={media.error.message} onRetry={() => void media.refetch()} /> : list.length === 0 ? (
        <Card><EmptyState icon={<Images className="size-6" />} title="Todavía no hay archivos" description="Subí fotos (JPG, PNG o WebP) o reglamentos en PDF para usarlos en las páginas, novedades y patrocinadores." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{list.map((m) => <MediaCard key={m.id} m={m} canDelete={isAdmin} onDelete={() => setDeleting(m)} />)}</div>
      )}
      <p className="mt-4 text-xs text-slate-500">Formatos: JPG, PNG o WebP (hasta 5 MB después de optimizar) y PDF (hasta 10 MB). Sólo un administrador puede borrar archivos, y sólo si no se usan en ningún contenido.</p>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Borrar archivo" confirmLabel="Borrar definitivamente"
        message={`Se borrará "${deleting?.title}". Esta acción no se puede deshacer.`}
        onConfirm={async () => { await api.delete(`/media/${deleting!.id}`); toast("Archivo borrado"); void qc.invalidateQueries({ queryKey: mediaKey }); }} />
    </>
  );
}
