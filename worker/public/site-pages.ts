/**
 * Páginas de la web pública oficial (Fase 7): inicio, torneos, torneo, calendario, contenidos
 * (reglamentos, liga, cancha abierta, premios), contacto, novedades, 404, sitemap y robots.
 * Todo el contenido sale de la base (torneos, rankings, site_pages, site_posts, site_events y ajustes):
 * nada de lo que se ve está escrito en el código, salvo textos de interfaz y estados vacíos.
 */
import { GENDER_LABEL, TOURNAMENT_TYPE_LABEL, type TournamentStatus } from "@shared/constants";
import { parseInline, SERIES, SERIES_LABEL, SERIES_SLUG, tournamentPath, whatsappUrl, type Block, type Series } from "@shared/site";
import { h, raw, type Raw } from "./html";
import { fixtureSection } from "./fixture-pages";
import type { PublicFixture } from "@shared/fixture";
import type { PublicRankingRef, PublicSeason } from "./data";
import {
  fmtDate, fmtDay, fmtLong, fmtMonthShort, fmtMonthYear, fmtPts, fmtRange, ICON, instagramUrl, layout, mapsUrl, waButton,
  type PageCtx,
} from "./layout";
import { rankingName, rankingPath } from "./pages";
import type { EventKind, MediaMap, PublicEvent, PublicPost, PublicResult, PublicSponsor, PublicTeam, PublicTournament, SitePage } from "./site-data";

// ─────────────────────────── Utilidades ───────────────────────────
const STATUS_LABEL: Record<TournamentStatus, string> = { programado: "Próximo", en_curso: "En curso", finalizado: "Finalizado", cancelado: "Cancelado" };
const EVENT_LABEL: Record<EventKind, string> = { cancha_abierta: "Cancha abierta", evento: "Evento", inscripcion: "Inscripción", otro: "Evento" };

const multiGender = (ctx: PageCtx) => ctx.site.activeGenders.length > 1;
const categoryLabel = (ctx: PageCtx, t: Pick<PublicTournament, "categoryName" | "gender" | "divisionName">) =>
  `${t.categoryName}${multiGender(ctx) ? ` ${GENDER_LABEL[t.gender]}` : ""}${t.divisionName ? ` · ${t.divisionName}` : ""}`;

/** Texto plano → párrafos (respeta saltos de línea). */
const paragraphs = (text: string): Raw => h`${text.split(/\n{2,}/).map((p) => h`<p>${p.split("\n").map((l, i) => (i ? h`<br>${l}` : h`${l}`))}</p>`)}`;

/** Texto enriquecido (**negrita**, *cursiva*, [enlace](url)) → HTML seguro: cada parte se escapa. */
const inline = (text: string): Raw => h`${parseInline(text).map((seg) =>
  seg.t === "b" ? h`<strong>${seg.v}</strong>` : seg.t === "i" ? h`<em>${seg.v}</em>`
    : seg.t === "a" ? h`<a href="${seg.href}"${/^https?:/i.test(seg.href) ? raw(' target="_blank" rel="noopener"') : ""}>${seg.v}</a>` : h`${seg.v}`)}`;
const richParagraphs = (text: string): Raw => h`${text.split(/\n{2,}/).map((p) => h`<p>${p.split("\n").map((l, i) => (i ? h`<br>${inline(l)}` : inline(l)))}</p>`)}`;

const fmtSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Descripción para buscadores: primer texto disponible, recortado. */
function describe(blocks: Block[], fallback: string): string {
  for (const b of blocks) {
    const t = b.type === "paragraph" || b.type === "callout" ? b.text : b.type === "steps" ? b.items.map((i) => `${i.title}: ${i.text}`).join(" ") : null;
    if (t) return t.length > 160 ? `${t.slice(0, 157).trimEnd()}…` : t;
  }
  return fallback;
}

const external = (url: string) => /^https?:/i.test(url);

export interface RenderOpts { media?: MediaMap; whatsapp?: string | null; pills?: boolean }

