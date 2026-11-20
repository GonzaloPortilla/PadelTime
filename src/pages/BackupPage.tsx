import { useState } from "react";
import { DatabaseBackup, Download, ShieldAlert } from "lucide-react";
import { dumpHeader, dumpPage, type BackupPage as BackupPageData, type BackupTable } from "@shared/backup";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { strToU8, zipSync } from "fflate";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";
import { Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";

interface StartResponse { tables: { table: BackupTable; count: number }[]; pageSize: number; generatedAt: string }

/** Arma el respaldo SQL completo pidiendo cada tabla por páginas. */
export async function buildBackup(onProgress: (done: number, total: number) => void): Promise<{ sql: string; rows: number; generatedAt: string }> {
  const start = await api.post<StartResponse>("/backup/start");
  const total = start.tables.reduce((s, t) => s + t.count, 0);
  const counts = Object.fromEntries(start.tables.map((t) => [t.table, t.count]));
  const parts = [dumpHeader({ generatedAt: start.generatedAt, counts })];
  let done = 0;
  for (const { table } of start.tables) {
    let after = 0;
    for (;;) {
      const page = await api.get<BackupPageData>(`/backup/${table}?after=${after}`);
      parts.push(dumpPage(page));
      done += page.rows.length;
      onProgress(done, total);
      if (page.next === null) break;
      after = page.next;
    }
  }
  return { sql: parts.join(""), rows: done, generatedAt: start.generatedAt };
}

export function BackupPage() {
  const toast = useToast();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const { sql, rows, generatedAt } = await buildBackup((done, total) => setProgress({ done, total }));
      const stamp = generatedAt.slice(0, 16).replace("T", "_").replace(":", "-");
      downloadFile(sql, `padel-time-respaldo-${stamp}.sql`, "application/sql");
      setLast(`${rows.toLocaleString("es-AR")} registros · ${new Date(generatedAt).toLocaleString("es-AR")}`);
      toast("Respaldo descargado");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el respaldo");
    } finally {
      setProgress(null);
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Respaldo" description="Copia completa de la base de datos para guardar fuera de Cloudflare." />
      <Card>
        <CardHeader title="Descargar respaldo completo" subtitle="Jugadores, categorías, temporadas, torneos, puntuaciones, movimientos, importaciones y configuración." />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              El archivo es <strong>confidencial</strong>: incluye teléfonos, correos y documentos de los jugadores, y las contraseñas
              cifradas de los organizadores. Guardalo en un lugar privado (por ejemplo, una carpeta personal de Google Drive) y no lo compartas.
            </p>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Recomendado: una vez por semana y siempre antes de importar rankings o cerrar una temporada.</li>
            <li>Descargar el respaldo no modifica ningún dato.</li>
            <li>Cloudflare además guarda automáticamente los últimos 7 días de la base (Time Travel). El procedimiento de recuperación está en <code>docs/RESPALDO.md</code>.</li>
          </ul>
          {error && <FormError message={error} />}
          {progress && (
            <div aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">Preparando… {progress.done.toLocaleString("es-AR")} de {progress.total.toLocaleString("es-AR")} registros</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={progress ? <DatabaseBackup className="size-4" /> : <Download className="size-4" />} onClick={run} disabled={progress !== null}>
              {progress ? "Generando…" : "Descargar respaldo (.sql)"}
            </Button>
            {last && <span className="text-sm text-slate-500">Último: {last}</span>}
          </div>
        </div>
      </Card>
      <MediaBackupCard />
    </div>
  );
}

/**
 * Los archivos de la web (fotos, logos, PDF) viven en Workers KV, fuera de la base: se descargan aparte,
 * en un .zip con un índice (manifest.json) para restaurarlos con `node scripts/restore-media.mjs`.
 */
function MediaBackupCard() {
  const toast = useToast();
  const [state, setState] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    try {
      const { items } = await api.get<{ items: { id: string; filename: string; mime: string; url: string }[] }>("/media");
      setState({ done: 0, total: items.length });
      const files: Record<string, Uint8Array> = {};
      for (const [i, m] of items.entries()) {
        const res = await fetch(m.url);
        if (!res.ok) throw new Error(`No se pudo descargar ${m.filename}`);
        files[`archivos/${m.id}/${m.filename}`] = new Uint8Array(await res.arrayBuffer());
        setState({ done: i + 1, total: items.length });
      }
      files["manifest.json"] = strToU8(JSON.stringify(items.map((m) => ({ id: m.id, filename: m.filename, mime: m.mime })), null, 2));
      const zip = zipSync(files, { level: 0 });
      downloadFile(zip, `padel-time-multimedia-${new Date().toISOString().slice(0, 10)}.zip`, "application/zip");
      toast(`Multimedia descargada (${items.length} archivo${items.length === 1 ? "" : "s"})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el archivo");
    } finally {
      setState(null);
    }
  };
  return (
    <Card className="mt-4">
      <CardHeader title="Descargar archivos multimedia" subtitle="Fotos, logos y PDF de la web (se guardan fuera de la base de datos)." />
      <div className="space-y-3 p-4 sm:p-5">
        <p className="text-sm text-slate-600">Junto con el respaldo .sql, guardá también este .zip. Se restaura con <code>node scripts/restore-media.mjs</code> (ver <code>docs/RESPALDO.md</code>).</p>
        {error && <FormError message={error} />}
        <Button variant="secondary" icon={<Download className="size-4" />} loading={state !== null} onClick={() => void run()}>
          {state ? `Descargando ${state.done} de ${state.total}…` : "Descargar multimedia (.zip)"}
        </Button>
      </div>
    </Card>
  );
}
