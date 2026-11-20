/**
 * Diseño común de la web pública: cabecera con menú, aviso destacado, banner, pie y metadatos
 * para buscadores. Todas las páginas (inicio, torneos, rankings, calendario, contenidos) lo usan.
 * Las páginas son HTML generado en el Worker: funcionan sin JavaScript y pesan pocos KB.
 */
import type { SiteSettings } from "@shared/site";
import { whatsappUrl } from "@shared/site";
import { h, raw, type Raw } from "./html";

export interface PageCtx {
  /** Nombre del sitio (Publicación web → título). */
  title: string;
  /** Modo incrustado (?embed=1, para Google Sites): sin menú ni pie. */
  embed: boolean;
  showHistory: boolean;
  /** Prefijo de los rankings: /rankings (principal) o /publico (compatibilidad con enlaces anteriores). */
  base: "/rankings" | "/publico";
  site: SiteSettings;
  origin: string;
  path: string;
  /** Fecha de hoy en Argentina (AAAA-MM-DD): define "próximos", "en curso" y el calendario. */
  today: string;
  /** Versión de los recursos estáticos (rompe la caché del CSS al cambiar el diseño). */
  assetVersion: string;
  /** Páginas de contenido ocultas desde el CMS (no aparecen en el menú). */
  hiddenPages: string[];
  /** Vista previa del CMS (contenido sin publicar, sólo para organizadores). */
  preview?: boolean;
}

export type Section = "inicio" | "torneos" | "rankings" | "calendario" | "reglamentos" | "liga" | "cancha-abierta" | "premios" | "contacto" | "novedades";

export const NAV: { key: Section; label: string; href: string }[] = [
  { key: "inicio", label: "Inicio", href: "/" },
  { key: "torneos", label: "Torneos", href: "/torneos" },
  { key: "rankings", label: "Rankings", href: "/rankings" },
  { key: "calendario", label: "Calendario", href: "/calendario" },
  { key: "reglamentos", label: "Reglamentos", href: "/reglamentos" },
  { key: "liga", label: "Liga", href: "/liga" },
  { key: "cancha-abierta", label: "Cancha abierta", href: "/cancha-abierta" },
  { key: "premios", label: "Premios", href: "/premios" },
  { key: "contacto", label: "Contacto", href: "/contacto" },
];

// ─────────────────────────── Formatos ───────────────────────────
const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const monthYearFmt = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
});
const asDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
export const fmtDate = (iso: string) => dateFmt.format(asDate(iso));
export const fmtLong = (iso: string) => longFmt.format(asDate(iso));
export const fmtDay = (iso: string) => String(asDate(iso).getUTCDate());
export const fmtMonthShort = (iso: string) => monthFmt.format(asDate(iso)).replace(".", "");
export const fmtMonthYear = (iso: string) => monthYearFmt.format(asDate(iso));
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const fmtPts = (n: number) => n.toLocaleString("es-AR");
export const fmtRange = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} al ${fmtDate(b)}`);

// ─────────────────────────── Íconos (SVG en línea, sin dependencias) ───────────────────────────
export const ICON = {
  whatsapp: raw(`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z"/></svg>`),
  instagram: raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>`),
  pin: raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg>`),
  doc: raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>`),
  trophy: raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>`),
};

/** Botón de WhatsApp con mensaje armado (inscripciones y consultas). No se dibuja si no hay número configurado. */
export function waButton(ctx: PageCtx, label: string, message?: string, cls = ""): Raw {
  const url = whatsappUrl(ctx.site.whatsapp, message ?? ctx.site.whatsappMessage);
  return url ? h`<a class="btn wa ${cls}" href="${url}" target="_blank" rel="noopener">${ICON.whatsapp}${label}</a>` : h``;
}

export function instagramUrl(ctx: PageCtx): string | null {
  return ctx.site.instagram ? `https://www.instagram.com/${encodeURIComponent(ctx.site.instagram)}/` : null;
}

