import { GENDER_LABEL, TIEBREAKER_LABEL } from "@shared/constants";
import { h, raw, type Raw } from "./html";
import type { PublicPlayer, PublicPlayerHit, PublicRanking, PublicRankingRef, PublicSeason } from "./data";

export interface PageCtx {
  title: string;
  embed: boolean;
  showHistory: boolean;
}

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
});
const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
const fmtPts = (n: number) => n.toLocaleString("es-AR");

/** Conserva el modo incrustado al navegar dentro del iframe. */
export const withEmbed = (path: string, ctx: PageCtx, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams(extra);
  if (ctx.embed) params.set("embed", "1");
  const q = params.toString();
  return q ? `${path}?${q}` : path;
};

export const rankingPath = (r: { seasonId: number; categoryId: number; divisionId: number | null }, seasonParam?: string) =>
  `/publico/ranking/${seasonParam ?? r.seasonId}/${r.categoryId}${r.divisionId ? `/${r.divisionId}` : ""}`;

export const rankingName = (r: { categoryName: string; gender: keyof typeof GENDER_LABEL; divisionName: string | null }) =>
  `${r.categoryName} ${GENDER_LABEL[r.gender]}${r.divisionName ? ` · División ${r.divisionName}` : ""}`;

const CSS = `
:root{--ink:#0b1f1a;--ink2:#17423a;--brand:#047857;--brand-l:#ecfdf6;--ball:#c6f432;--ball-l:#f3fdd4;--muted:#5b6b66;--line:#e3e9e6;--bg:#f6f8f7;--card:#fff}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.45}
body.embed{background:transparent}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.top{background:var(--ink);color:#fff}
.top .in{max-width:960px;margin:0 auto;padding:14px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;color:#fff;font-weight:700;font-size:18px}
.brand:hover{text-decoration:none}.brand b{color:var(--ball)}
.top nav{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.top nav a{color:#d6e2de;font-size:14px;padding:6px 10px;border-radius:8px}
.top nav a:hover{background:rgba(255,255,255,.08);text-decoration:none;color:#fff}
main{max-width:960px;margin:0 auto;padding:20px 16px 32px}
body.embed main{padding:8px 4px 12px;max-width:none}
h1{font-size:24px;line-height:1.2;margin:0 0 4px;letter-spacing:-.01em}
body.embed h1{font-size:19px}
h2{font-size:16px;margin:24px 0 10px}
.sub{color:var(--muted);font-size:14px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}
.tools input{flex:1 1 220px;min-width:0;font:inherit;font-size:15px;padding:9px 12px;border:1px solid #cdd8d4;border-radius:10px;background:#fff;color:var(--ink)}
.tools input:focus{outline:2px solid var(--brand);outline-offset:0;border-color:transparent}
.btn{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;padding:9px 12px;border-radius:10px;border:1px solid #cdd8d4;background:#fff;color:var(--ink);cursor:pointer;white-space:nowrap}
.btn:hover{background:#f0f4f2;text-decoration:none}
.btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}
table{width:100%;border-collapse:collapse;font-size:15px}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);text-align:left;font-weight:600;background:#fafcfb;border-bottom:1px solid var(--line);padding:9px 12px}
td{padding:9px 12px;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pos{width:56px;font-weight:700;font-variant-numeric:tabular-nums}
.pos span{display:inline-flex;min-width:30px;height:30px;align-items:center;justify-content:center;border-radius:999px;padding:0 6px}
tr.p1 .pos span{background:var(--ball);color:var(--ink)}
tr.p2 .pos span,tr.p3 .pos span{background:var(--ball-l)}
.pts{font-weight:700;font-size:16px}
.nick{color:var(--muted);font-size:13px}
.hide-sm{}
@media (max-width:560px){.hide-sm{display:none}td,th{padding:8px 8px}table{font-size:14px}h1{font-size:20px}}
.meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);font-size:13px;margin-top:10px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.chip{font-size:13px;padding:5px 10px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--ink)}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.chip:hover{text-decoration:none;border-color:#b9c7c2}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.tile{display:block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;color:var(--ink)}
.tile:hover{border-color:var(--brand);text-decoration:none}
.tile b{display:block;font-size:15px}.tile small{color:var(--muted)}
.empty{padding:28px 16px;text-align:center;color:var(--muted)}
.list a.row{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border-bottom:1px solid var(--line);color:var(--ink)}
.list a.row:last-child{border-bottom:0}.list a.row:hover{background:#fafcfb;text-decoration:none}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--brand-l);color:var(--brand)}
.badge.saldo{background:#eef2ff;color:#4338ca}.badge.ajuste{background:#fff7ed;color:#b45309}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:8px}
.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.stat .v{font-size:22px;font-weight:700}.stat .l{font-size:13px;color:var(--muted)}
footer{max-width:960px;margin:0 auto;padding:0 16px 24px;color:var(--muted);font-size:12px}
body.embed footer{padding:0 4px 8px;max-width:none}
.note{font-size:12px;color:var(--muted);margin-top:10px}
[hidden]{display:none!important}
`;

