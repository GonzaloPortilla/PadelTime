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
@font-face{font-family:"Oswald";font-weight:500;font-display:swap;src:url(/pub/fonts/oswald-latin-500-normal.woff2) format("woff2")}
@font-face{font-family:"Oswald";font-weight:600;font-display:swap;src:url(/pub/fonts/oswald-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:"Oswald";font-weight:700;font-display:swap;src:url(/pub/fonts/oswald-latin-700-normal.woff2) format("woff2")}
@font-face{font-family:"Comfortaa";font-weight:400;font-display:swap;src:url(/pub/fonts/comfortaa-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Comfortaa";font-weight:700;font-display:swap;src:url(/pub/fonts/comfortaa-latin-700-normal.woff2) format("woff2")}
:root{--blue:#0f5a93;--blue-d:#0c4a79;--blue-l:#eef5fb;--blue-t:#e3edf8;--navy:#1c4587;--green:#57aa57;--green-d:#3f8f42;--green-l:#eff8ec;--green-s:#b6d7a8;--text:#1c1c1c;--muted:#5d6b7a;--line:#e2e8f0;--bg:#f3f6f9;--card:#fff;
--display:"Oswald","Arial Narrow",system-ui,sans-serif;--brandf:"Comfortaa",system-ui,sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;color:var(--text);background:var(--bg);line-height:1.45}
body.embed{background:transparent}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.stripe{height:4px;background:linear-gradient(90deg,var(--blue) 0 62%,var(--green) 62% 100%)}
.top{background:#fff;border-bottom:1px solid var(--line)}
.top .in{max-width:1000px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;color:var(--blue);font-family:var(--brandf);font-weight:700;font-size:18px;letter-spacing:-.01em}
.brand:hover{text-decoration:none}.brand b{color:var(--green);font-weight:700}
.brand img{width:40px;height:40px}
.top nav{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap}
.top nav a{color:#3b4a5a;font-family:var(--brandf);font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.02em;padding:8px 10px;border-radius:8px}
.top nav a:hover{background:var(--blue-l);color:var(--blue);text-decoration:none}
.hero{position:relative;overflow:hidden;background:#fff;border-bottom:1px solid var(--line)}
.hero::before,.hero::after{content:"";position:absolute;bottom:0;pointer-events:none}
.hero::before{left:0;width:150px;height:56px;background:var(--blue);clip-path:polygon(0 0,100% 100%,0 100%)}
.hero::after{right:0;width:210px;height:84px;background:linear-gradient(var(--green),var(--green)) right/100% 100% no-repeat;clip-path:polygon(100% 0,0 100%,100% 100%)}
.hero .in{position:relative;z-index:1;max-width:1000px;margin:0 auto;padding:22px 16px 34px}
.hero .blue-tri{position:absolute;right:0;bottom:0;width:260px;height:62px;background:var(--blue);clip-path:polygon(100% 0,0 100%,100% 100%)}
main{max-width:1000px;margin:0 auto;padding:20px 16px 32px}
body.embed main{padding:6px 4px 12px;max-width:none}
h1{font-family:var(--display);font-weight:700;text-transform:uppercase;letter-spacing:.02em;color:var(--navy);font-size:30px;line-height:1.1;margin:0 0 6px}
body.embed h1{font-size:22px}
h2{font-family:var(--display);font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:var(--navy);font-size:18px;margin:26px 0 10px}
.kicker{font-family:var(--brandf);font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--green-d);margin:0 0 4px}
.sub{color:var(--muted);font-size:14px;margin:0}
body.embed .sub{margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,90,147,.06),0 6px 18px -10px rgba(15,90,147,.18)}
body.embed .card{box-shadow:none}
.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}
.tools input{flex:1 1 220px;min-width:0;font:inherit;font-size:15px;padding:10px 12px;border:1px solid #c9d5e2;border-radius:10px;background:#fff;color:var(--text)}
.tools input:focus{outline:2px solid var(--blue);outline-offset:0;border-color:transparent}
.btn{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;padding:10px 14px;border-radius:10px;border:1px solid #c9d5e2;background:#fff;color:var(--blue-d);cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--blue-l);text-decoration:none}
.btn.xls{color:var(--green-d);border-color:#bfe0b6;background:var(--green-l)}
.btn.xls:hover{background:#ddf0d6}
.btn.primary{background:var(--blue);border-color:var(--blue);color:#fff}
.btn.primary:hover{background:var(--blue-d)}
table{width:100%;border-collapse:collapse;font-size:15px}
th{font-family:var(--display);font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#fff;text-align:left;font-weight:600;background:var(--blue);padding:10px 12px}
td{padding:9px 12px;border-bottom:1px solid var(--line)}
tbody tr:nth-child(even) td{background:#fafcfe}
tbody tr:hover td{background:var(--blue-l)}
tr:last-child td{border-bottom:0}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pos{width:64px;text-align:center}
td.pos{background:var(--blue-t)!important;font-family:var(--display);font-weight:600;color:var(--navy)}
.pos span{display:inline-flex;min-width:32px;height:32px;align-items:center;justify-content:center;border-radius:999px;padding:0 6px;font-size:16px}
tr.p1 .pos span{background:var(--green);color:#fff;box-shadow:0 2px 6px rgba(63,143,66,.35)}
tr.p2 .pos span{background:var(--blue);color:#fff}
tr.p3 .pos span{background:#fff;color:var(--blue);box-shadow:inset 0 0 0 2px var(--blue)}
td a{color:var(--text);font-weight:500}td a:hover{color:var(--blue)}
.pts{font-family:var(--display);font-weight:600;font-size:18px;color:var(--navy)}
.nick{color:var(--muted);font-size:13px}
@media (max-width:560px){.hide-sm{display:none}td,th{padding:8px 8px}table{font-size:14px}h1{font-size:24px}.pos{width:52px}.hero::after{width:120px;height:48px}.hero .blue-tri{width:150px;height:36px}.hero::before{width:80px;height:30px}.top nav a{padding:6px 7px;font-size:12px}}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.chip{font-family:var(--display);font-weight:500;letter-spacing:.03em;font-size:14px;padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--navy)}
.chip.on{background:var(--blue);border-color:var(--blue);color:#fff}
.chip:hover{text-decoration:none;border-color:var(--green)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.tile{position:relative;display:block;background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px 14px 20px;color:var(--text);overflow:hidden}
.tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--blue)}
.tile:hover{border-color:var(--blue);text-decoration:none}.tile:hover::before{background:var(--green)}
.tile b{display:block;font-family:var(--display);font-weight:600;font-size:18px;letter-spacing:.02em;color:var(--navy)}.tile small{color:var(--muted)}
.empty{padding:28px 16px;text-align:center;color:var(--muted)}
.list a.row{display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);color:var(--text)}
.list a.row:last-child{border-bottom:0}.list a.row:hover{background:var(--blue-l);text-decoration:none}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;background:var(--green-l);color:var(--green-d)}
.badge.saldo{background:var(--blue-l);color:var(--blue)}.badge.ajuste{background:#fff7ed;color:#b45309}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin:16px 0 8px}
.stat{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;overflow:hidden}
.stat::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,var(--blue) 0 62%,var(--green) 62% 100%)}
.stat .v{font-family:var(--display);font-size:28px;font-weight:600;color:var(--navy)}.stat .l{font-size:13px;color:var(--muted)}
footer{max-width:1000px;margin:0 auto;padding:0 16px 24px;color:var(--muted);font-size:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
footer img{width:22px;height:22px}
body.embed footer{display:block;padding:0 4px 8px;max-width:none}
.note{font-size:12px;color:var(--muted);margin-top:10px}
[hidden]{display:none!important}
`;

interface Heading { kicker?: string; title: Raw | string; sub?: Raw | string }

/** Título de la página: en la vista completa, sobre un banner con las diagonales azul y verde de la web oficial. */
function headingHtml(ctx: PageCtx, hd: Heading): Raw {
  const inner = h`${hd.kicker ? h`<p class="kicker">${hd.kicker}</p>` : ""}<h1>${hd.title}</h1>${hd.sub ? h`<p class="sub">${hd.sub}</p>` : ""}`;
  return ctx.embed ? inner : h`<section class="hero"><div class="blue-tri" aria-hidden="true"></div><div class="in">${inner}</div></section>`;
}

function layout(ctx: PageCtx, opts: { title: string; body: Raw; canonical?: string; heading?: Heading }): string {
  const page = h`<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · ${ctx.title}</title>
<meta name="description" content="${opts.title}. Rankings oficiales actualizados automáticamente.">
<link rel="icon" href="/brand/favicon-64.png" type="image/png">
<style>${raw(CSS)}</style>
<script src="/pub/publico.js" defer></script>
</head>
<body class="${ctx.embed ? "embed" : ""}">
${ctx.embed ? h`<div class="stripe" aria-hidden="true"></div>` : h`<header class="top"><div class="stripe" aria-hidden="true"></div><div class="in">
  <a class="brand" href="/publico"><img src="/brand/padeltime-simbolo.png" alt="" width="40" height="40">${ctx.title === "Padel Time" ? h`PADEL <b>TIME</b>` : ctx.title}</a>
  <nav><a href="/publico">Rankings</a>${ctx.showHistory ? h`<a href="/publico/jugadores">Buscar jugador</a>` : ""}</nav>
</div></header>`}
${!ctx.embed && opts.heading ? headingHtml(ctx, opts.heading) : ""}
<main>${ctx.embed && opts.heading ? headingHtml(ctx, opts.heading) : ""}${opts.body}</main>
<footer>${ctx.embed ? "" : h`<img src="/brand/padeltime-simbolo.png" alt="" width="22" height="22">`}${ctx.embed ? h`<a href="${opts.canonical ?? "/publico"}" target="_blank" rel="noopener">Ver en ${ctx.title} ↗</a> · ` : ""}Información de sólo lectura, actualizada automáticamente.</footer>
</body>
</html>`;
  return page.value;
}

// ─────────────────────────── Índice ───────────────────────────
export function indexPage(ctx: PageCtx, seasons: { season: PublicSeason; refs: PublicRankingRef[] }[]): string {
  const body = h`
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
  return layout(ctx, { title: "Rankings", body, heading: { kicker: ctx.title, title: "Rankings", sub: "Elegí la temporada y la categoría. Los puntos se actualizan en cuanto se acredita cada torneo." } });
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
${!ctx.embed && sameGender.length > 1 ? h`<nav class="chips" aria-label="Otras categorías">
${sameGender.map((s) => {
  const on = s.categoryId === data.category.id && (s.divisionId ?? null) === (data.division?.id ?? null);
  return h`<a class="chip${on ? " on" : ""}" href="${withEmbed(rankingPath(s, opts.seasonParam), ctx)}">${s.categoryName}${s.divisionName ? ` ${s.divisionName}` : ""}</a>`;
})}
</nav>` : ""}
<form class="tools" method="get" action="${path}" role="search">
  <input type="search" name="buscar" value="${opts.query}" placeholder="Filtrar por nombre" aria-label="Filtrar por nombre" data-filter="ranking">
  ${ctx.embed ? h`<input type="hidden" name="embed" value="1">` : ""}
  <a class="btn xls" href="${path}?descargar=xlsx" target="_blank" rel="noopener" download>Excel</a>
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
  return layout(ctx, {
    title: `Ranking ${name} — ${data.season.name}`, body, canonical: path,
    heading: { kicker: data.season.name, title: `Ranking ${name}`, sub: data.lastUpdate ? `Última actualización: ${fmtDateTime(data.lastUpdate)}` : "Todavía sin puntos" },
  });
}

// ─────────────────────────── Jugadores ───────────────────────────
export function searchPage(ctx: PageCtx, query: string, hits: PublicPlayerHit[]): string {
  const body = h`
<form class="tools" action="/publico/jugadores" method="get" role="search">
  <input type="search" name="q" value="${query}" placeholder="Nombre, apellido o apodo" aria-label="Nombre, apellido o apodo" autofocus minlength="2">
  ${ctx.embed ? h`<input type="hidden" name="embed" value="1">` : ""}
  <button class="btn primary" type="submit">Buscar</button>
</form>
${query.trim().length < 2 ? "" : hits.length === 0 ? h`<div class="card empty">No encontramos jugadores con “${query}”.</div>` : h`
<div class="card list">${hits.map((p) => h`<a class="row" href="${withEmbed(`/publico/jugador/${p.code}`, ctx)}"><span><b>${p.lastName}, ${p.firstName}</b>${p.nickname ? h` <span class="nick">“${p.nickname}”</span>` : ""}</span><span class="nick">${p.categoryName} ${GENDER_LABEL[p.gender]}</span></a>`)}</div>
${hits.length >= 40 ? h`<p class="note">Se muestran los primeros 40 resultados. Escribí más letras para afinar la búsqueda.</p>` : ""}`}
`;
  return layout(ctx, { title: query ? `Buscar “${query}”` : "Buscar jugador", body, heading: { kicker: ctx.title, title: "Buscar jugador", sub: "Consultá los puntos y el historial de cualquier jugador con puntos en el ranking." } });
}

export function playerPage(ctx: PageCtx, p: PublicPlayer): string {
  const bySeason = new Map<number, PublicPlayer["history"]>();
  for (const e of p.history) bySeason.set(e.seasonId, [...(bySeason.get(e.seasonId) ?? []), e]);
  const body = h`
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
  return layout(ctx, {
    title: `${p.firstName} ${p.lastName}`, body, canonical: `/publico/jugador/${p.code}`,
    heading: { kicker: `${p.categoryName} ${GENDER_LABEL[p.gender]}`, title: h`${p.firstName} ${p.lastName}${p.nickname ? h` <span class="nick">“${p.nickname}”</span>` : ""}`, sub: `Código ${p.code}` },
  });
}

export function messagePage(ctx: PageCtx, title: string, message: string): string {
  return layout(ctx, { title, heading: { title }, body: h`<div class="card empty">${message}</div><p class="note"><a href="${withEmbed("/publico", ctx)}">Ver todos los rankings</a></p>` });
}