/** Bloques de contenido → HTML (con escape). Mismo modelo que se edita en el panel (Web → Páginas). */
export function renderBlocks(blocks: Block[], opts: RenderOpts = {}): Raw {
  const media = opts.media ?? new Map();
  return h`${blocks.filter((b) => !b.hidden).map((b) => {
    switch (b.type) {
      case "heading": return h`<h2>${b.text}</h2>`;
      case "paragraph": return richParagraphs(b.text);
      case "list": return b.style === "pills" ? h`<ul class="pills">${b.items.map((i) => h`<li>${i}</li>`)}</ul>` : h`<ul class="bul">${b.items.map((i) => h`<li>${inline(i)}</li>`)}</ul>`;
      case "steps": return h`<ol class="steps">${b.items.map((s, i) => h`<li><span class="n" aria-hidden="true">${i + 1}</span><div><b>${s.title}</b><p>${s.text}</p></div></li>`)}</ol>`;
      case "callout": return h`<div class="callout">${inline(b.text)}</div>`;
      case "button": {
        const url = b.url === "whatsapp" ? opts.whatsapp ?? null : b.url;
        if (!url) return h``;
        return h`<p><a class="btn ${b.url === "whatsapp" ? "wa" : "primary"}" href="${url}"${external(url) ? raw(' target="_blank" rel="noopener"') : ""}>${b.url === "whatsapp" ? ICON.whatsapp : ""}${b.label}</a></p>`;
      }
      case "document": {
        const file = b.mediaId ? media.get(b.mediaId) : undefined;
        const url = file?.url ?? b.url;
        if (!url) return h``;
        return h`<a class="doc" href="${url}"${file ? raw(" download") : external(url) ? raw(' target="_blank" rel="noopener"') : ""}>${ICON.doc}<span>${b.label}${file ? h` <small class="nick">PDF · ${fmtSize(file.bytes)}</small>` : ""}</span></a>`;
      }
      case "image": {
        const file = media.get(b.mediaId);
        if (!file) return h``;
        return h`<figure><img src="${file.url}" alt="${b.alt || file.alt || ""}" loading="lazy"${file.width ? h` width="${file.width}" height="${file.height}"` : ""}>${b.caption ? h`<figcaption>${b.caption}</figcaption>` : ""}</figure>`;
      }
      case "gallery": {
        const files = b.mediaIds.map((id) => media.get(id)).filter((f): f is NonNullable<typeof f> => !!f && f.kind === "imagen");
        if (!files.length) return h``;
        return h`<figure><div class="gallery">${files.map((f) => h`<a href="${f.url}" target="_blank" rel="noopener"><img src="${f.url}" alt="${f.alt || ""}" loading="lazy"${f.width ? h` width="${f.width}" height="${f.height}"` : ""}></a>`)}</div>${b.caption ? h`<figcaption>${b.caption}</figcaption>` : ""}</figure>`;
      }
      // El banner y las secciones automáticas sólo existen en el inicio (ver homePage).
      case "hero":
      case "section":
        return h``;
    }
  })}`;
}

function empty(title: string, text: string | Raw, action?: Raw): Raw {
  return h`<div class="card empty"><b>${title}</b>${text}${action ? h`<div class="actions" style="justify-content:center">${action}</div>` : ""}</div>`;
}

/** Bloques opcionales de la introducción de una sección (Torneos, Rankings, Calendario, Novedades). */
export function introBlocks(intro: SitePage | null, opts: RenderOpts = {}): Raw {
  return intro && intro.blocks.some((b) => !b.hidden) ? h`<section class="prose" style="margin-bottom:18px">${renderBlocks(intro.blocks, opts)}</section>` : h``;
}

export function tournamentCard(ctx: PageCtx, t: PublicTournament): Raw {
  return h`<a class="tcard${t.featured ? " featured" : ""}" href="${tournamentPath(t)}">
<div class="when"><div class="date"><b>${fmtDay(t.startDate)}</b><small>${fmtMonthShort(t.startDate)}</small></div>
<div class="meta">${t.series ? h`<span class="badge serie">${SERIES_LABEL[t.series]}</span>` : ""}<span class="badge ${t.status}">${STATUS_LABEL[t.status]}</span>${t.featured ? h`<span class="badge">Destacado</span>` : ""}</div></div>
<div class="body"><h3>${t.name}</h3><p>${categoryLabel(ctx, t)} · ${TOURNAMENT_TYPE_LABEL[t.type]}</p><p>${fmtRange(t.startDate, t.endDate)}${t.venue ? ` · ${t.venue}` : ""}</p></div>
</a>`;
}

const tgrid = (ctx: PageCtx, list: PublicTournament[]) => h`<div class="tgrid">${list.map((t) => tournamentCard(ctx, t))}</div>`;

function venueCard(ctx: PageCtx, opts: { map?: boolean; photoUrl?: string | null } = {}): Raw {
  const s = ctx.site;
  if (!s.venueName && !s.address) return h``;
  const maps = mapsUrl(ctx);
  const ig = instagramUrl(ctx);
  const embed = opts.map && s.mapLat !== null && s.mapLng !== null
    ? h`<iframe class="map" title="Mapa: ${s.venueName || s.address}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${`https://www.google.com/maps?q=${s.mapLat},${s.mapLng}&z=16&output=embed`}"></iframe>`
    : h`<img src="${opts.photoUrl || "/web/sede-las-vias.webp"}" alt="Vista de ${s.venueName || "la sede"}" loading="lazy">`;
  return h`<div class="card venue">${embed}<div class="pad">
<p class="kicker">Sede</p><h3>${s.venueName}</h3>
<p class="sub">${ICON.pin} ${s.address}</p>
<div class="actions">${maps ? h`<a class="btn primary" href="${maps}" target="_blank" rel="noopener">${ICON.pin}Cómo llegar</a>` : ""}${waButton(ctx, "WhatsApp")}${ig ? h`<a class="btn" href="${ig}" target="_blank" rel="noopener">${ICON.instagram}Instagram</a>` : ""}</div>
</div></div>`;
}

// ─────────────────────────── Inicio ───────────────────────────
export interface HomeData {
  page: SitePage | null;
  upcoming: PublicTournament[];
  inProgress: PublicTournament[];
  featured: PublicTournament[];
  all: PublicTournament[];
  posts: PublicPost[];
  season: PublicSeason | null;
  refs: PublicRankingRef[];
  sponsors: PublicSponsor[];
  media: MediaMap;
}

