import { Hono, type Context } from "hono";
import { APP_TIMEZONE } from "@shared/constants";
import { CSV_MIME, XLSX_MIME, slug, toCsv, toXlsx } from "@shared/export";
import { RANKING_HEADER, rankingRows, rankingSheet } from "@shared/rankingExport";
import { SERIES, SERIES_SLUG, tournamentIdFromSlug, tournamentPath, type Series } from "@shared/site";
import { todayIn } from "@shared/text";
import { loadPublicSettings, publicVersion, type PublicSettings } from "../lib/settings";
import { loadPlayer, loadRanking, rankingRefs, resolveSeason, searchPlayers, visibleSeasons } from "./data";
import type { PageCtx } from "./layout";
import { indexPage, messagePage, playerPage, rankingPage, rankingPath, searchPage } from "./pages";
import {
  eventsBetween, finished, inProgress, latestPosts, loadPage, loadPost, postSlugs, publicTournament, publicTournaments,
  tournamentTeamsAndResults, upcoming,
} from "./site-data";
import {
  calendarPage, contactPage, contentPage, eventsList, homePage, newsListPage, newsPage, notFoundPage, prizesList, robotsTxt, sideLinks,
  sitemapXml, TOURNAMENT_TABS, tournamentPage, tournamentsPage, type TournamentTab,
} from "./site-pages";
import { waButton } from "./layout";
import { h, type Raw } from "./html";

/**
 * Web pública oficial (sin sesión). Es una app aparte de la API: no lee cookies ni sesiones,
 * no expone rutas administrativas y sólo consulta datos publicables.
 *
 * Caché: cada respuesta se identifica con la "versión pública" (contador que la base incrementa con
 * triggers ante cualquier cambio visible: acreditaciones, torneos, contenidos, ajustes…) y con la
 * fecha del día (para "próximos" y el calendario). Mientras no cambian, se sirve la copia guardada.
 */

type PublicEnv = { Bindings: Env };

/** Cambiar al modificar el HTML o el CSS, para invalidar copias en caché de versiones anteriores. */
const RENDER_VERSION = "f7.2";

const DEFAULT_ANCESTORS = "https://sites.google.com https://*.googleusercontent.com https://www.padeltime.com.ar https://padeltime.com.ar";

function securityHeaders(env: Env): Record<string, string> {
  const ancestors = (env.PUBLIC_FRAME_ANCESTORS ?? DEFAULT_ANCESTORS).trim() || "'none'";
  return {
    // Permite incrustar en Google Sites (y el dominio propio); sin X-Frame-Options a propósito.
    // frame-src: sólo el mapa de Google de la página de contacto.
    "Content-Security-Policy": `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'; frame-src https://www.google.com; form-action 'self'; base-uri 'none'; frame-ancestors 'self' ${ancestors}`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000",
  };
}

interface Rendered { body: string | Uint8Array; status: number; type: string; disposition?: string; location?: string }

const memory = new Map<string, Rendered>();
const MEMORY_MAX = 120;

function remember(key: string, value: Rendered) {
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, value);
}

const HTML = "text/html; charset=utf-8";
const html = (body: string, status = 200): Rendered => ({ body, status, type: HTML });
const redirect = (location: string): Rendered => ({ body: "", status: 301, type: "text/plain", location });

function baseOf(pathname: string): PageCtx["base"] {
  return pathname === "/publico" || pathname.startsWith("/publico/") ? "/publico" : "/rankings";
}