function layout(ctx: PageCtx, opts: { title: string; body: Raw; canonical?: string }): string {
  const page = h`<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · ${ctx.title}</title>
<meta name="description" content="${opts.title}. Rankings oficiales actualizados automáticamente.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${raw(CSS)}</style>
<script src="/pub/publico.js" defer></script>
</head>
<body class="${ctx.embed ? "embed" : ""}">
${ctx.embed ? "" : h`<header class="top"><div class="in">
  <a class="brand" href="/publico"><svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#17423a"/><circle cx="32" cy="32" r="17" fill="#c6f432"/><path d="M19 22c8 4 8 16 0 20M45 22c-8 4-8 16 0 20" stroke="#0b1f1a" stroke-width="3" fill="none" stroke-linecap="round"/></svg>${ctx.title === "Padel Time" ? h`Padel <b>Time</b>` : ctx.title}</a>
  <nav><a href="/publico">Rankings</a>${ctx.showHistory ? h`<a href="/publico/jugadores">Buscar jugador</a>` : ""}</nav>
</div></header>`}
<main>${opts.body}</main>
<footer>${ctx.embed ? h`<a href="${opts.canonical ?? "/publico"}" target="_blank" rel="noopener">Ver en ${ctx.title} ↗</a> · ` : ""}Información de sólo lectura, actualizada automáticamente.</footer>
</body>
</html>`;
  return page.value;
}

// ─────────────────────────── Índice ───────────────────────────
export function indexPage(ctx: PageCtx, seasons: { season: PublicSeason; refs: PublicRankingRef[] }[]): string {
  const body = h`
<h1>Rankings</h1>
<p class="sub">Elegí la temporada y la categoría. Los puntos se actualizan en cuanto se acredita cada torneo.</p>
${ctx.showHistory ? h`<form class="tools" action="/publico/jugadores" method="get">
  <input type="search" name="q" placeholder="Buscar jugador por nombre o apellido" aria-label="Buscar jugador" minlength="2">
  ${ctx.embed ? h`<input type="hidden" name="embed" value="1">` : ""}
  <button class="btn primary" type="submit">Buscar</button>
</form>` : ""}
${seasons.length === 0 ? h`<div class="card empty">Todavía no hay rankings publicados.</div>` : ""}
${seasons.map(({ season, refs }) => h`
<h2>${season.name}${season.status === "activa" ? h` <span class="badge">En curso</span>` : ""}</h2>
${refs.length === 0 ? h`<div class="card empty">Sin puntos cargados todavía.</div>` : h`<div class="grid">
${refs.map((r) => h`<a class="tile" href="${withEmbed(rankingPath(r), ctx)}"><b>${rankingName(r)}</b><small>${r.players} jugador${r.players === 1 ? "" : "es"}</small></a>`)}
</div>`}`)}
`;
  return layout(ctx, { title: "Rankings", body });
}