/** Si el inicio no tiene banner o secciones (p. ej., una base anterior), se usan éstos. */
const DEFAULT_HERO: Extract<Block, { type: "hero" }> = {
  type: "hero", title: "Padel Time", subtitle: "", mediaId: null,
  buttons: [{ label: "Inscribite por WhatsApp", url: "whatsapp" }, { label: "Ver torneos", url: "/torneos" }, { label: "Rankings", url: "/rankings" }],
};
const DEFAULT_SECTIONS: Extract<Block, { type: "section" }>[] = [
  { type: "section", kind: "featured_tournament", title: "Próximo torneo destacado" },
  { type: "section", kind: "in_progress", title: "Torneos en curso" },
  { type: "section", kind: "upcoming", title: "Próximos torneos" },
  { type: "section", kind: "featured", title: "Torneos destacados" },
  { type: "section", kind: "news", title: "Últimas novedades" },
  { type: "section", kind: "rankings", title: "Rankings" },
  { type: "section", kind: "sponsors", title: "Patrocinadores" },
  { type: "section", kind: "venue", title: "Dónde jugamos" },
];

function heroHtml(ctx: PageCtx, b: Extract<Block, { type: "hero" }>, media: MediaMap): Raw {
  const img = (b.mediaId && media.get(b.mediaId)?.url) || "/web/portada-jugador.webp";
  const wa = whatsappUrl(ctx.site.whatsapp, ctx.site.whatsappMessage);
  const buttons = b.buttons.map((btn, i) => {
    if (btn.url === "whatsapp") return wa ? h`<a class="btn wa lg" href="${wa}" target="_blank" rel="noopener">${ICON.whatsapp}${btn.label}</a>` : h``;
    return h`<a class="btn ${i === 0 ? "primary" : "light"} lg" href="${btn.url}"${external(btn.url) ? raw(' target="_blank" rel="noopener"') : ""}>${btn.label}</a>`;
  });
  return h`<section class="cover" style="background-image:url(${img})"><div class="in">
<img class="logo" src="/brand/padeltime-simbolo.png" alt="" width="92" height="92">
<h1>${b.title}</h1>
${b.subtitle ? h`<p class="tag">${b.subtitle}</p>` : ""}
${buttons.length ? h`<div class="ctas">${buttons}</div>` : ""}
</div></section>`;
}

function sectionHtml(ctx: PageCtx, b: Extract<Block, { type: "section" }>, d: HomeData): Raw {
  const head = (link?: Raw) => h`<div class="sec-head"><h2>${b.title}</h2>${link ?? ""}</div>`;
  switch (b.kind) {
    case "featured_tournament": {
      const chosen = b.tournamentId ? d.all.find((t) => t.id === b.tournamentId && t.status !== "cancelado" && t.status !== "finalizado") : undefined;
      const t = chosen ?? d.upcoming.find((x) => x.featured) ?? d.upcoming[0];
      if (!t) return h``;
      const cat = categoryLabel(ctx, t);
      return h`<section>${head()}<div class="featured-t"><div><p class="kicker">${[t.series ? SERIES_LABEL[t.series] : null, STATUS_LABEL[t.status]].filter(Boolean).join(" · ")}</p><h3>${t.name}</h3><p>${cat} · ${fmtRange(t.startDate, t.endDate)}${t.venue ? ` · ${t.venue}` : ""}</p></div>
<div class="actions"><a class="btn light lg" href="${tournamentPath(t)}">Ver torneo</a>${t.registrationOpen ? waButton(ctx, "Inscribirme", `Hola! Quiero inscribirme al torneo ${t.name} (${cat}).`, "lg") : ""}</div></div></section>`;
    }
    case "in_progress":
      return d.inProgress.length ? h`<section>${head(h`<a href="/torneos?estado=en-curso">Ver todos</a>`)}${tgrid(ctx, d.inProgress.slice(0, 6))}</section>` : h``;
    case "upcoming":
      return h`<section>${head(h`<a href="/torneos">Ver todos los torneos</a>`)}${d.upcoming.length ? tgrid(ctx, d.upcoming.slice(0, 6)) : empty("Todavía no hay torneos próximos publicados", h`<p>Cuando se programe el próximo torneo vas a verlo acá.</p>`, h`<a class="btn" href="/calendario">Ver calendario</a>${waButton(ctx, "Consultar por WhatsApp")}`)}</section>`;
    case "featured":
      return d.featured.length ? h`<section>${head()}${tgrid(ctx, d.featured.slice(0, 3))}</section>` : h``;
    case "news":
      return h`<section>${head(d.posts.length ? h`<a href="/novedades">Ver todas</a>` : undefined)}${d.posts.length ? newsGrid(d.posts, d.media) : empty("Sin novedades publicadas", h`<p>Las noticias del circuito se publican acá.</p>`)}</section>`;
    case "rankings":
      return h`<section>${head(h`<a href="/rankings">Todos los rankings</a>`)}${d.refs.length ? h`<div class="grid">${d.refs.filter((r) => r.divisionId === null).map((r) => h`<a class="tile" href="${rankingPath(r)}"><b>${rankingName(r, multiGender(ctx))}</b><small>${d.season ? `${d.season.name} · ` : ""}${r.players} jugador${r.players === 1 ? "" : "es"}</small></a>`)}</div>` : empty("Rankings en preparación", h`<p>Los rankings aparecen en cuanto se cargan puntos de la temporada.</p>`)}</section>`;
    case "sponsors":
      return d.sponsors.length ? h`<section>${head()}${sponsorsGrid(d.sponsors, d.media)}</section>` : h``;
    case "venue":
      return h`<section>${head(h`<a href="/contacto">Contacto e inscripciones</a>`)}${venueCard(ctx, { photoUrl: ctx.site.venueMediaId ? d.media.get(ctx.site.venueMediaId)?.url : null })}</section>`;
  }
}

