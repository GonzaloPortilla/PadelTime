import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import type { SiteRedirect } from "@shared/types";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Checkbox, FormError, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";

const KEY = ["redirects"];

/**
 * Redirecciones 301 desde las direcciones de la web anterior (Google Sites) hacia la web nueva.
 * Al cargar un torneo histórico conviene apuntar su dirección vieja a la página nueva del torneo.
 */
export function RedirectsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const q = useQuery({ queryKey: KEY, queryFn: async () => (await api.get<{ items: SiteRedirect[] }>("/redirects")).items });
  const [editing, setEditing] = useState<SiteRedirect | "new" | null>(null);
  const [deleting, setDeleting] = useState<SiteRedirect | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Redirecciones" description="Las direcciones de la web anterior (www.padeltime.com.ar en Google Sites) llevan a su equivalente en la web nueva, para no perder visitas ni posicionamiento al cambiar el dominio."
        actions={isAdmin ? <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nueva redirección</Button> : undefined} />
      {!isAdmin && <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600">Sólo un administrador puede modificarlas.</p>}
      <Card>
        {q.isPending ? <Spinner /> : q.isError ? <ErrorState message={q.error.message} /> : (
          <ul className="divide-y divide-slate-100">
            {q.data.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5">{r.fromPath}{r.prefix ? "/…" : ""}</code>
                    <ArrowRight className="size-4 text-slate-400" />
                    <code className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-800">{r.toPath}</code>
                    {r.prefix && <Badge tone="gray">incluye subpáginas</Badge>}
                  </p>
                  {r.note && <p className="mt-0.5 text-xs text-slate-500">{r.note}</p>}
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(r)} aria-label={`Editar ${r.fromPath}`} />
                    <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(r)} aria-label={`Eliminar ${r.fromPath}`} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <RedirectForm item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Eliminar redirección" message={`${deleting?.fromPath ?? ""} dejará de redirigir (mostrará "página no encontrada").`}
        confirmLabel="Eliminar" onConfirm={async () => { await api.delete(`/redirects/${deleting!.id}`); void qc.invalidateQueries({ queryKey: KEY }); toast("Redirección eliminada"); }} />
    </>
  );
}

function RedirectForm({ item, onClose }: { item: SiteRedirect | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ fromPath: item?.fromPath ?? "", toPath: item?.toPath ?? "", prefix: item?.prefix ?? true, note: item?.note ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => (item ? api.put(`/redirects/${item.id}`, v) : api.post("/redirects", v)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }); toast("Redirección guardada"); onClose(); },
    onError: (e) => { if (e instanceof ApiError) { setErrors(e.fields); setFormError(e.message); } },
  });
  return (
    <Modal open onClose={onClose} title={item ? "Editar redirección" : "Nueva redirección"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <div className="space-y-4">
        <FormError message={formError} />
        <TextField label="Dirección anterior" required placeholder="/qatar-major-2000" value={v.fromPath} onChange={(e) => setV({ ...v, fromPath: e.target.value })} error={errors.fromPath}
          hint="Lo que viene después de padeltime.com.ar en la web anterior." />
        <TextField label="Dirección nueva" required placeholder="/torneos/qatar-major-2000-12" value={v.toPath} onChange={(e) => setV({ ...v, toPath: e.target.value })} error={errors.toPath}
          hint="Copiala de la barra del navegador en la web nueva (desde la primera /)." />
        <Checkbox label="Incluir subpáginas" checked={v.prefix} onChange={(c) => setV({ ...v, prefix: c })} hint="Por ejemplo /qatar-major-2000/c5/fixture también lleva a la dirección nueva." />
        <TextField label="Nota" value={v.note} maxLength={200} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </div>
    </Modal>
  );
}