// ─────────────────────────── Ranking ───────────────────────────
export function rankingPage(ctx: PageCtx, data: PublicRanking, siblings: PublicRankingRef[], opts: { seasonParam: string; query: string }): string {
  const name = rankingName({ categoryName: data.category.name, gender: data.category.gender, divisionName: data.division?.name ?? null });
  const path = rankingPath({ seasonId: data.season.id, categoryId: data.category.id, divisionId: data.division?.id ?? null }, opts.seasonParam);
  const q = opts.query.trim().toLowerCase();
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const showTournaments = data.rows.some((r) => r.tournaments > 0);
  const rows = data.rows.map((r) => {
    const fullName = `${r.firstName} ${r.lastName}`;
    const hidden = q && !norm(`${fullName} ${r.nickname ?? ""}`).includes(norm(q));
    return h`<tr class="${r.position <= 3 ? `p${r.position}` : ""}" data-name="${norm(`${fullName} ${r.nickname ?? ""}`)}"${hidden ? raw(" hidden") : ""}>
<td class="pos"><span>${r.position}${r.tied ? "=" : ""}</span></td>
<td>${ctx.showHistory ? h`<a href="${withEmbed(`/publico/jugador/${r.code}`, ctx)}">${r.lastName}, ${r.firstName}</a>` : h`${r.lastName}, ${r.firstName}`}${r.nickname ? h` <span class="nick">“${r.nickname}”</span>` : ""}</td>
${showTournaments ? h`<td class="num hide-sm">${r.tournaments}</td>` : ""}
<td class="num pts">${fmtPts(r.points)}</td>
</tr>`;
  });
  const sameGender = siblings.filter((s) => s.gender === data.category.gender);
  const body = h`
<h1>Ranking ${name}</h1>
<p class="sub">${data.season.name}${data.lastUpdate ? h` · Última actualización: ${fmtDateTime(data.lastUpdate)}` : ""}</p>
${!ctx.embed && sameGender.length > 1 ? h`<nav class="chips" aria-label="Otras categorías">
${sameGender.map((s) => {
  const on = s.categoryId === data.category.id && (s.divisionId ?? null) === (data.division?.id ?? null);
  return h`<a class="chip${on ? " on" : ""}" href="${withEmbed(rankingPath(s, opts.seasonParam), ctx)}">${s.categoryName}${s.divisionName ? ` ${s.divisionName}` : ""}</a>`;
})}
</nav>` : ""}
<form class="tools" method="get" action="${path}" role="search">
  <input type="search" name="buscar" value="${opts.query}" placeholder="Filtrar por nombre" aria-label="Filtrar por nombre" data-filter="ranking">
  ${ctx.embed ? h`<input type="hidden" name="embed" value="1">` : ""}
  <a class="btn" href="${path}?descargar=xlsx" target="_blank" rel="noopener" download>Excel</a>
  <a class="btn hide-sm" href="${path}?descargar=csv" target="_blank" rel="noopener" download>CSV</a>
</form>
<div class="card">
${data.rows.length === 0 ? h`<div class="empty">Todavía no hay puntos en este ranking.</div>` : h`<table id="ranking">
<thead><tr><th class="pos">Pos.</th><th>Jugador</th>${showTournaments ? h`<th class="num hide-sm">Torneos</th>` : ""}<th class="num">Puntos</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="empty" data-empty hidden>Ningún jugador coincide con la búsqueda.</div>`}
</div>
<p class="note">Desempate: puntos${data.season.tiebreakers.map((t) => `, ${TIEBREAKER_LABEL[t].toLowerCase()}`).join("")}. “=” indica posición compartida.</p>
`;
  return layout(ctx, { title: `Ranking ${name} — ${data.season.name}`, body, canonical: path });
}

