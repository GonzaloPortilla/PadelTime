import { Hono, type Context } from "hono";
import { CSV_MIME, XLSX_MIME, slug, toCsv, toXlsx } from "@shared/export";
import { RANKING_HEADER, rankingRows, rankingSheet } from "@shared/rankingExport";
import { loadPublicSettings, publicVersion } from "../lib/settings";
import { loadPlayer, loadRanking, rankingRefs, resolveSeason, searchPlayers, visibleSeasons } from "./data";
import { indexPage, messagePage, playerPage, rankingPage, searchPage, type PageCtx } from "./pages";

/**
 * Vista pública de sólo lectura (/publico/*). Es una app aparte de la API: no lee cookies ni
 * sesiones, no expone rutas administrativas y sólo consulta datos publicables.
 *
 * Caché: cada respuesta se identifica con la "versión pública" (un contador que la base incrementa
 * con triggers ante cualquier acreditación, reversión, importación o cambio de nombres). Mientras la
 * versión no cambia, se sirve la copia guardada (memoria del isolate y Cache API). Apenas cambia,
 * la página se regenera: la actualización es automática y no hace falta tocar Google Sites.
 */

type PublicEnv = { Bindings: Env };

/** Cambiar al modificar el HTML, para invalidar copias en caché de versiones anteriores. */
const RENDER_VERSION = "f5b.1";

const DEFAULT_ANCESTORS = "https://sites.google.com https://*.googleusercontent.com https://www.padeltime.com.ar https://padeltime.com.ar";

function securityHeaders(env: Env): Record<string, string> {
  const ancestors = (env.PUBLIC_FRAME_ANCESTORS ?? DEFAULT_ANCESTORS).trim() || "'none'";
  return {
    // Permite incrustar en Google Sites (y el dominio propio); sin X-Frame-Options a propósito.
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self' ${ancestors}`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000",
  };
}

interface Rendered { body: string | Uint8Array; status: number; type: string; disposition?: string }

const memory = new Map<string, Rendered>();
const MEMORY_MAX = 80;

function remember(key: string, value: Rendered) {
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, value);
}