async function serve(c: Context<PublicEnv>, render: (ctx: PageCtx, settings: PublicSettings) => Promise<Rendered>): Promise<Response> {
  const db = c.env.DB;
  const url = new URL(c.req.url);
  const today = todayIn(APP_TIMEZONE);
  const { version } = await publicVersion(db);
  const etag = `"${RENDER_VERSION}-${version}-${today}"`;
  const embed = url.searchParams.get("embed") === "1";
  const baseHeaders: Record<string, string> = {
    ...securityHeaders(c.env),
    ETag: etag,
    // El navegador revalida siempre (respuesta 304 si no cambió nada): lo nuevo se ve al instante.
    "Cache-Control": "public, max-age=0, must-revalidate",
  };
  if (embed) baseHeaders["X-Robots-Tag"] = "noindex";

  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: baseHeaders });

  const key = `${url.pathname}?${[...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}#${etag}`;
  const toResponse = (r: Rendered) => {
    if (r.location) return new Response(null, { status: r.status, headers: { ...baseHeaders, Location: r.location } });
    return new Response(typeof r.body === "string" ? r.body : r.body.slice(), {
      status: r.status,
      headers: { ...baseHeaders, "Content-Type": r.type, ...(r.disposition ? { "Content-Disposition": r.disposition, "Cache-Control": "no-store" } : {}) },
    });
  };

  const hit = memory.get(key);
  if (hit) return toResponse(hit);

  // Cache API (funciona en dominios propios; en workers.dev es un no-op inofensivo).
  const cacheKey = new Request(`https://cache.padel-time.internal${key.replace("#", "&__v=")}`);
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  if (cache) {
    const cached = await cache.match(cacheKey).catch(() => undefined);
    if (cached) {
      const r: Rendered = {
        body: new Uint8Array(await cached.arrayBuffer()), status: cached.status,
        type: cached.headers.get("content-type") ?? HTML,
        disposition: cached.headers.get("content-disposition") ?? undefined,
        location: cached.headers.get("x-location") ?? undefined,
      };
      remember(key, r);
      return toResponse(r);
    }
  }

  const settings = await loadPublicSettings(db);
  const ctx: PageCtx = {
    title: settings.title, embed, showHistory: settings.showHistory, base: baseOf(url.pathname), site: settings.site,
    origin: url.origin, path: url.pathname + (url.search && !embed ? url.search : ""), today, assetVersion: RENDER_VERSION,
  };
  const rendered = await render(ctx, settings);
  // Sólo se guardan respuestas exitosas, redirecciones o 404 (no errores transitorios).
  if (rendered.status === 200 || rendered.status === 404 || rendered.status === 301) {
    remember(key, rendered);
    if (cache) {
      const toStore = new Response(typeof rendered.body === "string" ? rendered.body : rendered.body.slice(), {
        status: rendered.status === 301 ? 200 : rendered.status,
        headers: {
          "Content-Type": rendered.type, "Cache-Control": "public, s-maxage=604800",
          ...(rendered.disposition ? { "Content-Disposition": rendered.disposition } : {}),
          ...(rendered.location ? { "x-location": rendered.location } : {}),
        },
      });
      const put = cache.put(cacheKey, toStore).catch(() => undefined);
      try {
        c.executionCtx.waitUntil(put);
      } catch {
        await put; // sin contexto de ejecución (pruebas): se espera directamente
      }
    }
  }
  return toResponse(rendered);
}

export const publicApp = new Hono<PublicEnv>();

publicApp.onError((err, c) => {
  console.error("Error en la web pública", err);
  return c.html("<!doctype html><meta charset=utf-8><title>Error</title><p style='font-family:system-ui;padding:24px'>No pudimos cargar la página. Probá de nuevo en unos minutos.</p>", 500, securityHeaders(c.env));
});

const genders = (s: PublicSettings) => s.site.activeGenders;

// ─────────────────────────── Inicio ───────────────────────────
publicApp.get("/", (c) =>
  serve(c, async (ctx, settings) => {
    const db = c.env.DB;
    const [page, all, posts, seasons] = await Promise.all([
      loadPage(db, "inicio"), publicTournaments(db, genders(settings)), latestPosts(db, 3, new Date().toISOString()), visibleSeasons(db),
    ]);
    const season = resolveSeason(seasons, "actual");
    const refs = season && settings.enabled ? await rankingRefs(db, season.id, genders(settings)) : [];
    const up = upcoming(all, ctx.today);
    return html(homePage(ctx, {
      page, upcoming: up, inProgress: inProgress(all), posts, season, refs,
      // Destacados que no aparecen ya en "en curso" o "próximos".
      featured: all.filter((t) => t.featured && t.status !== "cancelado" && !up.slice(0, 6).some((u) => u.id === t.id) && !inProgress(all).slice(0, 6).some((u) => u.id === t.id)),
    }));
  }),
);

