import { GENDER_LABEL, TIEBREAKER_LABEL } from "@shared/constants";
import { h, raw } from "./html";
import type { PublicPlayer, PublicPlayerHit, PublicRanking, PublicRankingRef, PublicSeason } from "./data";
import { fmtDate, fmtDateTime, fmtPts, layout, type PageCtx } from "./layout";
import type { SitePage } from "./site-data";
import { introBlocks, type RenderOpts } from "./site-pages";

export type { PageCtx } from "./layout";

/** Conserva el modo incrustado al navegar dentro del iframe. */
export const withEmbed = (path: string, ctx: PageCtx, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams(extra);
  if (ctx.embed) params.set("embed", "1");
  const q = params.toString();
  return q ? `${path}?${q}` : path;
};

/** Ruta de un ranking. `base` = /rankings (principal) o /publico (enlaces ya pegados en Google Sites). */
export const rankingPath = (r: { seasonId: number; categoryId: number; divisionId: number | null }, seasonParam?: string, base: PageCtx["base"] = "/rankings") =>
  `${base === "/publico" ? "/publico/ranking" : "/rankings"}/${seasonParam ?? r.seasonId}/${r.categoryId}${r.divisionId ? `/${r.divisionId}` : ""}`;

/** Ruta canónica: siempre bajo /rankings, aunque se haya entrado por /publico. */
const canonicalOf = (path: string) => path.replace(/^\/publico\/ranking\//, "/rankings/").replace(/^\/publico(?=\/|$)/, "/rankings");

export const rankingName = (r: { categoryName: string; gender: keyof typeof GENDER_LABEL; divisionName: string | null }, showGender = true) =>
  `${r.categoryName}${showGender ? ` ${GENDER_LABEL[r.gender]}` : ""}${r.divisionName ? ` · División ${r.divisionName}` : ""}`;

/** Con una sola rama activa no hace falta aclarar "Caballeros" en cada título. */
const showGender = (ctx: PageCtx) => ctx.site.activeGenders.length > 1;

// ─────────────────────────── Índice ───────────────────────────
export function indexPage(ctx: PageCtx, seasons: { season: PublicSeason; refs: PublicRankingRef[] }[], intro: SitePage | null = null, opts: RenderOpts = {}): string {
  const body = h`${intro ? introBlocks(intro, opts) : ""}
${ctx.showHistory ? h`<form class="tools" action="${ctx.base}/jugadores" method="get">
  <input type="search" name="q" placeholder="Buscar jugador por nombre o apellido" aria-label="Buscar jugador" minlength="2">
  ${ctx.embed ? h`<input type="hidden" name="embed" value="1">` : ""}
  <button class="btn primary" type="submit">Buscar</button>
</form>` : ""}
${seasons.length === 0 ? h`<div class="card empty"><b>Todavía no hay rankings publicados</b>Los rankings aparecen acá en cuanto se cargan puntos de la temporada.</div>` : ""}
${seasons.map(({ season, refs }) => h`
<h2>${season.name}${season.status === "activa" ? h` <span class="badge">En curso</span>` : ""}</h2>
${refs.length === 0 ? h`<div class="card empty">Sin puntos cargados todavía.</div>` : h`<div class="grid">
${refs.map((r) => h`<a class="tile" href="${withEmbed(rankingPath(r, undefined, ctx.base), ctx)}"><b>${rankingName(r, showGender(ctx))}</b><small>${r.players} jugador${r.players === 1 ? "" : "es"}</small></a>`)}
</div>`}`)}
`;
  return layout(ctx, {
    title: "Rankings", section: "rankings", canonical: canonicalOf(ctx.path), body,
    description: `Rankings oficiales de ${ctx.title} por temporada y categoría, actualizados automáticamente al acreditar cada torneo.`,
    heading: { kicker: ctx.title, title: intro?.title ?? "Rankings", sub: intro?.summary ?? undefined },
  });
}

// ─────────────────────────── Ranking ───────────────────────────
export function rankingPage(ctx: PageCtx, data: PublicRanking, siblings: PublicRankingRef[], opts: { seasonParam: string; query: string }): string {
  const name = rankingName({ categoryName: data.category.name, gender: data.category.gender, divisionName: data.division?.name ?? null }, showGender(ctx));
  const path = rankingPath({ seasonId: data.season.id, categoryId: data.category.id, divisionId: data.division?.id ?? null }, opts.seasonParam, ctx.base);
  const q = opts.query.trim().toLowerCase();
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const showTournaments = data.rows.some((r) => r.tournaments > 0);
  const rows = data.rows.map((r) => {
    const fullName = `${r.firstName} ${r.lastName}`;
    const hidden = q && !norm(`${fullName} ${r.nickname ?? ""}`).includes(norm(q));
    return h`<tr class="${r.position <= 3 ? `p${r.position}` : ""}" data-name="${norm(`${fullName} ${r.nickname ?? ""}`)}"${hidden ? raw(" hidden") : ""}>
<td class="pos"><span>${r.position}${r.tied ? "=" : ""}</span></td>
<td>${ctx.showHistory ? h`<a href="${withEmbed(`${ctx.base}/jugador/${r.code}`, ctx)}">${r.lastName}, ${r.firstName}</a>` : h`${r.lastName}, ${r.firstName}`}${r.nickname ? h` <span class="nick">“${r.nickname}”</span>` : ""}</td>
${showTournaments ? h`<td class="num hide-sm">${r.tournaments}</td>` : ""}
<td class="num pts">${fmtPts(r.points)}</td>
</tr>`;
  });
  const sameGender = siblings.filter((s) => s.gender === data.category.gender);
  const body = h`
${!ctx.embed && sameGender.length > 1 ? h`<nav class="chips" aria-label="Otras categorías">
${sameGender.map((s) => {
  const on = s.categoryId === data.category.id && (s.divisionId ?? null) === (data.division?.id ?? null);
  return h`<a class="chip${on ? " on" : ""}" href="${withEmbed(rankingPath(s, opts.seasonParam, ctx.base), ctx)}">${s.categoryName}${s.divisionName ? ` ${s.divisionName}` : ""}</a>`;
})}
</nav>` : ""}
<form class="tools" method="get" action="${path}" role="search">
  <input type="search" name="buscar" value="${opts.query}" placeholder="Filtrar por nombre" aria-label="Filtrar por nombre" data-filter="ranking">
  ${ctx.embed ? h`<input type="hidden" name="embed" value="1">` : ""}
  <a class="btn xls" href="${path}?descargar=xlsx" target="_blank" rel="noopener" download>Excel</a>
  <a class="btn hide-sm" href="${path}?descargar=csv" target="_blank" rel="noopener" download>CSV</a>
</form>
<div class="card scroll-x">
${data.rows.length === 0 ? h`<div class="empty"><b>Sin puntos todavía</b>Este ranking se completa a medida que se acreditan los torneos.</div>` : h`<table id="ranking">
<thead><tr><th class="pos">Pos.</th><th>Jugador</th>${showTournaments ? h`<th class="num hide-sm">Torneos</th>` : ""}<th class="num">Puntos</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="empty" data-empty hidden>Ningún jugador coincide con la búsqueda.</div>`}
</div>
<p class="note">Desempate: puntos${data.season.tiebreakers.map((t) => `, ${TIEBREAKER_LABEL[t].toLowerCase()}`).join("")}. “=” indica posición compartida.</p>
`;
  return layout(ctx, {
    title: `Ranking ${name} — ${data.season.name}`, body, section: "rankings", canonical: canonicalOf(path),
    description: `Ranking ${name} de la ${data.season.name} de ${ctx.title}: posiciones y puntos de cada jugador, actualizados automáticamente.`,
    heading: { kicker: data.season.name, title: `Ranking ${name}`, sub: data.lastUpdate ? `Última actualización: ${fmtDateTime(data.lastUpdate)}` : "Todavía sin puntos" },
  });
}

// ─────────────────────────── Jugadores ───────────────────────────
export function searchPage(ctx: PageCtx, query: string, hits: PublicPlayerHit[]): string {
  const body = h`
<form class="tools" action="${ctx.base}/jugadores" method="get" role="search">
  <input type="search" name="q" value="${query}" placeholder="Nombre, apellido o apodo" aria-label="Nombre, apellido o apodo" autofocus minlength="2">
  ${ctx.embed ? h`<input type="hidden" name="embed" value="1">` : ""}
  <button class="btn primary" type="submit">Buscar</button>
</form>
${query.trim().length < 2 ? "" : hits.length === 0 ? h`<div class="card empty">No encontramos jugadores con “${query}”.</div>` : h`
<div class="card list">${hits.map((p) => h`<a class="row" href="${withEmbed(`${ctx.base}/jugador/${p.code}`, ctx)}"><span><b>${p.lastName}, ${p.firstName}</b>${p.nickname ? h` <span class="nick">“${p.nickname}”</span>` : ""}</span><span class="nick">${p.categoryName}${showGender(ctx) ? ` ${GENDER_LABEL[p.gender]}` : ""}</span></a>`)}</div>
${hits.length >= 40 ? h`<p class="note">Se muestran los primeros 40 resultados. Escribí más letras para afinar la búsqueda.</p>` : ""}`}
`;
  return layout(ctx, { title: query ? `Buscar “${query}”` : "Buscar jugador", body, section: "rankings", canonical: canonicalOf(ctx.path.split("?")[0]!),
    description: `Buscá a cualquier jugador con puntos en los rankings de ${ctx.title} y consultá su historial.`, heading: { kicker: ctx.title, title: "Buscar jugador", sub: "Consultá los puntos y el historial de cualquier jugador con puntos en el ranking." } });
}

export function playerPage(ctx: PageCtx, p: PublicPlayer): string {
  const bySeason = new Map<number, PublicPlayer["history"]>();
  for (const e of p.history) bySeason.set(e.seasonId, [...(bySeason.get(e.seasonId) ?? []), e]);
  const body = h`
<div class="stats">
${p.summary.map((s) => h`<div class="stat"><div class="v">${fmtPts(s.points)} pts</div><div class="l">${s.seasonName} · ${s.categoryName}${s.position ? h` · <b>${s.position}${s.tied ? "=" : ""}°</b> de ${s.total}` : ""}</div>
<a class="note" href="${withEmbed(rankingPath({ seasonId: s.seasonId, categoryId: s.categoryId, divisionId: null }, undefined, ctx.base), ctx)}">Ver ranking</a></div>`)}
</div>
${[...bySeason.values()].map((entries) => h`
<h2>${entries[0]!.seasonName}</h2>
<div class="card scroll-x"><table>
<thead><tr><th>Concepto</th><th class="num">Puntos</th></tr></thead>
<tbody>${entries.map((e) => h`<tr>
<td>${e.kind === "torneo" ? h`<b>${e.label}</b>` : h`<span class="badge ${e.kind}">${e.label}</span>`}
<div class="nick">${[e.date ? fmtDate(e.date) : null, `${e.categoryName}${e.divisionName ? ` ${e.divisionName}` : ""}`, e.partner ? `con ${e.partner}` : null, e.stage].filter(Boolean).join(" · ")}</div></td>
<td class="num pts">${e.points > 0 ? "+" : ""}${fmtPts(e.points)}</td>
</tr>`)}</tbody>
</table></div>`)}
<p class="note">“Saldo inicial importado” son los puntos que el jugador ya tenía en el ranking anterior al sistema actual.</p>
`;
  return layout(ctx, {
    title: `${p.firstName} ${p.lastName}`, body, section: "rankings", canonical: `/rankings/jugador/${p.code}`,
    description: `Puntos e historial de ${p.firstName} ${p.lastName} en los rankings de ${ctx.title}.`,
    heading: { kicker: `${p.categoryName}${showGender(ctx) ? ` ${GENDER_LABEL[p.gender]}` : ""}`, title: h`${p.firstName} ${p.lastName}${p.nickname ? h` <span class="nick">“${p.nickname}”</span>` : ""}`, sub: `Código ${p.code}` },
  });
}

export function messagePage(ctx: PageCtx, title: string, message: string): string {
  return layout(ctx, { title, description: message, section: "rankings", heading: { title }, body: h`<div class="card empty">${message}</div><p class="note"><a href="${withEmbed(ctx.base, ctx)}">Ver todos los rankings</a></p>` });
}