export function sponsorsGrid(list: PublicSponsor[], media: MediaMap): Raw {
  return h`<div class="sponsors">${list.map((s) => {
    const logo = media.get(s.mediaId);
    const img = logo ? h`<img src="${logo.url}" alt="${s.name}" loading="lazy">` : h`<b>${s.name}</b>`;
    return s.url ? h`<a href="${s.url}" target="_blank" rel="noopener sponsored" title="${s.name}">${img}</a>` : h`<span title="${s.name}">${img}</span>`;
  })}</div>`;
}

function newsGrid(posts: PublicPost[], media: MediaMap): Raw {
  return h`<div class="tgrid">${posts.map((p) => {
    const cover = p.coverMediaId ? media.get(p.coverMediaId) : undefined;
    return h`<a class="tcard" href="/novedades/${p.slug}">${cover ? h`<img src="${cover.url}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block">` : ""}<div class="body"><p class="kicker">${fmtDate(p.publishedAt)}</p><h3>${p.title}</h3>${p.excerpt ? h`<p>${p.excerpt}</p>` : ""}</div></a>`;
  })}</div>`;
}

export function homePage(ctx: PageCtx, d: HomeData): string {
  const blocks = (d.page?.blocks ?? []).filter((b) => !b.hidden);
  const all = d.page?.blocks ?? [];
  const opts: RenderOpts = { media: d.media, whatsapp: whatsappUrl(ctx.site.whatsapp, ctx.site.whatsappMessage), pills: true };
  const heroBlock = (all.find((b) => b.type === "hero") as Extract<Block, { type: "hero" }> | undefined);
  // Banner: el configurado (si está oculto, no se muestra); si no hay ninguno, el predeterminado.
  const cover = heroBlock ? (heroBlock.hidden ? h`` : heroHtml(ctx, heroBlock, d.media)) : heroHtml(ctx, { ...DEFAULT_HERO, subtitle: ctx.site.tagline }, d.media);
  const parts: Raw[] = [];
  let buffer: Block[] = [];
  const flush = () => {
    if (buffer.length) parts.push(h`<section class="prose" aria-label="Información">${renderBlocks(buffer, opts)}</section>`);
    buffer = [];
  };
  for (const b of blocks) {
    if (b.type === "hero") continue;
    if (b.type === "section") {
      flush();
      parts.push(sectionHtml(ctx, b, d));
    } else buffer.push(b);
  }
  flush();
  if (!all.some((b) => b.type === "section")) for (const sct of DEFAULT_SECTIONS) parts.push(sectionHtml(ctx, sct, d));
  const tagline = heroBlock?.subtitle || ctx.site.tagline;
  const ig = instagramUrl(ctx);
  return layout(ctx, {
    title: ctx.title, section: "inicio", cover, body: h`${parts}`, canonical: "/",
    description: d.page?.seoDescription || (d.page ? describe(d.page.blocks, `${ctx.title}: ${tagline}`) : `${ctx.title}: ${tagline}. Torneos, rankings y calendario.`),
    ogImage: (heroBlock?.mediaId && d.media.get(heroBlock.mediaId)?.url) || "/web/portada-jugador.webp",
    jsonLd: {
      "@context": "https://schema.org", "@type": "SportsOrganization", name: ctx.title, sport: "Padel", url: `${ctx.origin}/`,
      logo: `${ctx.origin}/brand/icon-512.png`, ...(ig ? { sameAs: [ig] } : {}),
      ...(ctx.site.address ? { address: { "@type": "PostalAddress", streetAddress: ctx.site.address, addressCountry: "AR" } } : {}),
    },
  });
}

// ─────────────────────────── Torneos ───────────────────────────
export const TOURNAMENT_TABS = [
  { key: "proximos", label: "Próximos" },
  { key: "en-curso", label: "En curso" },
  { key: "finalizados", label: "Finalizados" },
  { key: "historial", label: "Historial por temporada" },
] as const;
export type TournamentTab = (typeof TOURNAMENT_TABS)[number]["key"];

export interface TournamentFilters { tab: TournamentTab; seasonId: number | null; categoryId: number | null; series: Series | null }