// ─────────────────────────── Torneos ───────────────────────────
publicApp.get("/torneos", (c) =>
  serve(c, async (ctx, settings) => {
    const all = await publicTournaments(c.env.DB, genders(settings));
    const q = (k: string) => c.req.query(k) ?? "";
    const tab = (TOURNAMENT_TABS.find((t) => t.key === q("estado"))?.key ?? "proximos") as TournamentTab;
    const num = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);
    const series = (SERIES.find((s) => SERIES_SLUG[s] === q("modalidad")) ?? null) as Series | null;
    const f = { tab, seasonId: num(q("temporada")), categoryId: num(q("categoria")), series };
    const filtered = all.filter((t) => (!f.seasonId || t.seasonId === f.seasonId) && (!f.categoryId || t.categoryId === f.categoryId) && (!f.series || t.series === f.series));
    const list = tab === "proximos" ? upcoming(filtered, ctx.today) : tab === "en-curso" ? inProgress(filtered) : tab === "finalizados" ? finished(filtered)
      : [...filtered].sort((a, b) => b.seasonYear - a.seasonYear || a.startDate.localeCompare(b.startDate));
    return html(tournamentsPage(ctx, all, list, f));
  }),
);

publicApp.get("/torneos/:slug", (c) =>
  serve(c, async (ctx, settings) => {
    const slugParam = c.req.param("slug");
    const id = tournamentIdFromSlug(slugParam);
    const t = id ? await publicTournament(c.env.DB, id, genders(settings)) : null;
    if (!t) return html(notFoundPage(ctx, "Torneo no encontrado", "El torneo no existe o todavía no está publicado."), 404);
    const canonical = tournamentPath(t);
    if (`/torneos/${slugParam}` !== canonical) return redirect(canonical);
    return html(tournamentPage(ctx, t, await tournamentTeamsAndResults(c.env.DB, t.id)));
  }),
);

// ─────────────────────────── Calendario ───────────────────────────
publicApp.get("/calendario", (c) =>
  serve(c, async (ctx, settings) => {
    const req = c.req.query("mes") ?? "";
    const month = /^(20\d{2})-(0[1-9]|1[0-2])$/.test(req) ? req : ctx.today.slice(0, 7);
    const [y, m] = month.split("-").map(Number) as [number, number];
    const first = `${month}-01`;
    const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const [all, events] = await Promise.all([publicTournaments(c.env.DB, genders(settings)), eventsBetween(c.env.DB, first, last)]);
    const inMonth = all.filter((t) => t.status !== "cancelado" && t.startDate <= last && t.endDate >= first);
    return html(calendarPage(ctx, month, inMonth, events));
  }),
);

// ─────────────────────────── Contenidos ───────────────────────────
publicApp.get("/reglamentos", (c) =>
  serve(c, async (ctx) => {
    const page = await loadPage(c.env.DB, "reglamentos");
    if (!page) return html(notFoundPage(ctx), 404);
    const extra = sideLinks([{ label: "Liga: cómo funciona el circuito", href: "/liga" }, { label: "Cancha abierta", href: "/cancha-abierta" }, { label: "Calendario", href: "/calendario" }, { label: "Torneos", href: "/torneos" }]);
    return html(contentPage(ctx, page, "reglamentos", extra, { print: true }));
  }),
);

publicApp.get("/liga", (c) =>
  serve(c, async (ctx) => {
    const page = await loadPage(c.env.DB, "liga");
    if (!page) return html(notFoundPage(ctx), 404);
    const extra = sideLinks([{ label: "Torneos", href: "/torneos" }, { label: "Rankings", href: "/rankings" }, { label: "Reglamentos", href: "/reglamentos" }, { label: "Calendario", href: "/calendario" }]);
    return html(contentPage(ctx, page, "liga", extra));
  }),
);

