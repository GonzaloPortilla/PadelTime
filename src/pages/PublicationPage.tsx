import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Code2, Copy, ExternalLink, Globe, Link2, Search } from "lucide-react";
import { GENDER_LABEL } from "@shared/constants";
import type { PublicationLink, PublicationOverview, PublicationSettings } from "@shared/types";
import { api } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Checkbox, FilterSelect, FormError, TextField } from "@/components/ui/Field";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { SiteSettingsCard } from "./publication/SiteSettingsCard";

const pubKey = ["publication"] as const;

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Navegadores sin permiso de portapapeles: se selecciona el texto en un prompt.
      window.prompt("Copiá el texto:", text);
    }
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
  };
  return { copied, copy };
}

export const embedCode = (url: string, title: string, height = 900) =>
  `<iframe src="${url}" title="${title.replace(/"/g, "&quot;")}" width="100%" height="${height}" style="border:0" loading="lazy"></iframe>`;

function SettingsCard({ data }: { data: PublicationOverview }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<PublicationSettings>(data.settings);
  useEffect(() => setForm(data.settings), [data.settings]);
  const save = useMutation({
    mutationFn: () => api.put("/publication/settings", form),
    onSuccess: () => { toast("Publicación actualizada"); void qc.invalidateQueries({ queryKey: pubKey }); },
  });
  const readOnly = user?.role !== "admin";
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  return (
    <Card>
      <CardHeader title="Configuración" subtitle={readOnly ? "Sólo un administrador puede cambiarla." : "Los cambios se ven en la web de inmediato."} />
      <fieldset disabled={readOnly} className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
        <Checkbox label="Publicar rankings en la web" hint="Si se desactiva, las páginas públicas muestran “no disponible” (también dentro de Google Sites)." checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
        <Checkbox label="Buscador e historial de jugadores" hint="Permite consultar los puntos de cada jugador torneo por torneo. Nunca se muestran DNI, teléfono, email, notas ni motivos de ajustes." checked={form.showHistory} onChange={(v) => setForm({ ...form, showHistory: v })} />
        <TextField label="Título de las páginas" value={form.title} maxLength={80} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <div>
          <p className="text-sm font-medium text-slate-700">Temporadas visibles</p>
          <p className="text-xs text-slate-500">Las temporadas planificadas nunca se publican.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.seasons.filter((s) => s.status !== "planificada").map((s) => {
              const visible = !form.hiddenSeasonIds.includes(s.id);
              return (
                <label key={s.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset ring-slate-200">
                  <input type="checkbox" className="size-4 accent-brand-700" checked={visible}
                    onChange={(e) => setForm({ ...form, hiddenSeasonIds: e.target.checked ? form.hiddenSeasonIds.filter((id) => id !== s.id) : [...form.hiddenSeasonIds, s.id] })} />
                  {s.name}
                </label>
              );
            })}
          </div>
        </div>
        <FormError message={save.error?.message ?? null} />
        {!readOnly && <Button loading={save.isPending} disabled={!dirty || !form.title.trim()} onClick={() => save.mutate()}>Guardar</Button>}
      </fieldset>
    </Card>
  );
}