// ─────────────────────────── Jugadores ───────────────────────────
export function searchPage(ctx: PageCtx, query: string, hits: PublicPlayerHit[]): string {
  const body = h`
<h1>Buscar jugador</h1>
<p class="sub">Consultá los puntos y el historial de cualquier jugador con puntos en el ranking.</p>
<form class="tools" action="/publico/jugadores" method="get" role="search">
  <input type="search" name="q" value="${query}" placeholder="Nombre, apellido o apodo" aria-label="Nombre, apellido o apodo" autofocus minlength="2">
  ${ctx.embed ? h`<input type="hidden" name="embed" value="1">` : ""}
  <button class="btn primary" type="submit">Buscar</button>
</form>
${query.trim().length < 2 ? "" : hits.length === 0 ? h`<div class="card empty">No encontramos jugadores con “${query}”.</div>` : h`
<div class="card list">${hits.map((p) => h`<a class="row" href="${withEmbed(`/publico/jugador/${p.code}`, ctx)}"><span><b>${p.lastName}, ${p.firstName}</b>${p.nickname ? h` <span class="nick">“${p.nickname}”</span>` : ""}</span><span class="nick">${p.categoryName} ${GENDER_LABEL[p.gender]}</span></a>`)}</div>
${hits.length >= 40 ? h`<p class="note">Se muestran los primeros 40 resultados. Escribí más letras para afinar la búsqueda.</p>` : ""}`}
`;
  return layout(ctx, { title: query ? `Buscar “${query}”` : "Buscar jugador", body });
}

export function playerPage(ctx: PageCtx, p: PublicPlayer): string {
  const bySeason = new Map<number, PublicPlayer["history"]>();
  for (const e of p.history) bySeason.set(e.seasonId, [...(bySeason.get(e.seasonId) ?? []), e]);
  const body = h`
<h1>${p.firstName} ${p.lastName}${p.nickname ? h` <span class="nick">“${p.nickname}”</span>` : ""}</h1>
<p class="sub">${p.categoryName} ${GENDER_LABEL[p.gender]} · Código ${p.code}</p>
<div class="stats">
${p.summary.map((s) => h`<div class="stat"><div class="v">${fmtPts(s.points)} pts</div><div class="l">${s.seasonName} · ${s.categoryName}${s.position ? h` · <b>${s.position}${s.tied ? "=" : ""}°</b> de ${s.total}` : ""}</div>
<a class="note" href="${withEmbed(rankingPath({ seasonId: s.seasonId, categoryId: s.categoryId, divisionId: null }), ctx)}">Ver ranking</a></div>`)}
</div>
${[...bySeason.values()].map((entries) => h`
<h2>${entries[0]!.seasonName}</h2>
<div class="card"><table>
<thead><tr><th>Concepto</th><th class="num">Puntos</th></tr></thead>
<tbody>${entries.map((e) => h`<tr>
<td>${e.kind === "torneo" ? h`<b>${e.label}</b>` : h`<span class="badge ${e.kind}">${e.label}</span>`}
<div class="nick">${[e.date ? fmtDate(e.date) : null, `${e.categoryName}${e.divisionName ? ` ${e.divisionName}` : ""}`, e.partner ? `con ${e.partner}` : null, e.stage].filter(Boolean).join(" · ")}</div></td>
<td class="num pts">${e.points > 0 ? "+" : ""}${fmtPts(e.points)}</td>
</tr>`)}</tbody>
</table></div>`)}
<p class="note">“Saldo inicial importado” son los puntos que el jugador ya tenía en el ranking anterior al sistema actual.</p>
`;
  return layout(ctx, { title: `${p.firstName} ${p.lastName}`, body, canonical: `/publico/jugador/${p.code}` });
}

export function messagePage(ctx: PageCtx, title: string, message: string): string {
  return layout(ctx, { title, body: h`<h1>${title}</h1><div class="card empty">${message}</div><p class="note"><a href="${withEmbed("/publico", ctx)}">Ver todos los rankings</a></p>` });
}