publicApp.get("/cancha-abierta", (c) =>
  serve(c, async (ctx) => {
    const page = await loadPage(c.env.DB, "cancha-abierta");
    if (!page) return html(notFoundPage(ctx), 404);
    const until = new Date(Date.parse(`${ctx.today}T00:00:00Z`) + 183 * 86_400_000).toISOString().slice(0, 10);
    const events = await eventsBetween(c.env.DB, ctx.today, until, "cancha_abierta");
    const extra = h2("Próximas fechas", eventsList(events, "Sin fechas publicadas", "Consultá las próximas canchas abiertas por WhatsApp.",
      waButton(ctx, "Consultar por WhatsApp", "Hola! Quiero anotarme a una cancha abierta.")));
    return html(contentPage(ctx, page, "cancha-abierta", extra));
  }),
);

publicApp.get("/premios", (c) =>
  serve(c, async (ctx, settings) => {
    const page = await loadPage(c.env.DB, "premios");
    if (!page) return html(notFoundPage(ctx), 404);
    const all = await publicTournaments(c.env.DB, genders(settings));
    const withPrizes = all.filter((t) => t.prizeInfo && t.status !== "cancelado")
      .sort((a, b) => Number(a.status === "finalizado") - Number(b.status === "finalizado") || a.startDate.localeCompare(b.startDate));
    return html(contentPage(ctx, page, "premios", h2("Premios por torneo", prizesList(ctx, withPrizes))));
  }),
);

publicApp.get("/contacto", (c) => serve(c, async (ctx) => html(contactPage(ctx, await loadPage(c.env.DB, "contacto")))));

publicApp.get("/novedades", (c) => serve(c, async (ctx) => html(newsListPage(ctx, await latestPosts(c.env.DB, 60, new Date().toISOString())))));
publicApp.get("/novedades/:slug", (c) =>
  serve(c, async (ctx) => {
    const post = await loadPost(c.env.DB, c.req.param("slug"), new Date().toISOString());
    return post ? html(newsPage(ctx, post)) : html(notFoundPage(ctx, "Novedad no encontrada", "La novedad no existe o ya no está publicada."), 404);
  }),
);

const h2 = (title: string, inner: Raw) => h`<h2 style="margin-top:0">${title}</h2>${inner}`;

// ─────────────────────────── Rankings (/rankings y, por compatibilidad, /publico) ───────────────────────────
const disabled = (ctx: PageCtx) => html(messagePage(ctx, "Rankings no disponibles", "La publicación de rankings está desactivada por el momento."), 404);

const rankingsIndex = (c: Context<PublicEnv>) =>
  serve(c, async (ctx, settings) => {
    if (!settings.enabled) return disabled(ctx);
    const seasons = await visibleSeasons(c.env.DB);
    const items = await Promise.all(seasons.slice(0, 6).map(async (season) => ({ season, refs: await rankingRefs(c.env.DB, season.id, genders(settings)) })));
    return html(indexPage(ctx, items));
  });

async function rankingHandler(c: Context<PublicEnv>) {
  const seasonParam = c.req.param("season") ?? "";
  const categoryId = Number(c.req.param("category"));
  const divisionParam = c.req.param("division");
  const divisionId = divisionParam === undefined ? null : Number(divisionParam);
  return serve(c, async (ctx, settings) => {
    if (!settings.enabled) return disabled(ctx);
    const notFound = () => html(messagePage(ctx, "Ranking no encontrado", "El ranking que buscás no existe o no está publicado."), 404);
    if (!Number.isInteger(categoryId) || (divisionId !== null && !Number.isInteger(divisionId))) return notFound();
    const seasons = await visibleSeasons(c.env.DB);
    const season = resolveSeason(seasons, seasonParam);
    if (!season) return notFound();
    const data = await loadRanking(c.env.DB, season, categoryId, divisionId, genders(settings));
    if (!data) return notFound();

    const format = c.req.query("descargar");
    if (format === "xlsx" || format === "csv") {
      const name = slug("ranking", data.category.name, data.category.gender === "M" ? "caballeros" : "damas", data.division?.name ?? "", season.name);
      if (format === "csv") {
        return { body: toCsv(RANKING_HEADER, rankingRows(data.rows)), status: 200, type: CSV_MIME, disposition: `attachment; filename="${name}.csv"` };
      }
      const sheet = rankingSheet({
        seasonName: season.name, category: data.category, divisionName: data.division?.name ?? null,
        tiebreakers: season.tiebreakers, rows: data.rows, generatedAt: new Date().toISOString(),
      });
      return { body: toXlsx([sheet]), status: 200, type: XLSX_MIME, disposition: `attachment; filename="${name}.xlsx"` };
    }
    const siblings = await rankingRefs(c.env.DB, season.id, genders(settings));
    return html(rankingPage(ctx, data, siblings, { seasonParam, query: c.req.query("buscar") ?? "" }));
  });
}

