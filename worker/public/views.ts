/**
 * Vistas de la web pública: arman cada página a partir de su contenido (publicado o, en la vista previa
 * del CMS, el borrador). Las usan las rutas públicas (app.ts) y la vista previa (preview.ts), así el
 * organizador ve exactamente lo mismo que verá el público.
 */
import { APP_TIMEZONE } from "@shared/constants";
import { mediaIdsOf, SERIES, SERIES_SLUG, whatsappUrl, type Series } from "@shared/site";
import { todayIn } from "@shared/text";
import type { PublicSettings } from "../lib/settings";
import { h, type Raw } from "./html";
import { rankingRefs, resolveSeason, visibleSeasons } from "./data";
import { waButton, type PageCtx } from "./layout";
import { indexPage } from "./pages";
import {
  eventsBetween, finished, groupByEvent, inProgress, latestPosts, loadMedia, loadSponsors, publicTournaments, upcoming,
  type PublicPost, type SitePage,
} from "./site-data";
import {
  calendarPage, contactPage, contentPage, eventsList, homePage, newsListPage, newsPage, prizesList, sideLinks,
  TOURNAMENT_TABS, tournamentsPage, type RenderOpts, type TournamentTab,
} from "./site-pages";

export const RENDER_VERSION = "f9.2";

export function makeCtx(settings: PublicSettings, url: URL, opts: { embed?: boolean; preview?: boolean } = {}): PageCtx {
  const embed = !!opts.embed;
  return {
    title: settings.title, embed, showHistory: settings.showHistory,
    base: url.pathname === "/publico" || url.pathname.startsWith("/publico/") ? "/publico" : "/rankings",
    site: settings.site, origin: url.origin, path: url.pathname + (url.search && !embed ? url.search : ""),
    today: todayIn(APP_TIMEZONE), assetVersion: RENDER_VERSION, hiddenPages: settings.hiddenPages, preview: opts.preview,
  };
}

const genders = (s: PublicSettings) => s.site.activeGenders;
const wa = (ctx: PageCtx) => whatsappUrl(ctx.site.whatsapp, ctx.site.whatsappMessage);

async function opts(db: D1Database, ctx: PageCtx, page: SitePage | null, extraIds: (string | null | undefined)[] = []): Promise<RenderOpts> {
  const ids = [...(page ? mediaIdsOf(page.blocks) : []), ctx.site.venueMediaId, ...extraIds].filter((x): x is string => !!x);
  return { media: await loadMedia(db, ids), whatsapp: wa(ctx) };
}

export async function homeView(db: D1Database, ctx: PageCtx, settings: PublicSettings, page: SitePage | null): Promise<string> {
  const [grouped, posts, seasons, sponsors] = await Promise.all([
    publicTournaments(db, genders(settings)).then(groupByEvent), latestPosts(db, 3, new Date().toISOString()), visibleSeasons(db), loadSponsors(db),
  ]);
  const season = resolveSeason(seasons, "actual");
  const refs = season && settings.enabled ? await rankingRefs(db, season.id, genders(settings)) : [];
  const all = grouped;
  const up = upcoming(all, ctx.today);
  const running = inProgress(all);
  const o = await opts(db, ctx, page, [...sponsors.map((s) => s.mediaId), ...posts.map((p) => p.coverMediaId)]);
  return homePage(ctx, {
    page, all, upcoming: up, inProgress: running, posts, season, refs, sponsors, media: o.media!,
    // Destacados que no aparecen ya en "en curso" o "próximos".
    featured: all.filter((t) => t.featured && t.status !== "cancelado" && !up.slice(0, 6).some((u) => u.id === t.id) && !running.slice(0, 6).some((u) => u.id === t.id)),
  });
}

const h2 = (title: string, inner: Raw) => h`<h2 style="margin-top:0">${title}</h2>${inner}`;

