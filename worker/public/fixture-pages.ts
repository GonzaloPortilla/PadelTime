/**
 * Fixture público de un torneo largo (Fase 9): grupos y posiciones, partidos (pendientes y resultados con
 * fecha, hora y cancha) y cuadros de Copa de Oro / Copa de Plata. Se dibuja SÓLO desde la copia publicada
 * (fixture_publications): lo que el organizador carga en el panel no aparece hasta que lo publica.
 */
import { PHASE_LABEL, type BracketPhase, type PublicFixture, type PublicFixtureMatch } from "@shared/fixture";
import { h, type Raw } from "./html";
import { fmtDate, fmtDateTime } from "./layout";

const ANCHOR: Record<BracketPhase, string> = { oro: "copa-oro", plata: "copa-plata", cuadro: "cuadro" };

const when = (m: PublicFixtureMatch) =>
  [m.date ? fmtDate(m.date) : null, m.time ? `${m.time} h` : null, m.court].filter(Boolean).join(" · ");

const teamCell = (name: string | null, won: boolean, bye: boolean) =>
  h`<span class="fx-team${won ? " won" : ""}">${bye ? "Pase libre (BYE)" : name ?? "A definir"}</span>`;

function matchRow(m: PublicFixtureMatch): Raw {
  const label = m.phase === "grupos" ? `Grupo ${m.group} · ${m.roundLabel}` : `${PHASE_LABEL[m.phase]} · ${m.roundLabel}`;
  const result = m.status === "pendiente" ? h`<span class="fx-pending">Pendiente</span>` : h`<b class="fx-score">${m.score}</b>`;
  return h`<li class="fx-match">
<div class="fx-meta"><small>${label}</small>${when(m) ? h`<small>${when(m)}</small>` : ""}</div>
<div class="fx-vs">${teamCell(m.team1, m.winner === 1, m.bye1)}<span class="fx-x">vs</span>${teamCell(m.team2, m.winner === 2, m.bye2)}</div>
<div class="fx-res">${result}</div>
</li>`;
}

function standingsTable(g: PublicFixture["groups"][number]): Raw {
  return h`<div class="card scroll-x"><table class="fx-table">
<thead><tr><th class="pos">#</th><th>Pareja</th><th class="num" title="Partidos jugados">PJ</th><th class="num" title="Ganados">PG</th><th class="num" title="Perdidos">PP</th><th class="num" title="Sets a favor - en contra">Sets</th><th class="num" title="Games a favor - en contra">Games</th></tr></thead>
<tbody>${g.rows.map((r) => h`<tr class="${r.withdrawn ? "fx-out" : ""}"><td class="pos"><span>${r.position}</span></td><td>${r.team}${r.withdrawn ? h` <small>(retirada)</small>` : ""}${r.tied ? h` <small>(empate a definir)</small>` : ""}</td><td class="num">${r.played}</td><td class="num"><b>${r.won}</b></td><td class="num">${r.lost}</td><td class="num">${r.setsWon}-${r.setsLost}</td><td class="num">${r.gamesWon}-${r.gamesLost}</td></tr>`)}</tbody>
</table></div>`;
}

/** Cuadro de eliminación: una columna por ronda; cada cruce muestra las dos parejas y los games de cada set. */
function bracket(fx: PublicFixture, b: PublicFixture["brackets"][number]): Raw {
  const ms = fx.matches.filter((m) => m.phase === b.phase);
  const side = (m: PublicFixtureMatch, n: 1 | 2) => {
    const name = n === 1 ? m.team1 : m.team2;
    const bye = n === 1 ? m.bye1 : m.bye2;
    const games = m.status === "wo" ? (m.winner === n ? "W.O." : "") : m.sets.map((s) => s[n - 1]).join(" ");
    return h`<div class="bk-side${m.winner === n ? " won" : ""}"><span>${bye ? "BYE" : name ?? "—"}</span><b>${games}</b></div>`;
  };
  return h`<div class="bracket scroll-x" role="group" aria-label="${PHASE_LABEL[b.phase]}">${b.rounds.map((label, i) => h`<div class="bk-col">
<h4>${label}</h4>
${ms.filter((m) => m.round === i + 1).sort((x, y) => x.slot - y.slot).map((m) => h`<div class="bk-match${m.status === "bye" ? " bye" : ""}">${side(m, 1)}${side(m, 2)}${when(m) && m.status === "pendiente" ? h`<small>${when(m)}</small>` : ""}</div>`)}
</div>`)}</div>`;
}

export function fixtureSection(fx: PublicFixture, publishedAt: string): Raw {
  const pending = fx.matches.filter((m) => m.status === "pendiente" && m.team1 && m.team2)
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.time ?? "").localeCompare(b.time ?? "") || a.id - b.id);
  const played = fx.matches.filter((m) => m.status !== "pendiente" && m.status !== "bye")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.id - a.id);
  const nav: { href: string; label: string }[] = [
    ...(fx.groups.length ? [{ href: "#posiciones", label: "Posiciones" }] : []),
    { href: "#partidos", label: "Partidos" },
    ...fx.brackets.map((b) => ({ href: `#${ANCHOR[b.phase]}`, label: PHASE_LABEL[b.phase] })),
  ];
  return h`<section class="fixture" id="fixture">
<h2>Fixture</h2>
<nav class="chips" aria-label="Secciones del fixture">${nav.map((n) => h`<a class="chip" href="${n.href}">${n.label}</a>`)}</nav>
${fx.groups.length ? h`<h3 id="posiciones">Grupos y posiciones</h3>
<div class="fx-groups">${fx.groups.map((g) => h`<div><h4>Grupo ${g.name}${g.complete ? h` <small>· terminado</small>` : ""}</h4>${standingsTable(g)}</div>`)}</div>
<p class="note">Orden de desempate: ${fx.tiebreakers.join(", ")}.</p>` : ""}
<h3 id="partidos">Partidos</h3>
<div class="fx-cols">
<div><h4>Próximos (${pending.length})</h4>${pending.length ? h`<ul class="fx-list card">${pending.map(matchRow)}</ul>` : h`<p class="sub">No hay partidos pendientes con parejas definidas.</p>`}</div>
<div><h4>Resultados (${played.length})</h4>${played.length ? h`<ul class="fx-list card">${played.map(matchRow)}</ul>` : h`<p class="sub">Todavía no hay resultados.</p>`}</div>
</div>
${fx.brackets.map((b) => h`<h3 id="${ANCHOR[b.phase]}">${PHASE_LABEL[b.phase]}</h3>${bracket(fx, b)}`)}
<p class="note">Actualizado el ${fmtDateTime(publishedAt).replace(/\.$/, "")}.</p>
</section>`;
}