async function serve(c: Context<PublicEnv>, render: (ctx: PageCtx) => Promise<Rendered>): Promise<Response> {
  const db = c.env.DB;
  const url = new URL(c.req.url);
  const { version, enabled } = await publicVersion(db);
  const etag = `"${RENDER_VERSION}-${version}"`;
  const baseHeaders: Record<string, string> = {
    ...securityHeaders(c.env),
    ETag: etag,
    // El navegador revalida siempre (respuesta 304 si no cambió nada): los puntos nuevos se ven al instante.
    "Cache-Control": "public, max-age=0, must-revalidate",
  };
  if (url.searchParams.get("embed") === "1") baseHeaders["X-Robots-Tag"] = "noindex";

  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: baseHeaders });

  const key = `${url.pathname}?${[...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}#${etag}`;
  const toResponse = (r: Rendered) =>
    new Response(typeof r.body === "string" ? r.body : r.body.slice(), {
      status: r.status,
      headers: { ...baseHeaders, "Content-Type": r.type, ...(r.disposition ? { "Content-Disposition": r.disposition, "Cache-Control": "no-store" } : {}) },
    });

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
        type: cached.headers.get("content-type") ?? "text/html; charset=utf-8",
        disposition: cached.headers.get("content-disposition") ?? undefined,
      };
      remember(key, r);
      return toResponse(r);
    }
  }

  let rendered: Rendered;
  if (!enabled) {
    const settings = await loadPublicSettings(db);
    rendered = { status: 404, type: "text/html; charset=utf-8", body: messagePage({ title: settings.title, embed: url.searchParams.get("embed") === "1", showHistory: false }, "Rankings no disponibles", "La publicación de rankings está desactivada por el momento.") };
  } else {
    const settings = await loadPublicSettings(db);
    const ctx: PageCtx = { title: settings.title, embed: url.searchParams.get("embed") === "1", showHistory: settings.showHistory };
    rendered = await render(ctx);
  }
  // Sólo se guardan respuestas exitosas o 404 (no errores transitorios).
  if (rendered.status === 200 || rendered.status === 404) {
    remember(key, rendered);
    if (cache) {
      const toStore = new Response(typeof rendered.body === "string" ? rendered.body : rendered.body.slice(), {
        status: rendered.status,
        headers: { "Content-Type": rendered.type, "Cache-Control": "public, s-maxage=604800", ...(rendered.disposition ? { "Content-Disposition": rendered.disposition } : {}) },
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

const html = (body: string, status = 200): Rendered => ({ body, status, type: "text/html; charset=utf-8" });

export const publicApp = new Hono<PublicEnv>();

publicApp.onError((err, c) => {
  console.error("Error en la vista pública", err);
  return c.html("<!doctype html><meta charset=utf-8><title>Error</title><p style='font-family:system-ui;padding:24px'>No pudimos cargar el ranking. Probá de nuevo en unos minutos.</p>", 500, securityHeaders(c.env));
});

publicApp.get("/publico", (c) =>
  serve(c, async (ctx) => {
    const seasons = await visibleSeasons(c.env.DB);
    const items = await Promise.all(seasons.slice(0, 6).map(async (season) => ({ season, refs: await rankingRefs(c.env.DB, season.id) })));
    return html(indexPage(ctx, items));
  }),
);
publicApp.get("/publico/", (c) => c.redirect("/publico" + new URL(c.req.url).search, 301));

async function rankingHandler(c: Context<PublicEnv>) {
  const seasonParam = c.req.param("season") ?? "";
  const categoryId = Number(c.req.param("category"));
  const divisionParam = c.req.param("division");
  const divisionId = divisionParam === undefined ? null : Number(divisionParam);
  return serve(c, async (ctx) => {
    const notFound = () => html(messagePage(ctx, "Ranking no encontrado", "El ranking que buscás no existe o no está publicado."), 404);
    if (!Number.isInteger(categoryId) || (divisionId !== null && !Number.isInteger(divisionId))) return notFound();
    const seasons = await visibleSeasons(c.env.DB);
    const season = resolveSeason(seasons, seasonParam);
    if (!season) return notFound();
    const data = await loadRanking(c.env.DB, season, categoryId, divisionId);
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
    const siblings = await rankingRefs(c.env.DB, season.id);
    return html(rankingPage(ctx, data, siblings, { seasonParam, query: c.req.query("buscar") ?? "" }));
  });
}

publicApp.get("/publico/ranking/:season/:category", rankingHandler);
publicApp.get("/publico/ranking/:season/:category/:division", rankingHandler);

publicApp.get("/publico/jugadores", (c) =>
  serve(c, async (ctx) => {
    if (!ctx.showHistory) return html(messagePage(ctx, "Búsqueda no disponible", "La consulta de jugadores no está habilitada."), 404);
    const q = (c.req.query("q") ?? "").slice(0, 60);
    const hits = q.trim().length >= 2 ? await searchPlayers(c.env.DB, q) : [];
    return html(searchPage(ctx, q, hits));
  }),
);

publicApp.get("/publico/jugador/:code", (c) =>
  serve(c, async (ctx) => {
    const code = c.req.param("code");
    const notFound = () => html(messagePage(ctx, "Jugador no encontrado", "No hay puntos publicados para ese jugador."), 404);
    if (!ctx.showHistory) return html(messagePage(ctx, "Historial no disponible", "La consulta de jugadores no está habilitada."), 404);
    if (!/^J-\d{1,9}$/i.test(code)) return notFound();
    const seasons = await visibleSeasons(c.env.DB);
    const player = await loadPlayer(c.env.DB, code, seasons);
    return player ? html(playerPage(ctx, player)) : notFound();
  }),
);

publicApp.notFound((c) =>
  serve(c, async (ctx) => html(messagePage(ctx, "Página no encontrada", "La dirección no corresponde a ningún ranking."), 404)),
);
