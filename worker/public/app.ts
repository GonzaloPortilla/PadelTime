import { Hono, type Context } from "hono";
import { APP_TIMEZONE } from "@shared/constants";
import { todayIn } from "@shared/text";
import { CSV_MIME, XLSX_MIME, slug, toCsv, toXlsx } from "@shared/export";
import { RANKING_HEADER, rankingRows, rankingSheet } from "@shared/rankingExport";
import { tournamentIdFromSlug, tournamentPath } from "@shared/site";
import { loadPublicSettings, publicVersion, type PublicSettings } from "../lib/settings";
import { loadPlayer, loadRanking, rankingRefs, resolveSeason, searchPlayers, visibleSeasons } from "./data";
import type { PageCtx } from "./layout";
import { messagePage, playerPage, rankingPage, rankingPath, searchPage } from "./pages";
import { eventTournaments, loadPage, loadPost, loadPublicFixture, postSlugs, publicTournament, publicTournaments, tournamentTeamsAndResults } from "./site-data";
import { notFoundPage, robotsTxt, sitemapXml, tournamentPage } from "./site-pages";
import {
  calendarView, contactView, contentView, homeView, makeCtx, newsListView, newsView, rankingsIndexView, RENDER_VERSION, tournamentsView,
} from "./views";

/**
 * Web pública oficial (sin sesión). Es una app aparte de la API: no lee cookies ni sesiones,
 * no expone rutas administrativas y sólo consulta datos publicables.
 *
 * Caché: cada respuesta se identifica con la "versión pública" (contador que la base incrementa con
 * triggers ante cualquier cambio visible: acreditaciones, torneos, contenidos, ajustes…) y con la
 * fecha del día (para "próximos" y el calendario). Mientras no cambian, se sirve la copia guardada.
 */

type PublicEnv = { Bindings: Env };


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
  const ctx: PageCtx = makeCtx(settings, url, { embed });
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
publicApp.get("/", (c) => serve(c, async (ctx, settings) => html(await homeView(c.env.DB, ctx, settings, await loadPage(c.env.DB, "inicio")))));

// ─────────────────────────── Torneos ───────────────────────────
publicApp.get("/torneos", (c) =>
  serve(c, async (ctx, settings) => html(await tournamentsView(c.env.DB, ctx, settings, await loadPage(c.env.DB, "torneos"), new URL(c.req.url).searchParams))),
);

publicApp.get("/torneos/:slug", (c) =>
  serve(c, async (ctx, settings) => {
    const slugParam = c.req.param("slug");
    const id = tournamentIdFromSlug(slugParam);
    const t = id ? await publicTournament(c.env.DB, id, genders(settings)) : null;
    if (!t) return html(notFoundPage(ctx, "Torneo no encontrado", "El torneo no existe o todavía no está publicado."), 404);
    const canonical = tournamentPath(t);
    if (`/torneos/${slugParam}` !== canonical) return redirect(canonical);
    const [data, fixture, siblings] = await Promise.all([
      tournamentTeamsAndResults(c.env.DB, t.id),
      t.type === "largo" ? loadPublicFixture(c.env.DB, t.id) : Promise.resolve(null),
      t.eventId ? eventTournaments(c.env.DB, t.eventId, genders(settings)) : Promise.resolve([]),
    ]);
    return html(tournamentPage(ctx, t, data, { fixture, siblings }));
  }),
);

// ─────────────────────────── Calendario ───────────────────────────
publicApp.get("/calendario", (c) =>
  serve(c, async (ctx, settings) => html(await calendarView(c.env.DB, ctx, settings, await loadPage(c.env.DB, "calendario"), c.req.query("mes") ?? ""))),
);

// ─────────────────────────── Contenidos (editables desde Web → Páginas) ───────────────────────────
for (const slugName of ["reglamentos", "liga", "cancha-abierta", "premios"]) {
  publicApp.get(`/${slugName}`, (c) =>
    serve(c, async (ctx, settings) => {
      const page = await loadPage(c.env.DB, slugName); // sólo si está publicada (oculta = 404)
      return page ? html(await contentView(c.env.DB, ctx, settings, page)) : html(notFoundPage(ctx), 404);
    }),
  );
}

publicApp.get("/contacto", (c) => serve(c, async (ctx) => html(await contactView(c.env.DB, ctx, await loadPage(c.env.DB, "contacto")))));

publicApp.get("/novedades", (c) => serve(c, async (ctx) => html(await newsListView(c.env.DB, ctx, await loadPage(c.env.DB, "novedades")))));
publicApp.get("/novedades/:slug", (c) =>
  serve(c, async (ctx) => {
    const post = await loadPost(c.env.DB, c.req.param("slug"), new Date().toISOString());
    return post ? html(await newsView(c.env.DB, ctx, post)) : html(notFoundPage(ctx, "Novedad no encontrada", "La novedad no existe o ya no está publicada."), 404);
  }),
);

// ─────────────────────────── Rankings (/rankings y, por compatibilidad, /publico) ───────────────────────────
const disabled = (ctx: PageCtx) => html(messagePage(ctx, "Rankings no disponibles", "La publicación de rankings está desactivada por el momento."), 404);

const rankingsIndex = (c: Context<PublicEnv>) =>
  serve(c, async (ctx, settings) => {
    if (!settings.enabled) return disabled(ctx);
    // En el modo incrustado de Google Sites no se muestra la introducción editable.
    return html(await rankingsIndexView(c.env.DB, ctx, settings, ctx.embed ? null : await loadPage(c.env.DB, "rankings")));
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
