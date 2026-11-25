import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, FileText, Globe, Handshake, Images, Megaphone, Newspaper, Plus, Settings2, Trash2, Shuffle } from "lucide-react";
import type { ContentStatus, PageContent, PostContent } from "@shared/site";
import { api } from "@/lib/api";
import type { PageDetail, PostDetail } from "@/lib/cms";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Checkbox, TextAreaField, TextField } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { useState } from "react";
import { BlockEditor } from "./BlockEditor";
import { ContentEditor, StatusBadges } from "./ContentEditor";
import { MediaField } from "./media";

interface PageRow { id: number; slug: string; systemKey: string | null; title: string; status: ContentStatus; hasDraft: boolean; updatedAt: string; updatedByName: string | null }
interface PostRow { id: number; slug: string; title: string; status: ContentStatus; hasDraft: boolean; pinned: boolean; publishedAt: string | null; updatedAt: string; updatedByName: string | null }

const PAGE_HELP: Record<string, string> = {
  inicio: "Banner principal, botones, secciones informativas y el orden de las secciones automáticas.",
  liga: "Cómo funciona el circuito.",
  "cancha-abierta": "Jornadas de evaluación. Las fechas se cargan en Calendario.",
  premios: "Texto general. Los premios de cada torneo se cargan en la ficha del torneo.",
  reglamentos: "Reglamento vigente y documentos PDF descargables.",
  contacto: "Texto opcional. Teléfono, sede y redes se editan en Datos de la web.",
  torneos: "Título e introducción de la sección. Los torneos se publican desde su ficha.",
  rankings: "Título e introducción. Los rankings se calculan solos.",
  calendario: "Título e introducción. Los eventos se cargan en Calendario.",
  novedades: "Título e introducción del listado de novedades.",
};

