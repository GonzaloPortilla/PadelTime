import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import type { ResultFile, Tournament } from "@shared/types";
import { api } from "@/lib/api";
import { keys } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { MediaPicker, UploadButton, useMedia } from "@/pages/web/media";

/**
 * Archivos de resultados de una categoría: para torneos históricos donde fixture, tablas o copas sólo
 * existen como imagen o PDF (web anterior). Se conservan como archivo, sin inventar datos estructurados.
 */
export function ResultFilesCard({ t }: { t: Tournament }) {
  const qc = useQueryClient();
  const toast = useToast();
  const media = useMedia();
  const [files, setFiles] = useState<ResultFile[]>(t.resultFiles);
  const [picker, setPicker] = useState<"imagen" | "documento" | null>(null);
  const dirty = JSON.stringify(files) !== JSON.stringify(t.resultFiles);
  const save = useMutation({
    mutationFn: () => api.put<{ item: Tournament }>(`/tournaments/${t.id}/files`, { files }),
    onSuccess: ({ item }) => {
      qc.setQueryData(keys.tournament(t.id), item);
      void qc.invalidateQueries({ queryKey: ["media"] });
      toast("Archivos de resultados guardados");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const add = (items: { id: string; title: string }[]) => setFiles((f) => [...f, ...items.filter((m) => !f.some((x) => x.mediaId === m.id)).map((m) => ({ mediaId: m.id, label: m.title.slice(0, 60) || "Resultados" }))]);
  const move = (i: number, d: -1 | 1) => setFiles((f) => { const n = [...f]; const j = i + d; if (j < 0 || j >= n.length) return f; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });

  return (
    <Card className="lg:col-span-3">
      <CardHeader title="Archivos de resultados" subtitle="Para torneos históricos: imágenes o PDF de fixtures, tablas o copas que sólo existen como archivo. Se muestran en la página del torneo; no cambian puntos ni resultados." />
      <div className="space-y-3 p-4 sm:p-5">
        {files.length === 0 && <p className="text-sm text-slate-500">Sin archivos.</p>}
        <ul className="space-y-2">
          {files.map((f, i) => {
            const m = media.data?.find((x) => x.id === f.mediaId);
            return (
              <li key={f.mediaId} className="flex items-center gap-3 rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
                <div className="size-12 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-slate-200">
                  {m?.kind === "imagen" ? <img src={m.url} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-slate-400"><FileText className="size-5" /></div>}
                </div>
                <input aria-label="Título del archivo" value={f.label} maxLength={60} onChange={(e) => setFiles((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  className="h-9 min-w-0 flex-1 rounded-lg border-0 text-sm ring-1 ring-inset ring-slate-300" />
                <button type="button" className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp className="size-4" /></button>
                <button type="button" className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30" disabled={i === files.length - 1} onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown className="size-4" /></button>
                <button type="button" className="rounded p-1 text-slate-500 hover:bg-white hover:text-red-600" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 className="size-4" /></button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          <UploadButton label="Subir imágenes o PDF" onUploaded={(items) => add(items)} />
          <Button size="sm" variant="secondary" icon={<ImageIcon className="size-4" />} onClick={() => setPicker("imagen")}>Elegir imagen de la biblioteca</Button>
          <Button size="sm" variant="secondary" icon={<FileText className="size-4" />} onClick={() => setPicker("documento")}>Elegir PDF de la biblioteca</Button>
          {dirty && <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Guardar archivos</Button>}
        </div>
      </div>
      <MediaPicker open={picker !== null} kind={picker ?? "imagen"} multiple onClose={() => setPicker(null)} onPick={(items) => add(items)} />
    </Card>
  );
}
