import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Eye, History, RotateCcw, Save, Send, Undo2 } from "lucide-react";
import { CONTENT_STATUS_LABEL, type ContentStatus } from "@shared/site";
import { ApiError, api } from "@/lib/api";
import { REVISION_LABEL, isConflict, type ContentDetail, type Revision } from "@/lib/cms";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";

const STATUS_TONE: Record<ContentStatus, "green" | "gray" | "amber"> = { publicada: "green", borrador: "amber", archivada: "gray" };
const fmt = (iso: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export function StatusBadges({ status, hasDraft }: { status: ContentStatus; hasDraft: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <Badge tone={STATUS_TONE[status]}>{CONTENT_STATUS_LABEL[status]}</Badge>
      {hasDraft && status !== "borrador" && <Badge tone="amber">Cambios sin publicar</Badge>}
    </span>
  );
}

/** Traduce errores de validación de bloques ("content.blocks.3.text") a un mensaje legible. */
function describeError(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : "No se pudo guardar";
  const fields = Object.entries(e.fields);
  if (!fields.length) return e.message;
  const msgs = fields.slice(0, 3).map(([k, v]) => {
    const m = /blocks\.(\d+)/.exec(k);
    return m ? `Bloque ${Number(m[1]) + 1}: ${v}` : `${k.replace(/^content\./, "")}: ${v}`;
  });
  return `${e.message}. ${msgs.join(" · ")}`;
}

interface Props<T> {
  /** "pages" o "posts" (rutas de la API). */
  resource: "pages" | "posts";
  detail: ContentDetail<T>;
  queryKey: readonly unknown[];
  /** Formulario del contenido (título, bloques…). */
  children: (content: T, setContent: (c: T) => void) => ReactNode;
  publicUrl: string | null;
}

export function ContentEditor<T>({ resource, detail, queryKey, children, publicUrl }: Props<T>) {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/cms/${resource}/${detail.id}`;
  const initial = useMemo(() => (detail.draft ?? detail.published) as T, [detail]);
  const [content, setContent] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => { setContent(initial); setConflict(false); }, [initial]);
  const dirty = JSON.stringify(content) !== JSON.stringify(initial);

  // Aviso al cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const onDone = (msg: string) => (r: { item: ContentDetail<T> }) => {
    qc.setQueryData(queryKey, r.item);
    void qc.invalidateQueries({ queryKey: ["cms"] });
    setError(null);
    toast(msg);
  };
  const onFail = (e: unknown) => {
    setError(describeError(e));
    if (isConflict(e)) setConflict(true);
  };

  const saveDraft = useMutation({
    mutationFn: () => api.put<{ item: ContentDetail<T> }>(`${base}/draft`, { version: detail.version, content }),
    onSuccess: onDone("Borrador guardado (todavía no se ve en la web)"), onError: onFail,
  });
  const publish = useMutation({
    mutationFn: () => api.post<{ item: ContentDetail<T> }>(`${base}/publish`, { version: detail.version, content }),
    onSuccess: onDone("Publicado: ya se ve en la web"), onError: onFail,
  });
  const status = useMutation({
    mutationFn: (path: "archive" | "unarchive" | "discard") => api.post<{ item: ContentDetail<T> }>(`${base}/${path}`, { version: detail.version }),
    onSuccess: (r, path) => onDone(path === "archive" ? "Ocultado: ya no se ve en la web" : path === "unarchive" ? "Visible otra vez en la web" : "Borrador descartado")(r),
    onError: onFail,
  });
  const restore = useMutation({
    mutationFn: (revisionId: number) => api.post<{ item: ContentDetail<T> }>(`${base}/restore`, { version: detail.version, revisionId }),
    onSuccess: (r) => { onDone("Versión recuperada como borrador. Revisala y publicala.")(r); setHistoryOpen(false); },
    onError: onFail,
  });

  /** Vista previa: guarda el borrador si hay cambios y abre la página con el diseño real de la web. */
  const preview = async () => {
    const win = window.open("about:blank", "_blank");
    try {
      if (dirty) onDone("Borrador guardado")(await api.put<{ item: ContentDetail<T> }>(`${base}/draft`, { version: detail.version, content }));
      if (win) win.location.href = `/api${base}/preview`;
    } catch (e) {
      win?.close();
      onFail(e);
    }
  };

  const busy = saveDraft.isPending || publish.isPending || status.isPending || restore.isPending;
  return (
    <div className="space-y-4">
      <Card className="sticky top-14 z-10 flex flex-wrap items-center gap-2 p-3 lg:top-2">
        <StatusBadges status={detail.status} hasDraft={detail.hasDraft} />
        <span className="text-xs text-slate-500">
          {dirty ? "Cambios sin guardar" : `Guardado ${fmt(detail.updatedAt)}${detail.updatedByName ? ` por ${detail.updatedByName}` : ""}`}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Save className="size-4" />} disabled={!dirty || busy || conflict} loading={saveDraft.isPending} onClick={() => saveDraft.mutate()}>Guardar borrador</Button>
          <Button size="sm" variant="secondary" icon={<Eye className="size-4" />} disabled={busy || conflict} onClick={() => void preview()}>Vista previa</Button>
          <Button size="sm" icon={<Send className="size-4" />} disabled={busy || conflict || (!dirty && !detail.hasDraft && detail.status === "publicada")} loading={publish.isPending} onClick={() => publish.mutate()}>Publicar</Button>
        </div>
      </Card>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <span className="flex-1">{error}</span>
          {conflict && <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => { void qc.invalidateQueries({ queryKey }); setError(null); }}>Recargar la versión actual</Button>}
        </div>
      )}

      {children(content, setContent)}

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setHistoryOpen(true)}>Historial de cambios</Button>
        {detail.hasDraft && <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} disabled={busy} onClick={() => setConfirmDiscard(true)}>Descartar borrador</Button>}
        {publicUrl && detail.status === "publicada" && <a href={publicUrl} target="_blank" rel="noopener" className="text-sm font-medium text-brand-700 hover:underline">Ver en la web ↗</a>}
        <div className="ml-auto">
          {detail.status === "archivada"
            ? <Button size="sm" variant="secondary" icon={<ArchiveRestore className="size-4" />} disabled={busy} onClick={() => status.mutate("unarchive")}>Mostrar en la web</Button>
            : detail.archivable && detail.status === "publicada" && <Button size="sm" variant="ghost" icon={<Archive className="size-4" />} disabled={busy} onClick={() => status.mutate("archive")}>Ocultar de la web</Button>}
        </div>
      </Card>

      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} base={base} onRestore={(id) => restore.mutate(id)} restoring={restore.isPending} />
      <ConfirmDialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Descartar borrador" confirmLabel="Descartar"
        message="Se descartan los cambios guardados sin publicar. La versión publicada no cambia (queda en el historial)."
        onConfirm={async () => { status.mutate("discard"); }} />
    </div>
  );
}

function HistoryModal({ open, onClose, base, onRestore, restoring }: { open: boolean; onClose: () => void; base: string; onRestore: (id: number) => void; restoring: boolean }) {
  const q = useQuery({ queryKey: ["cms", "revisions", base], queryFn: async () => (await api.get<{ items: Revision[] }>(`${base}/revisions`)).items, enabled: open });
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Historial de cambios" description="Cada guardado y publicación queda registrado con su autor. Recuperar una versión la deja como borrador para revisarla antes de publicar.">
      {q.isPending ? <p className="text-sm text-slate-500">Cargando…</p> : (
        <ul className="divide-y divide-slate-100">
          {(q.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{REVISION_LABEL[r.action] ?? r.action}</p>
                <p className="text-xs text-slate-500">{fmt(r.createdAt)} · {r.byName ?? "—"} · versión {r.version}</p>
              </div>
              <Button size="sm" variant="secondary" disabled={restoring} onClick={() => onRestore(r.id)}>Recuperar</Button>
            </li>
          ))}
          {q.data?.length === 0 && <li className="py-3 text-sm text-slate-500">Todavía no hay cambios registrados.</li>}
        </ul>
      )}
    </Modal>
  );
}