/** Reglamentos, Liga, Cancha abierta y Premios. */
export async function contentView(db: D1Database, ctx: PageCtx, settings: PublicSettings, page: SitePage): Promise<string> {
  const o = await opts(db, ctx, page);
  switch (page.slug) {
    case "reglamentos":
      return contentPage(ctx, page, "reglamentos", sideLinks([{ label: "Liga: cómo funciona el circuito", href: "/liga" }, { label: "Cancha abierta", href: "/cancha-abierta" }, { label: "Calendario", href: "/calendario" }, { label: "Torneos", href: "/torneos" }]
        .filter((l) => !ctx.hiddenPages.includes(l.href.slice(1)))), { print: true, ...o });
    case "liga":
      return contentPage(ctx, page, "liga", sideLinks([{ label: "Torneos", href: "/torneos" }, { label: "Rankings", href: "/rankings" }, { label: "Reglamentos", href: "/reglamentos" }, { label: "Calendario", href: "/calendario" }]
        .filter((l) => !ctx.hiddenPages.includes(l.href.slice(1)))), o);
    case "cancha-abierta": {
      const until = new Date(Date.parse(`${ctx.today}T00:00:00Z`) + 183 * 86_400_000).toISOString().slice(0, 10);
      const events = await eventsBetween(db, ctx.today, until, "cancha_abierta");
      return contentPage(ctx, page, "cancha-abierta", h2("Próximas fechas", eventsList(events, "Sin fechas publicadas", "Consultá las próximas canchas abiertas por WhatsApp.",
        waButton(ctx, "Consultar por WhatsApp", "Hola! Quiero anotarme a una cancha abierta."))), o);
    }
    case "premios": {
      const all = groupByEvent(await publicTournaments(db, genders(settings)));
      const withPrizes = all.filter((t) => t.prizeInfo && t.status !== "cancelado")
        .sort((a, b) => Number(a.status === "finalizado") - Number(b.status === "finalizado") || a.startDate.localeCompare(b.startDate));
      return contentPage(ctx, page, "premios", h2("Premios por torneo", prizesList(ctx, withPrizes)), o);
    }
    default:
      return contentPage(ctx, page, "liga", h``, o);
  }
}

export async function contactView(db: D1Database, ctx: PageCtx, page: SitePage | null): Promise<string> {
  return contactPage(ctx, page, await opts(db, ctx, page));
}

export async function tournamentsView(db: D1Database, ctx: PageCtx, settings: PublicSettings, page: SitePage | null, q: URLSearchParams): Promise<string> {
  const all = await publicTournaments(db, genders(settings));
  const get = (k: string) => q.get(k) ?? "";
  const tab = (TOURNAMENT_TABS.find((t) => t.key === get("estado"))?.key ?? "proximos") as TournamentTab;
  const num = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);
  const series = (SERIES.find((s) => SERIES_SLUG[s] === get("modalidad")) ?? null) as Series | null;
  const f = { tab, seasonId: num(get("temporada")), categoryId: num(get("categoria")), series };
  // Se filtran las categorías y después se agrupa: un torneo aparece una vez (con la categoría buscada como enlace).
  const filtered = groupByEvent(all.filter((t) => (!f.seasonId || t.seasonId === f.seasonId) && (!f.categoryId || t.categoryId === f.categoryId) && (!f.series || t.series === f.series)));
  const list = tab === "proximos" ? upcoming(filtered, ctx.today) : tab === "en-curso" ? inProgress(filtered) : tab === "finalizados" ? finished(filtered)
    : [...filtered].sort((a, b) => b.seasonYear - a.seasonYear || a.startDate.localeCompare(b.startDate));
  return tournamentsPage(ctx, all, list, f, page, await opts(db, ctx, page));
}

export async function calendarView(db: D1Database, ctx: PageCtx, settings: PublicSettings, page: SitePage | null, req: string): Promise<string> {
  const month = /^(20\d{2})-(0[1-9]|1[0-2])$/.test(req) ? req : ctx.today.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const [all, events] = await Promise.all([publicTournaments(db, genders(settings)).then(groupByEvent), eventsBetween(db, first, last)]);
  const inMonth = all.filter((t) => t.status !== "cancelado" && t.startDate <= last && t.endDate >= first);
  return calendarPage(ctx, month, inMonth, events, page, await opts(db, ctx, page));
}

export async function newsListView(db: D1Database, ctx: PageCtx, page: SitePage | null): Promise<string> {
  const posts = await latestPosts(db, 60, new Date().toISOString());
  return newsListPage(ctx, posts, page, await opts(db, ctx, page, posts.map((p) => p.coverMediaId)));
}

export async function newsView(db: D1Database, ctx: PageCtx, post: PublicPost): Promise<string> {
  return newsPage(ctx, post, await opts(db, ctx, { slug: post.slug, title: post.title, summary: null, blocks: post.blocks, seoTitle: null, seoDescription: null, updatedAt: "" }, [post.coverMediaId]));
}

export async function rankingsIndexView(db: D1Database, ctx: PageCtx, settings: PublicSettings, page: SitePage | null): Promise<string> {
  const seasons = await visibleSeasons(db);
  const items = await Promise.all(seasons.slice(0, 6).map(async (season) => ({ season, refs: await rankingRefs(db, season.id, genders(settings)) })));
  return indexPage(ctx, items, page, await opts(db, ctx, page));
}