const fmt = (iso: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export function WebHomePage() {
  const pages = useQuery({ queryKey: ["cms", "pages"], queryFn: async () => (await api.get<{ items: PageRow[] }>("/cms/pages")).items });
  const tools = [
    { to: "/web/novedades", icon: Newspaper, title: "Novedades", text: "Noticias, anuncios y flyers." },
    { to: "/web/multimedia", icon: Images, title: "Multimedia", text: "Fotos, logos y documentos PDF." },
    { to: "/web/patrocinadores", icon: Handshake, title: "Patrocinadores", text: "Logos y enlaces de quienes acompañan." },
    { to: "/web/calendario", icon: CalendarDays, title: "Calendario", text: "Canchas abiertas y otros eventos." },
    { to: "/web/datos", icon: Settings2, title: "Datos de la web", text: "WhatsApp, Instagram, sede y aviso destacado." },
    { to: "/web/redirecciones", icon: Shuffle, title: "Redirecciones", text: "Direcciones de la web anterior → web nueva." },
  ];
  return (
    <>
      <PageHeader title="Contenidos de la web" description="Todo lo que se ve en la web pública, sin programar. Los torneos, resultados y rankings se siguen cargando en sus secciones."
        actions={<a href="/" target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"><Globe className="size-4" /> Ver la web</a>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <Link key={t.to} to={t.to} className="group rounded-xl bg-white p-4 ring-1 ring-slate-200 transition hover:ring-brand-400">
            <t.icon className="size-5 text-brand-700" />
            <p className="mt-2 font-semibold text-slate-900">{t.title}</p>
            <p className="text-xs text-slate-500">{t.text}</p>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader title="Páginas" subtitle="Elegí una página para editarla." />
        {pages.isPending ? <Spinner /> : pages.isError ? <ErrorState message={pages.error.message} onRetry={() => void pages.refetch()} /> : (
          <ul className="divide-y divide-slate-100">
            {pages.data.map((p) => (
              <li key={p.id}>
                <Link to={`/web/paginas/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <FileText className="size-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{p.title} <span className="text-xs font-normal text-slate-400">/{p.slug === "inicio" ? "" : p.slug}</span></p>
                    <p className="truncate text-xs text-slate-500">{PAGE_HELP[p.systemKey ?? ""] ?? ""}</p>
                  </div>
                  <div className="hidden text-right sm:block"><StatusBadges status={p.status} hasDraft={p.hasDraft} /><p className="mt-0.5 text-xs text-slate-400">{fmt(p.updatedAt)}{p.updatedByName ? ` · ${p.updatedByName}` : ""}</p></div>
                  <ChevronRight className="size-4 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function PageEditorPage() {
  const { id } = useParams();
  const key = ["cms", "page", id] as const;
  const q = useQuery({ queryKey: key, queryFn: async () => (await api.get<{ item: PageDetail }>(`/cms/pages/${id}`)).item });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const isHome = d.systemKey === "inicio";
  return (
    <>
      <PageHeader title={`Editar: ${(d.draft ?? d.published)?.title ?? d.slug}`} description={PAGE_HELP[d.systemKey ?? ""]} actions={<Link to="/web" className="text-sm font-medium text-brand-700 hover:underline">← Contenidos</Link>} />
      <ContentEditor<PageContent> resource="pages" detail={d} queryKey={key} publicUrl={isHome ? "/" : `/${d.slug}`}>
        {(c, set) => (
          <div className="space-y-4">
            <Card className="space-y-4 p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={isHome ? "Título interno" : "Título de la página"} value={c.title} maxLength={120} onChange={(e) => set({ ...c, title: e.target.value })} required />
                <TextField label="Descripción breve" value={c.summary ?? ""} maxLength={400} onChange={(e) => set({ ...c, summary: e.target.value })} hint={isHome ? "Se usa como descripción en buscadores." : "Aparece debajo del título."} />
              </div>
              <details className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">Buscadores (opcional)</summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <TextField label="Título para buscadores" value={c.seoTitle ?? ""} maxLength={120} onChange={(e) => set({ ...c, seoTitle: e.target.value })} />
                  <TextAreaField label="Descripción para buscadores" rows={2} value={c.seoDescription ?? ""} maxLength={300} onChange={(e) => set({ ...c, seoDescription: e.target.value })} />
                </div>
              </details>
            </Card>
            <Card className="p-4 sm:p-5">
              <h2 className="mb-1 font-display text-lg font-semibold uppercase tracking-wide text-navy">Bloques</h2>
              <p className="mb-4 text-sm text-slate-500">{isHome ? "El orden de los bloques es el orden en la portada. Ocultá los que no quieras mostrar sin borrarlos." : "Contenido de la página, en orden."}</p>
              <BlockEditor blocks={c.blocks} allowHome={isHome} onChange={(blocks) => set({ ...c, blocks })} />
            </Card>
          </div>
        )}
      </ContentEditor>
    </>
  );
}

// ─────────────────────────── Novedades ───────────────────────────
export function PostsPage() {
  const q = useQuery({ queryKey: ["cms", "posts"], queryFn: async () => (await api.get<{ items: PostRow[] }>("/cms/posts")).items });
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.post<{ item: PostDetail }>("/cms/posts", { content: { title: "Nueva novedad", excerpt: null, coverMediaId: null, pinned: false, tournamentId: null, blocks: [{ type: "paragraph", text: "Escribí la novedad acá." }] } }),
    onSuccess: (r) => navigate(`/web/novedades/${r.item.id}`),
  });
  return (
    <>
      <PageHeader title="Novedades" description="Noticias y anuncios. Se crean como borrador y se ven en la web al publicarlas."
        actions={<Button icon={<Plus className="size-4" />} loading={create.isPending} onClick={() => create.mutate()}>Nueva novedad</Button>} />
      <Card>
        {q.isPending ? <Spinner /> : q.isError ? <ErrorState message={q.error.message} /> : q.data.length === 0 ? (
          <EmptyState icon={<Megaphone className="size-6" />} title="Todavía no hay novedades" description="Publicá la primera: un torneo nuevo, la apertura de inscripciones o el flyer de un americano." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {q.data.map((p) => (
              <li key={p.id}>
                <Link to={`/web/novedades/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:px-5">
                  <Newspaper className="size-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{p.pinned ? "📌 " : ""}{p.title}</p>
                    <p className="text-xs text-slate-500">{p.publishedAt ? `Publicada ${fmt(p.publishedAt)}` : "Sin publicar"} · editada {fmt(p.updatedAt)}{p.updatedByName ? ` por ${p.updatedByName}` : ""}</p>
                  </div>
                  <StatusBadges status={p.status} hasDraft={p.hasDraft} />
                  <ChevronRight className="size-4 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function PostEditorPage() {
  const { id } = useParams();
  const key = ["cms", "post", id] as const;
  const q = useQuery({ queryKey: key, queryFn: async () => (await api.get<{ item: PostDetail }>(`/cms/posts/${id}`)).item });
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <>
      <PageHeader title="Editar novedad" actions={<Link to="/web/novedades" className="text-sm font-medium text-brand-700 hover:underline">← Novedades</Link>} />
      <ContentEditor<PostContent> resource="posts" detail={d} queryKey={key} publicUrl={`/novedades/${d.slug}`}>
        {(c, set) => (
          <div className="space-y-4">
            <Card className="space-y-4 p-4 sm:p-5">
              <TextField label="Título" value={c.title} maxLength={160} onChange={(e) => set({ ...c, title: e.target.value })} required />
              <TextAreaField label="Resumen" rows={2} value={c.excerpt ?? ""} maxLength={400} onChange={(e) => set({ ...c, excerpt: e.target.value })} hint="Se muestra en el listado y al compartir el enlace." />
              <MediaField label="Imagen de portada (opcional)" kind="imagen" value={c.coverMediaId} onChange={(id) => set({ ...c, coverMediaId: id })} />
              <Checkbox label="Fijar arriba" hint="Se muestra primera en el inicio y en Novedades." checked={c.pinned} onChange={(v) => set({ ...c, pinned: v })} />
            </Card>
            <Card className="p-4 sm:p-5">
              <h2 className="mb-4 font-display text-lg font-semibold uppercase tracking-wide text-navy">Contenido</h2>
              <BlockEditor blocks={c.blocks} onChange={(blocks) => set({ ...c, blocks })} />
            </Card>
          </div>
        )}
      </ContentEditor>
      {user?.role === "admin" && (
        <div className="mt-4 text-right"><Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>Borrar novedad</Button></div>
      )}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title="Borrar novedad" confirmLabel="Borrar definitivamente"
        message="Se borra la novedad y su historial. Si sólo querés que no se vea, usá “Ocultar de la web”."
        onConfirm={async () => { await api.delete(`/cms/posts/${d.id}`); toast("Novedad borrada"); void qc.invalidateQueries({ queryKey: ["cms", "posts"] }); navigate("/web/novedades"); }} />
    </>
  );
}