export function tournamentsPage(ctx: PageCtx, all: PublicTournament[], list: PublicTournament[], f: TournamentFilters, intro: SitePage | null = null, opts: RenderOpts = {}): string {
  const qs = (over: Partial<Record<string, string | null>>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = {
      estado: f.tab === "proximos" ? null : f.tab,
      temporada: f.seasonId ? String(f.seasonId) : null,
      categoria: f.categoryId ? String(f.categoryId) : null,
      modalidad: f.series ? SERIES_SLUG[f.series] : null,
      ...over,
    };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/torneos?${s}` : "/torneos";
  };
  const seasons = [...new Map(all.map((t) => [t.seasonId, { id: t.seasonId, name: t.seasonName, year: t.seasonYear }])).values()].sort((a, b) => b.year - a.year || b.id - a.id);
  const categories = [...new Map(all.map((t) => [t.categoryId, { id: t.categoryId, label: `${t.categoryName}${multiGender(ctx) ? ` ${GENDER_LABEL[t.gender]}` : ""}` }])).values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
  const usedSeries = SERIES.filter((s) => all.some((t) => t.series === s));
  const anyFilter = f.seasonId || f.categoryId || f.series;
  const emptyText: Record<TournamentTab, [string, string]> = {
    proximos: ["No hay torneos próximos publicados", "Mirá los torneos en curso o el calendario."],
    "en-curso": ["No hay torneos en curso", "Mirá los próximos torneos o los ya finalizados."],
    finalizados: ["Todavía no hay torneos finalizados publicados", "Los resultados aparecen acá cuando termina cada torneo."],
    historial: ["No hay torneos publicados", "Los torneos aparecen acá cuando los organizadores los publican."],
  };
  let results: Raw;
  if (!list.length) {
    const [t, x] = emptyText[f.tab];
    results = empty(anyFilter ? "Ningún torneo coincide con los filtros" : t, h`<p>${anyFilter ? "Probá con otros filtros." : x}</p>`, anyFilter ? h`<a class="btn" href="${qs({ temporada: null, categoria: null, modalidad: null })}">Quitar filtros</a>` : undefined);
  } else if (f.tab === "historial") {
    const bySeason = new Map<number, PublicTournament[]>();
    for (const t of list) bySeason.set(t.seasonId, [...(bySeason.get(t.seasonId) ?? []), t]);
    results = h`${[...bySeason.values()].map((ts) => h`<h2>${ts[0]!.seasonName}</h2>${tgrid(ctx, [...ts].sort((a, b) => a.startDate.localeCompare(b.startDate)))}`)}`;
  } else {
    results = tgrid(ctx, list);
  }
  const body = h`${introBlocks(intro, opts)}
<nav class="chips" aria-label="Estado de los torneos">${TOURNAMENT_TABS.map((t) => h`<a class="chip${f.tab === t.key ? " on" : ""}" href="${qs({ estado: t.key === "proximos" ? null : t.key })}"${f.tab === t.key ? raw(' aria-current="page"') : ""}>${t.label}</a>`)}</nav>
${all.length ? h`<form class="tools" method="get" action="/torneos" role="search" aria-label="Filtrar torneos">
  ${f.tab !== "proximos" ? h`<input type="hidden" name="estado" value="${f.tab}">` : ""}
  <select name="temporada" aria-label="Temporada" data-autosubmit><option value="">Todas las temporadas</option>${seasons.map((s) => h`<option value="${s.id}"${f.seasonId === s.id ? raw(" selected") : ""}>${s.name}</option>`)}</select>
  <select name="categoria" aria-label="Categoría" data-autosubmit><option value="">Todas las categorías</option>${categories.map((c) => h`<option value="${c.id}"${f.categoryId === c.id ? raw(" selected") : ""}>${c.label}</option>`)}</select>
  <select name="modalidad" aria-label="Modalidad" data-autosubmit><option value="">Todas las modalidades</option>${usedSeries.map((s) => h`<option value="${SERIES_SLUG[s]}"${f.series === s ? raw(" selected") : ""}>${SERIES_LABEL[s]}</option>`)}</select>
  <button class="btn primary" type="submit" data-autosubmit-btn>Filtrar</button>
</form>` : ""}
${results}
`;
  const tabLabel = TOURNAMENT_TABS.find((t) => t.key === f.tab)!.label;
  return layout(ctx, {
    title: f.tab === "proximos" ? "Torneos" : `Torneos: ${tabLabel.toLowerCase()}`, section: "torneos", body,
    canonical: f.tab === "proximos" && !anyFilter ? "/torneos" : qs({}),
    description: intro?.seoDescription || intro?.summary || `Torneos de ${ctx.title}: próximos, en curso y finalizados, con información, resultados e inscripción.`,
    heading: { kicker: ctx.title, title: intro?.title ?? "Torneos", sub: intro?.summary ?? undefined },
  });
}

function resultsTable(results: PublicResult[]): Raw {
  return h`<div class="card scroll-x"><table>
<thead><tr><th>Instancia</th><th>Pareja</th><th class="num">Puntos</th></tr></thead>
<tbody>${results.map((r) => h`<tr class="${r.stageRank === 1 ? "p1" : r.stageRank === 2 ? "p2" : ""}"><td><b>${r.stageLabel}</b></td><td>${r.players.join(" / ")}</td><td class="num pts">${fmtPts(r.points)}</td></tr>`)}</tbody>
</table></div><p class="note">Puntos que suma cada integrante al ranking de su categoría.</p>`;
}

export function tournamentPage(
  ctx: PageCtx, t: PublicTournament, data: { teams: PublicTeam[]; results: PublicResult[] },
  extra: { fixture?: { data: PublicFixture; publishedAt: string } | null; siblings?: PublicTournament[] } = {},
): string {
  const siblings = (extra.siblings ?? []).filter((x) => x.id !== t.id);
  const cat = categoryLabel(ctx, t);
  const canRegister = t.registrationOpen && (t.status === "programado" || t.status === "en_curso");
  const message = `Hola! Quiero inscribirme al torneo ${t.name} (${cat}).`;
  let resultsHtml: Raw;
  if (t.status === "cancelado") resultsHtml = empty("Torneo cancelado", h`<p>Este torneo fue cancelado y no otorga puntos.</p>`);
  else if (t.credited && data.results.length) resultsHtml = h`<h2>Resultado final</h2>${resultsTable(data.results)}`;
  // Con fixture publicado, las parejas y resultados se ven ahí (no se repiten en otra lista).
  else if (extra.fixture) resultsHtml = h``;
  else if (data.teams.length) {
    resultsHtml = h`<h2>Parejas inscriptas (${data.teams.length})</h2><div class="card list">${data.teams.map((tm) => h`<div class="row" style="display:block;padding:11px 16px;border-bottom:1px solid var(--line)">${tm.players.join(" / ") || "Pareja a confirmar"}</div>`)}</div>
${t.status === "finalizado" ? h`<p class="note">El resultado final se publica cuando se acreditan los puntos.</p>` : ""}`;
  } else resultsHtml = h`<h2>Resultados</h2>${empty("Todavía no hay resultados", h`<p>${t.status === "programado" ? "El torneo todavía no empezó." : "Los resultados se publican al finalizar el torneo."}</p>`)}`;

  const body = h`<div class="two">
<div>
  <div class="card pad"><dl class="kv">
    <dt>Fechas</dt><dd>${t.startDate === t.endDate ? fmtLong(t.startDate) : fmtRange(t.startDate, t.endDate)}</dd>
    <dt>Categoría</dt><dd>${cat}</dd>
    ${t.series ? h`<dt>Modalidad</dt><dd>${SERIES_LABEL[t.series]}</dd>` : ""}
    <dt>Formato</dt><dd>${TOURNAMENT_TYPE_LABEL[t.type]}</dd>
    ${t.venue ? h`<dt>Sede</dt><dd>${t.venue}</dd>` : ""}
    <dt>Estado</dt><dd><span class="badge ${t.status}">${STATUS_LABEL[t.status]}</span></dd>
  </dl></div>
  ${t.description ? h`<h2>Información</h2><div class="prose">${paragraphs(t.description)}</div>` : ""}
  ${t.prizeInfo ? h`<h2>Premios</h2><div class="card pad prose">${paragraphs(t.prizeInfo)}</div>` : ""}
  ${resultsHtml}
</div>
<aside>
  <div class="card pad">
    <h3>Inscripción</h3>
    ${canRegister ? h`<p class="sub">Escribinos por WhatsApp con los nombres de la pareja.</p><div class="actions">${waButton(ctx, "Inscribirme", message, "lg")}</div>`
      : h`<p class="sub">${t.status === "finalizado" || t.status === "cancelado" ? "Este torneo ya no admite inscripciones." : "La inscripción todavía no está abierta. Consultanos por WhatsApp."}</p>${t.status === "programado" ? h`<div class="actions">${waButton(ctx, "Consultar", `Hola! Quiero consultar por el torneo ${t.name} (${cat}).`)}</div>` : ""}`}
  </div>
  <div class="card pad" style="margin-top:14px">
    <h3>Ranking</h3>
    <p class="sub">Los puntos de este torneo suman al ranking ${t.seasonName}.</p>
    <div class="actions"><a class="btn" href="${rankingPath({ seasonId: t.seasonId, categoryId: t.categoryId, divisionId: null })}">Ver ranking ${t.categoryName}</a></div>
  </div>
  ${t.eventName && siblings.length ? h`<div class="card pad" style="margin-top:14px">
    <h3>${t.eventName}</h3>
    <p class="sub">Otras categorías de este evento:</p>
    <div class="chips">${siblings.map((x) => h`<a class="chip" href="${tournamentPath(x)}">${categoryLabel(ctx, x)}</a>`)}</div>
  </div>` : ""}
  <p class="note"><a href="/torneos">← Volver a torneos</a></p>
</aside>
</div>
${extra.fixture ? fixtureSection(extra.fixture.data, extra.fixture.publishedAt) : ""}`;
  const location = ctx.site.venueName || t.venue
    ? { "@type": "Place", name: t.venue || ctx.site.venueName, ...(ctx.site.address ? { address: ctx.site.address } : {}) }
    : undefined;
  return layout(ctx, {
    title: `${t.name} — ${cat}`, section: "torneos", body, canonical: tournamentPath(t),
    description: `${t.name}: ${cat}, ${fmtRange(t.startDate, t.endDate)}${t.venue ? `, ${t.venue}` : ""}. ${STATUS_LABEL[t.status]}.`,
    heading: { kicker: [t.series ? SERIES_LABEL[t.series] : null, t.seasonName].filter(Boolean).join(" · "), title: t.name, sub: `${cat} · ${fmtRange(t.startDate, t.endDate)}` },
    jsonLd: {
      "@context": "https://schema.org", "@type": "SportsEvent", name: t.name, sport: "Padel", startDate: t.startDate, endDate: t.endDate,
      eventStatus: t.status === "cancelado" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
      url: `${ctx.origin}${tournamentPath(t)}`, ...(location ? { location } : {}),
      organizer: { "@type": "SportsOrganization", name: ctx.title, url: `${ctx.origin}/` },
    },
  });
}

// ─────────────────────────── Calendario ───────────────────────────
interface CalItem { date: string; endDate: string; title: string; href: string | null; kind: string; label: string; time: string | null }

export function calendarPage(ctx: PageCtx, month: string, tournaments: PublicTournament[], events: PublicEvent[], intro: SitePage | null = null, opts: RenderOpts = {}): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const items: CalItem[] = [
    ...tournaments.map((t) => ({ date: t.startDate, endDate: t.endDate, title: t.name, href: tournamentPath(t), kind: `t-${t.status}`, label: `${categoryLabel(ctx, t)}${t.series ? ` · ${SERIES_LABEL[t.series]}` : ""}`, time: null })),
    ...events.map((e) => ({ date: e.startsOn, endDate: e.endsOn ?? e.startsOn, title: e.title, href: null, kind: e.kind, label: [EVENT_LABEL[e.kind], e.location].filter(Boolean).join(" · "), time: e.startTime })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "es"));
  // En la grilla, cada ítem aparece el día que empieza (y el día que termina, si es otro día del mes).
  const byDay = new Map<string, { item: CalItem; end: boolean }[]>();
  for (const it of items) {
    if (it.date >= first && it.date <= last) byDay.set(it.date, [...(byDay.get(it.date) ?? []), { item: it, end: false }]);
    if (it.endDate !== it.date && it.endDate >= first && it.endDate <= last) byDay.set(it.endDate, [...(byDay.get(it.endDate) ?? []), { item: it, end: true }]);
  }
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const chip = (x: { item: CalItem; end: boolean }) => {
    const text = `${x.item.time ? `${x.item.time} ` : ""}${x.item.title}${x.end ? " (final)" : ""}`;
    return x.item.href ? h`<a class="ev ${x.item.kind}" href="${x.item.href}" title="${text}">${text}</a>` : h`<span class="ev ${x.item.kind}" title="${text}">${text}</span>`;
  };
  const body = h`${introBlocks(intro, opts)}
<div class="cal-nav"><a class="btn" href="/calendario?mes=${prev}" rel="nofollow">← <span class="hide-sm">Anterior</span></a><b>${fmtMonthYear(first)}</b><a class="btn" href="/calendario?mes=${next}" rel="nofollow"><span class="hide-sm">Siguiente</span> →</a></div>
<div class="cal-desktop"><table class="cal" aria-label="Calendario de ${fmtMonthYear(first)}">
<thead><tr>${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => h`<th scope="col">${d}</th>`)}</tr></thead>
<tbody>${weeks.map((w) => h`<tr>${w.map((d) => (d ? h`<td class="${d === ctx.today ? "today" : ""}"><span class="d">${fmtDay(d)}</span>${(byDay.get(d) ?? []).map(chip)}</td>` : h`<td class="out"></td>`))}</tr>`)}</tbody>
</table></div>
<h2>Agenda de ${fmtMonthYear(first)}</h2>
${items.length ? h`<div class="card agenda">${items.map((it) => {
    const inner = h`<span class="dd">${fmtDay(it.date)} ${fmtMonthShort(it.date)}${it.endDate !== it.date ? h`<br><small>al ${fmtDay(it.endDate)} ${fmtMonthShort(it.endDate)}</small>` : ""}</span><span><b>${it.time ? `${it.time} · ` : ""}${it.title}</b><br><small class="nick">${it.label}</small></span>`;
    return it.href ? h`<a class="row" href="${it.href}">${inner}</a>` : h`<div class="row">${inner}</div>`;
  })}</div>` : empty("No hay actividades publicadas este mes", h`<p>Torneos, canchas abiertas y eventos aparecen acá cuando se publican.</p>`, h`<a class="btn" href="/calendario?mes=${next}" rel="nofollow">Ver el mes siguiente</a>`)}
`;
  return layout(ctx, {
    title: `Calendario ${fmtMonthYear(first)}`, section: "calendario", body, canonical: month === ctx.today.slice(0, 7) ? "/calendario" : `/calendario?mes=${month}`,
    description: `Calendario de ${ctx.title}: torneos, canchas abiertas y eventos de ${fmtMonthYear(first)}.`,
    heading: { kicker: ctx.title, title: intro?.title ?? "Calendario", sub: intro?.summary ?? undefined },
  });
}

// ─────────────────────────── Páginas de contenido ───────────────────────────
export function contentPage(ctx: PageCtx, page: SitePage, section: "reglamentos" | "liga" | "cancha-abierta" | "premios", extra: Raw, opts: { print?: boolean; sub?: string } & RenderOpts = {}): string {
  const body = h`<div class="two">
<article class="prose">${page.blocks.length ? renderBlocks(page.blocks, opts) : ""}${opts.print ? h`<p class="no-print"><button class="btn" type="button" data-print hidden>${ICON.doc}Imprimir o guardar en PDF</button></p>` : ""}</article>
<aside>${extra}</aside>
</div>`;
  return layout(ctx, {
    title: page.seoTitle || page.title, section, body, canonical: `/${page.slug}`,
    description: page.seoDescription || page.summary || describe(page.blocks, `${page.title} · ${ctx.title}`),
    heading: { kicker: ctx.title, title: page.title, sub: opts.sub ?? page.summary ?? undefined },
  });
}

export function sideLinks(links: { label: string; href: string }[]): Raw {
  return h`<div class="card list">${links.map((l) => h`<a class="row" href="${l.href}"><span>${l.label}</span><span aria-hidden="true">→</span></a>`)}</div>`;
}

export function eventsList(events: PublicEvent[], emptyTitle: string, emptyText: string, action?: Raw): Raw {
  if (!events.length) return empty(emptyTitle, h`<p>${emptyText}</p>`, action);
  return h`<div class="card agenda">${events.map((e) => h`<div class="row"><span class="dd">${fmtDay(e.startsOn)} ${fmtMonthShort(e.startsOn)}</span><span><b>${e.startTime ? `${e.startTime} · ` : ""}${e.title}</b>${e.location ? h`<br><small class="nick">${e.location}</small>` : ""}${e.description ? h`<br><small>${e.description}</small>` : ""}</span></div>`)}</div>`;
}

export function prizesList(ctx: PageCtx, list: PublicTournament[]): Raw {
  if (!list.length) return empty("Premios por torneo", h`<p>Los premios de cada torneo se informan en su página.</p>`, h`<a class="btn" href="/torneos">Ver torneos</a>`);
  return h`${list.map((t) => h`<div class="card pad" style="margin-bottom:12px"><p class="kicker">${STATUS_LABEL[t.status]} · ${fmtRange(t.startDate, t.endDate)}</p><h3><a href="${tournamentPath(t)}">${t.name}</a></h3><p class="nick">${categoryLabel(ctx, t)}</p><div class="prose">${paragraphs(t.prizeInfo ?? "")}</div></div>`)}`;
}

// ─────────────────────────── Contacto ───────────────────────────
export function contactPage(ctx: PageCtx, page: SitePage | null, opts: RenderOpts = {}): string {
  const ig = instagramUrl(ctx);
  const body = h`
${page && page.blocks.length ? h`<div class="prose">${renderBlocks(page.blocks, opts)}</div>` : ""}
<div class="two">
  <div>${ctx.site.venueName || ctx.site.address ? venueCard(ctx, { map: true, photoUrl: ctx.site.venueMediaId ? opts.media?.get(ctx.site.venueMediaId)?.url : null }) : empty("Sede a confirmar", h`<p>Pronto vas a encontrar acá la ubicación.</p>`)}</div>
  <aside>
    <div class="card pad">
      <h3>Inscripciones</h3>
      <p class="sub">Elegí el torneo en <a href="/torneos">Torneos</a> y tocá <b>Inscribirme</b>: se abre WhatsApp con el mensaje listo. También podés escribirnos directamente.</p>
      <div class="actions">${waButton(ctx, "Escribir por WhatsApp", undefined, "lg")}</div>
    </div>
    <div class="card pad" style="margin-top:14px">
      <h3>Redes</h3>
      ${ig ? h`<div class="actions"><a class="btn" href="${ig}" target="_blank" rel="noopener">${ICON.instagram}@${ctx.site.instagram}</a></div>` : h`<p class="sub">Próximamente.</p>`}
    </div>
  </aside>
</div>`;
  return layout(ctx, {
    title: page?.title ?? "Contacto e inscripciones", section: "contacto", body, canonical: "/contacto",
    description: `Contacto e inscripciones de ${ctx.title}${ctx.site.venueName ? `: ${ctx.site.venueName}` : ""}${ctx.site.address ? `, ${ctx.site.address}` : ""}.`,
    heading: { kicker: ctx.title, title: page?.title ?? "Contacto e inscripciones", sub: page?.summary ?? undefined },
  });
}

// ─────────────────────────── Novedades ───────────────────────────
export function newsListPage(ctx: PageCtx, posts: PublicPost[], intro: SitePage | null = null, opts: RenderOpts = {}): string {
  const body = h`${introBlocks(intro, opts)}${posts.length
    ? newsGrid(posts, opts.media ?? new Map())
    : empty("Sin novedades publicadas", h`<p>Las noticias del circuito se publican acá.</p>`, h`<a class="btn" href="/torneos">Ver torneos</a>`)}`;
  return layout(ctx, { title: intro?.title ?? "Novedades", section: "novedades", body, canonical: "/novedades", description: intro?.summary || `Novedades del circuito ${ctx.title}.`, heading: { kicker: ctx.title, title: intro?.title ?? "Novedades", sub: intro?.summary ?? undefined } });
}

export function newsPage(ctx: PageCtx, p: PublicPost, opts: RenderOpts = {}): string {
  const cover = p.coverMediaId ? opts.media?.get(p.coverMediaId) : undefined;
  const body = h`<article class="prose" style="max-width:760px">${cover ? h`<figure><img src="${cover.url}" alt="${cover.alt || ""}"${cover.width ? h` width="${cover.width}" height="${cover.height}"` : ""}></figure>` : ""}${p.excerpt ? h`<p class="sub">${p.excerpt}</p>` : ""}${renderBlocks(p.blocks, opts)}</article><p class="note"><a href="/novedades">← Todas las novedades</a></p>`;
  return layout(ctx, { title: p.title, section: "novedades", body, canonical: `/novedades/${p.slug}`, description: p.excerpt || describe(p.blocks, p.title), heading: { kicker: fmtDate(p.publishedAt), title: p.title }, ogImage: cover?.url });
}

// ─────────────────────────── 404 ───────────────────────────
export function notFoundPage(ctx: PageCtx, title = "Página no encontrada", message = "La dirección no corresponde a ninguna página de la web."): string {
  const body = h`${empty(title, h`<p>${message}</p>`, h`<a class="btn primary" href="/">Ir al inicio</a><a class="btn" href="/torneos">Torneos</a><a class="btn" href="/rankings">Rankings</a>`)}`;
  return layout(ctx, { title, description: message, body, heading: { title: "Error 404", sub: title } });
}

// ─────────────────────────── Sitemap y robots ───────────────────────────
export function sitemapXml(origin: string, entries: { path: string; lastmod?: string }[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map((e) => `  <url><loc>${esc(origin + e.path)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : ""}</url>`)
    .join("\n")}\n</urlset>\n`;
}

export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /*?embed=1\nSitemap: ${origin}/sitemap.xml\n`;
}