export function PublicationPage() {
  const q = useQuery({ queryKey: pubKey, queryFn: () => api.get<PublicationOverview>("/publication") });
  const { copied, copy } = useCopy();
  const origin = window.location.origin;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  const [seasonParam, setSeasonParam] = useState<string>("");

  const visibleSeasons = useMemo(() => (q.data?.seasons ?? []).filter((s) => s.status !== "planificada"), [q.data]);
  const active = visibleSeasons.find((s) => s.status === "activa");
  const selected = seasonParam || (active ? "actual" : visibleSeasons[0] ? String(visibleSeasons[0].id) : "");
  const seasonId = selected === "actual" ? active?.id : Number(selected);
  const links = (q.data?.links ?? []).filter((l) => l.seasonId === seasonId);

  const urlOf = (l: PublicationLink) => `${origin}/publico/ranking/${selected === "actual" ? "actual" : l.seasonId}/${l.categoryId}${l.divisionId ? `/${l.divisionId}` : ""}`;
  const nameOf = (l: PublicationLink) => `Ranking ${l.categoryName} ${GENDER_LABEL[l.gender]}${l.divisionName ? ` · División ${l.divisionName}` : ""}`;

  return (
    <>
      <PageHeader
        title="Publicación web"
        description="Páginas públicas de sólo lectura, una por ranking, para colocar una sola vez en Google Sites. Se actualizan solas cada vez que se acreditan o revierten puntos."
        actions={<a href="/" target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"><Globe className="size-4" /> Ver la web</a>}
      />
      {q.isPending ? <Spinner /> : q.isError ? <ErrorState message={q.error.message} onRetry={() => void q.refetch()} /> : (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            {isLocal && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
                Estás usando la app en una dirección local ({origin}). Google Sites no puede mostrarla: copiá los enlaces desde la dirección publicada en Cloudflare (por ejemplo, https://padel-time.TU-CUENTA.workers.dev).
              </p>
            )}
            {!q.data.settings.enabled && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">La publicación está desactivada: los enlaces muestran “no disponible”.</p>}
            <Card>
              <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Enlaces por ranking</h2>
                  <p className="text-xs text-slate-500">“Temporada vigente” genera un enlace que pasa solo a la próxima temporada cuando la actives.</p>
                </div>
                <FilterSelect aria-label="Temporada de los enlaces" value={selected} onChange={(e) => setSeasonParam(e.target.value)}>
                  {active && <option value="actual">Temporada vigente ({active.name})</option>}
                  {visibleSeasons.map((s) => <option key={s.id} value={s.id}>{s.name}{q.data.settings.hiddenSeasonIds.includes(s.id) ? " (oculta)" : ""}</option>)}
                </FilterSelect>
              </div>
              {links.length === 0 ? (
                <EmptyState icon={<Link2 className="size-6" />} title="Sin rankings con puntos" description="Cuando se acrediten torneos o se importen saldos en esta temporada, aparecerán sus enlaces." />
              ) : (
                <ul className="divide-y divide-slate-100" data-testid="publication-links">
                  {links.map((l) => {
                    const url = urlOf(l);
                    const id = `${l.categoryId}:${l.divisionId ?? 0}`;
                    return (
                      <li key={id} className="px-4 py-3 sm:px-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{nameOf(l)}</span>
                          <Badge>{l.players} jugadores</Badge>
                        </div>
                        <input readOnly value={`${url}?embed=1`} aria-label={`Enlace de ${nameOf(l)}`} onFocus={(e) => e.target.select()}
                          className="mt-2 h-9 w-full rounded-lg border-0 bg-slate-50 px-3 font-mono text-xs text-slate-700 ring-1 ring-inset ring-slate-200" />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="subtle" icon={copied === `u${id}` ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy(`u${id}`, `${url}?embed=1`)}>
                            {copied === `u${id}` ? "Copiado" : "Copiar enlace para Google Sites"}
                          </Button>
                          <Button size="sm" variant="ghost" icon={copied === `c${id}` ? <Check className="size-4" /> : <Code2 className="size-4" />} onClick={() => void copy(`c${id}`, embedCode(`${url}?embed=1`, nameOf(l)))}>
                            {copied === `c${id}` ? "Copiado" : "Copiar código HTML"}
                          </Button>
                          <a href={url} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"><ExternalLink className="size-4" /> Abrir</a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card className="p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-900">Otras páginas públicas</h2>
              <div className="mt-3 space-y-2">
                {[
                  { id: "idx", label: "Índice de rankings", path: "/publico", icon: <Globe className="size-4" /> },
                  ...(q.data.settings.showHistory ? [{ id: "src", label: "Buscador de jugadores", path: "/publico/jugadores", icon: <Search className="size-4" /> }] : []),
                ].map((p) => (
                  <div key={p.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:w-48">{p.icon}{p.label}</span>
                    <input readOnly value={`${origin}${p.path}`} aria-label={p.label} onFocus={(e) => e.target.select()} className="h-9 flex-1 rounded-lg border-0 bg-slate-50 px-3 font-mono text-xs ring-1 ring-inset ring-slate-200" />
                    <Button size="sm" variant="ghost" icon={copied === p.id ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy(p.id, `${origin}${p.path}?embed=1`)}>{copied === p.id ? "Copiado" : "Copiar"}</Button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="space-y-4">
            <SiteSettingsCard />
            <SettingsCard data={q.data} />
            <Card className="p-4 text-sm text-slate-600 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-900">Cómo agregarlo en Google Sites</h2>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4">
                <li>Copiá el enlace del ranking (botón “Copiar enlace para Google Sites”).</li>
                <li>En Google Sites, abrí la página del ranking (por ejemplo, Rankings 2026 → Caballeros → C6) y tocá <strong>Insertar → Incorporar</strong>.</li>
                <li>En la pestaña <strong>Por URL</strong> pegá el enlace y elegí <strong>Página completa</strong>. Si muestra sólo una vista previa, usá la pestaña <strong>Incorporar código</strong> con “Copiar código HTML”.</li>
                <li>Ajustá el alto del recuadro arrastrando el borde (Google Sites no lo ajusta solo) y tocá <strong>Publicar</strong>.</li>
              </ol>
              <p className="mt-2">Se hace una sola vez por ranking: después la página se actualiza sola. Alternativa sin incrustar: un botón o enlace a la página pública, o el Excel que se descarga desde cada ranking.</p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