const playersSearch = (c: Context<PublicEnv>) =>
  serve(c, async (ctx, settings) => {
    if (!settings.enabled) return disabled(ctx);
    if (!ctx.showHistory) return html(messagePage(ctx, "Búsqueda no disponible", "La consulta de jugadores no está habilitada."), 404);
    const q = (c.req.query("q") ?? "").slice(0, 60);
    const hits = q.trim().length >= 2 ? await searchPlayers(c.env.DB, q, genders(settings)) : [];
    return html(searchPage(ctx, q, hits));
  });

const playerDetail = (c: Context<PublicEnv>) =>
  serve(c, async (ctx, settings) => {
    if (!settings.enabled) return disabled(ctx);
    const code = c.req.param("code") ?? "";
    const notFound = () => html(messagePage(ctx, "Jugador no encontrado", "No hay puntos publicados para ese jugador."), 404);
    if (!ctx.showHistory) return html(messagePage(ctx, "Historial no disponible", "La consulta de jugadores no está habilitada."), 404);
    if (!/^J-\d{1,9}$/i.test(code)) return notFound();
    const seasons = await visibleSeasons(c.env.DB);
    const player = await loadPlayer(c.env.DB, code, seasons, genders(settings));
    return player ? html(playerPage(ctx, player)) : notFound();
  });

publicApp.get("/rankings", rankingsIndex);
publicApp.get("/rankings/jugadores", playersSearch);
publicApp.get("/rankings/jugador/:code", playerDetail);
publicApp.get("/rankings/:season/:category", rankingHandler);
publicApp.get("/rankings/:season/:category/:division", rankingHandler);

publicApp.get("/publico", rankingsIndex);
publicApp.get("/publico/", (c) => c.redirect("/publico" + new URL(c.req.url).search, 301));
publicApp.get("/publico/ranking/:season/:category", rankingHandler);
publicApp.get("/publico/ranking/:season/:category/:division", rankingHandler);
publicApp.get("/publico/jugadores", playersSearch);
publicApp.get("/publico/jugador/:code", playerDetail);

// ─────────────────────────── Buscadores ───────────────────────────
publicApp.get("/robots.txt", (c) => c.text(robotsTxt(new URL(c.req.url).origin), 200, { "Cache-Control": "public, max-age=3600" }));

publicApp.get("/sitemap.xml", (c) =>
  serve(c, async (ctx, settings) => {
    const db = c.env.DB;
    const [all, seasons, posts] = await Promise.all([publicTournaments(db, genders(settings)), visibleSeasons(db), postSlugs(db, new Date().toISOString())]);
    const refs = settings.enabled ? (await Promise.all(seasons.slice(0, 3).map((s) => rankingRefs(db, s.id, genders(settings))))).flat() : [];
    const entries = [
      ...["/", "/torneos", "/rankings", "/calendario", "/reglamentos", "/liga", "/cancha-abierta", "/premios", "/contacto", "/novedades"].map((path) => ({ path })),
      ...all.map((t) => ({ path: tournamentPath(t) })),
      ...refs.map((r) => ({ path: rankingPath(r) })),
      ...posts.map((p) => ({ path: `/novedades/${p.slug}`, lastmod: p.publishedAt })),
    ];
    return { body: sitemapXml(ctx.origin, entries), status: 200, type: "application/xml; charset=utf-8" };
  }),
);

publicApp.notFound((c) => serve(c, async (ctx) => html(notFoundPage(ctx), 404)));
