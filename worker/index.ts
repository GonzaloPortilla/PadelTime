import { app } from "./app";
import { publicApp } from "./public/app";
import { cleanupExpired } from "./lib/maintenance";
import { mediaHeaders, mediaStore } from "./lib/media";

/**
 * Reparto de rutas (Fase 7):
 *   /api/*     → API administrativa (con sesión)
 *   /admin/*   → panel de organizadores (SPA, sin indexar)
 *   resto      → web pública oficial (sin sesión). /publico/* se conserva por compatibilidad.
 * Los archivos estáticos (/assets, /pub, /brand, /web, /ocr) los sirve Cloudflare directamente
 * sin ejecutar el Worker (ver run_worker_first en wrangler.jsonc).
 */

/** Direcciones del panel anteriores a la Fase 7 → su equivalente bajo /admin (marcadores guardados). */
const LEGACY_ADMIN = /^\/(ingresar|jugadores|importar-rankings|publicacion|puntuacion|movimientos|temporadas|categorias|usuarios|respaldo|cuenta)(\/.*)?$/;

export function legacyAdminPath(pathname: string): string | null {
  if (LEGACY_ADMIN.test(pathname)) return `/admin${pathname}`;
  // /torneos/12 (id numérico) era la ficha del torneo en el panel; la web usa /torneos/<nombre>-<id>.
  if (/^\/torneos\/\d+$/.test(pathname)) return `/admin${pathname}`;
  return null;
}

/** Cabeceras del panel: CSP estricta, sin incrustar y sin indexar. */
const ADMIN_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-cache",
};

/** En `npm run dev`, Vite inyecta un script en línea (recarga en caliente): la CSP estricta se aplica sólo al build. */
const IS_DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

async function serveAdmin(request: Request, env: Env): Promise<Response> {
  // La SPA es un único index.html: cualquier ruta /admin/... lo recibe y React Router resuelve la pantalla.
  const res = await env.ASSETS.fetch(new Request(new URL("/", request.url), { headers: request.headers }));
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(ADMIN_HEADERS)) if (!(IS_DEV && k === "Content-Security-Policy")) out.headers.set(k, v);
  if (new URL(request.url).protocol === "https:") out.headers.set("Strict-Transport-Security", "max-age=31536000");
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/api" || pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return serveAdmin(request, env);
    // Archivos de la biblioteca de medios: /media/<id>/<nombre>. Inmutables: caché de un año.
    const media = /^\/media\/([0-9a-f-]{36})(?:\/[^/]*)?$/.exec(pathname);
    if (media && (request.method === "GET" || request.method === "HEAD")) {
      if (request.headers.get("if-none-match") === `"${media[1]}"`) return new Response(null, { status: 304, headers: { ETag: `"${media[1]}"` } });
      // Con dominio propio, la caché de Cloudflare evita leer KV en cada visita (cupo gratis: 100.000 lecturas/día).
      // En *.workers.dev la Cache API no guarda nada y se lee KV directamente (sin costo, sólo cuenta del cupo).
      const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
      const cacheKey = new Request(`${url.origin}/media/${media[1]}`);
      const hit = request.method === "GET" && cache ? await cache.match(cacheKey).catch(() => undefined) : undefined;
      if (hit) return hit;
      const file = await mediaStore(env).get(media[1]!);
      if (!file) return new Response("Archivo no encontrado", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      const res = new Response(request.method === "HEAD" ? null : file.body, { headers: { ...mediaHeaders(file), ETag: `"${media[1]}"` } });
      if (request.method === "GET" && cache) {
        // La copia en la caché de Cloudflare dura como máximo un día (al borrar un archivo también se purga).
        const copy = new Response(res.clone().body, res);
        copy.headers.set("Cache-Control", "public, max-age=31536000, s-maxage=86400");
        const put = cache.put(cacheKey, copy).catch(() => undefined);
        try { ctx.waitUntil(put); } catch { await put; }
      }
      return res;
    }
    const legacy = legacyAdminPath(pathname);
    if (legacy) return Response.redirect(`${url.origin}${legacy}${url.search}`, 301);
    // Archivos de la raíz que no son páginas (manifest, íconos…): los sirve Cloudflare.
    if (/\.[a-z0-9]{2,5}$/i.test(pathname) && pathname !== "/robots.txt" && pathname !== "/sitemap.xml") {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return publicApp.fetch(request, env, ctx);
  },
  // Tarea diaria (Cron Trigger, incluido en el plan gratuito): limpia datos temporales.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupExpired(env.DB));
  },
} satisfies ExportedHandler<Env>;