export function mapsUrl(ctx: PageCtx): string | null {
  if (ctx.site.mapLat !== null && ctx.site.mapLng !== null) return `https://www.google.com/maps/search/?api=1&query=${ctx.site.mapLat},${ctx.site.mapLng}`;
  if (ctx.site.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ctx.site.address)}`;
  return null;
}

export interface Heading { kicker?: string; title: Raw | string; sub?: Raw | string }

export function headingHtml(ctx: PageCtx, hd: Heading): Raw {
  const inner = h`${hd.kicker ? h`<p class="kicker">${hd.kicker}</p>` : ""}<h1>${hd.title}</h1>${hd.sub ? h`<p class="sub">${hd.sub}</p>` : ""}`;
  return ctx.embed ? inner : h`<section class="hero"><div class="blue-tri" aria-hidden="true"></div><div class="in">${inner}</div></section>`;
}

export interface LayoutOpts {
  title: string;
  description: string;
  body: Raw;
  section?: Section;
  heading?: Heading;
  /** Reemplaza al banner (portada). */
  cover?: Raw;
  /** Ruta canónica (sin dominio). Por defecto, la ruta pedida. */
  canonical?: string;
  jsonLd?: Record<string, unknown>;
  ogImage?: string;
}

/** JSON-LD dentro de <script>: se neutraliza "</" para que ningún dato pueda cerrar la etiqueta. */
const jsonLdTag = (data: Record<string, unknown>) => raw(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);

export function layout(ctx: PageCtx, o: LayoutOpts): string {
  const canonical = `${ctx.origin}${o.canonical ?? ctx.path}`;
  const fullTitle = o.title === ctx.title ? o.title : `${o.title} | ${ctx.title}`;
  const ogImage = `${ctx.origin}${o.ogImage ?? "/brand/icon-512.png"}`;
  const announceActive = ctx.site.announcementText && (!ctx.site.announcementUntil || ctx.site.announcementUntil >= ctx.today);
  const announce = !ctx.embed && announceActive
    ? h`<div class="announce" role="region" aria-label="Aviso">${ctx.site.announcementText}${ctx.site.announcementUrl ? h`<a href="${ctx.site.announcementUrl}"${/^https?:/i.test(ctx.site.announcementUrl) ? raw(' target="_blank" rel="noopener"') : ""}>Ver más</a>` : ""}</div>`
    : "";
  const ig = instagramUrl(ctx);
  const wa = whatsappUrl(ctx.site.whatsapp, ctx.site.whatsappMessage);
  const navItems = NAV.filter((n) => !ctx.hiddenPages.includes(n.href.slice(1))).map((n) => h`<li><a href="${n.href}"${o.section === n.key ? raw(' aria-current="page"') : ""}>${n.label}</a></li>`);
  const page = h`<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${o.description}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${ctx.title}">
<meta property="og:locale" content="es_AR">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${o.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0f5a93">
${ctx.preview ? raw('<meta name="robots" content="noindex, nofollow">') : ""}
<link rel="icon" href="/brand/favicon-64.png" type="image/png">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="preload" href="/pub/fonts/oswald-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/pub/site.css?v=${ctx.assetVersion}">
<script src="/pub/publico.js?v=${ctx.assetVersion}" defer></script>
${o.jsonLd ? jsonLdTag(o.jsonLd) : ""}
</head>
<body class="${ctx.embed ? "embed" : ""}">
${ctx.preview ? h`<div class="preview-bar" role="status">Vista previa · Este contenido todavía no está publicado. Cerrá esta pestaña para volver al panel.</div>` : ""}
${ctx.embed ? h`<div class="stripe" aria-hidden="true"></div>` : h`<a class="skip" href="#contenido">Saltar al contenido</a>
${announce}
<header class="top"><div class="stripe" aria-hidden="true"></div><div class="in">
  <a class="brand" href="/" aria-label="${ctx.title}: inicio"><img src="/brand/padeltime-simbolo.png" alt="" width="42" height="42">${ctx.title === "Padel Time" ? h`PADEL <b>TIME</b>` : ctx.title}</a>
  <nav class="nav nav-d" aria-label="Secciones"><ul>${navItems}</ul></nav>
  <details class="nav nav-m"><summary>Menú</summary><nav aria-label="Secciones"><ul>${navItems}</ul></nav></details>
</div></header>`}
${!ctx.embed ? (o.cover ?? (o.heading ? headingHtml(ctx, o.heading) : "")) : ""}
<main id="contenido">${ctx.embed && o.heading ? headingHtml(ctx, o.heading) : ""}${o.body}</main>
${ctx.embed
  ? h`<footer class="embed"><a href="${canonical.replace(/[?&]embed=1/, "")}" target="_blank" rel="noopener">Ver en ${ctx.title} ↗</a> · Información de sólo lectura, actualizada automáticamente.</footer>`
  : h`<footer class="site"><div class="in">
  <div>
    <a class="brand" href="/"><img src="/brand/padeltime-simbolo.png" alt="" width="42" height="42">PADEL <b>TIME</b></a>
    ${ctx.site.tagline ? h`<p>${ctx.site.tagline}</p>` : ""}
    ${ctx.site.venueName || ctx.site.address ? h`<p>${ctx.site.venueName}${ctx.site.venueName && ctx.site.address ? h`<br>` : ""}${ctx.site.address}</p>` : ""}
  </div>
  <div><h4>Secciones</h4><ul>${NAV.slice(1).filter((n) => !ctx.hiddenPages.includes(n.href.slice(1))).map((n) => h`<li><a href="${n.href}">${n.label}</a></li>`)}</ul></div>
  <div><h4>Contacto</h4><ul>
    ${wa ? h`<li><a href="${wa}" target="_blank" rel="noopener">WhatsApp</a></li>` : ""}
    ${ig ? h`<li><a href="${ig}" target="_blank" rel="noopener">Instagram @${ctx.site.instagram}</a></li>` : ""}
    <li><a href="/contacto">Cómo llegar</a></li>
    <li><a href="/novedades">Novedades</a></li>
  </ul></div>
</div>
<div class="legal"><span>© ${ctx.today.slice(0, 4)} ${ctx.title}. Rankings y resultados actualizados automáticamente.</span><a href="/admin">Acceso organizadores</a></div>
</footer>`}
</body>
</html>`;
  return page.value;
}
