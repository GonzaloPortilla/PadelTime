/**
 * Vista previa del CMS: dibuja una página o novedad con su BORRADOR usando las mismas vistas que la web
 * pública. Sólo se llega desde la API (con sesión); la página se marca "Vista previa" y noindex.
 */
import { postContentSchema, type PageContent, type PostContent } from "@shared/site";
import { loadPublicSettings } from "../lib/settings";
import type { SitePage } from "./site-data";
import { calendarView, contactView, contentView, homeView, makeCtx, newsListView, newsView, rankingsIndexView, tournamentsView } from "./views";

export async function renderPreview(env: Env, origin: string, entity: "pagina" | "novedad", row: Record<string, unknown>, content: unknown): Promise<string> {
  const db = env.DB;
  const settings = await loadPublicSettings(db);
  if (entity === "novedad") {
    const c = postContentSchema.parse(content) as PostContent;
    const slug = row.slug as string;
    const ctx = makeCtx(settings, new URL(`/novedades/${slug}`, origin), { preview: true });
    return newsView(db, ctx, { slug, title: c.title, excerpt: c.excerpt, blocks: c.blocks, coverMediaId: c.coverMediaId, tournamentId: c.tournamentId,
      publishedAt: (row.published_at as string) ?? new Date().toISOString() });
  }
  const c = content as PageContent;
  const slug = row.slug as string;
  const page: SitePage = { slug, title: c.title, summary: c.summary, blocks: c.blocks, seoTitle: c.seoTitle, seoDescription: c.seoDescription, updatedAt: "" };
  const path = slug === "inicio" ? "/" : `/${slug}`;
  // En la vista previa se muestra la página aunque esté oculta.
  const ctx = makeCtx({ ...settings, hiddenPages: settings.hiddenPages.filter((p) => p !== slug) }, new URL(path, origin), { preview: true });
  switch (row.system_key) {
    case "inicio": return homeView(db, ctx, settings, page);
    case "torneos": return tournamentsView(db, ctx, settings, page, new URLSearchParams());
    case "calendario": return calendarView(db, ctx, settings, page, "");
    case "rankings": return rankingsIndexView(db, ctx, settings, page);
    case "novedades": return newsListView(db, ctx, page);
    case "contacto": return contactView(db, ctx, page);
    default: return contentView(db, ctx, settings, page);
  }
}
