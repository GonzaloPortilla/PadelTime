#!/usr/bin/env node
/**
 * Datos de demostración para el ENTORNO DE PRUEBA (staging). Usa la API real de la plataforma, como lo haría
 * un organizador, así la demo recorre el circuito completo: torneo largo con varias categorías, fixture,
 * Copa de Oro / Plata, posiciones finales, acreditación, Satélite con cuadro final y rankings.
 *
 * Todos los nombres son FICTICIOS. Nunca usar contra producción: el script se niega si el sitio no muestra
 * la franja "Entorno de prueba" (salvo en una dirección local).
 *
 *   node scripts/cargar-demo.mjs --url https://padel-time-prueba.<subdominio>.workers.dev --usuario admin
 *   (la contraseña se pide por consola o se toma de PADEL_PASSWORD; nunca se guarda)
 */
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : null);
const base = opt("url");
const usuario = opt("usuario") ?? "admin";
if (!base) { console.error("Uso: node scripts/cargar-demo.mjs --url <web de prueba> [--usuario admin]"); process.exit(1); }
const origin = new URL(base).origin;
const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

// Resguardo: sólo contra el entorno de prueba (o una copia local).
const home = await (await fetch(origin + "/")).text();
if (!local && !home.includes("Entorno de prueba")) {
  console.error("✖ Esta dirección no es el entorno de prueba (no muestra la franja «Entorno de prueba»). No se carga nada.");
  process.exit(1);
}

const password = process.env.PADEL_PASSWORD ?? await new Promise((r) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`Contraseña de ${usuario}: `, (a) => { rl.close(); r(a); });
});
const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: usuario, password }) });
if (!login.ok) { console.error("✖ No se pudo ingresar:", (await login.json()).error?.message); process.exit(1); }
const cookie = login.headers.get("set-cookie").split(";")[0];

async function api(method, path, body) {
  const res = await fetch(`${origin}/api${path}`, { method, headers: { origin, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json?.error?.message ?? ""}`);
  return json;
}
const step = (t) => console.log(`→ ${t}`);

// No duplicar: si la demo ya está cargada, no se vuelve a cargar.
if ((await api("GET", "/events")).items.some((e) => e.name === "Open Demo 1000")) {
  console.log("✓ La demo ya estaba cargada (existe «Open Demo 1000»). No se cargó nada nuevo.");
  process.exit(0);
}

// ─── Base: temporada y categorías C5–C8 ───
const seasons = (await api("GET", "/seasons")).items;
let season = seasons.find((s) => s.year === 2026 && s.status !== "cerrada");
if (!season) {
  step("Temporada 2026");
  season = (await api("POST", "/seasons", { name: "Temporada 2026 (demo)", year: 2026, startDate: "2026-01-01", endDate: "2026-12-31" })).item;
}
if (season.status !== "activa") await api("PATCH", `/seasons/${season.id}/status`, { status: "activa" }).catch(() => {});
const cats = (await api("GET", "/categories")).items;
const cat = {};
for (const [name, level] of [["C5", 5], ["C6", 6], ["C7", 7], ["C8", 8]]) {
  cat[name] = cats.find((c) => c.gender === "M" && c.name === name) ?? (await api("POST", "/categories", { name, gender: "M", level })).item;
}
step("Categorías C5, C6, C7 y C8");

// ─── Jugadores ficticios ───
const FIRST = ["Martín", "Lucas", "Diego", "Santiago", "Matías", "Nicolás", "Facundo", "Joaquín", "Tomás", "Federico", "Gonzalo", "Pablo", "Agustín", "Ezequiel", "Franco", "Leandro", "Ignacio", "Hernán", "Bruno", "Maximiliano"];
const LAST = ["Álvarez", "Benítez", "Cabrera", "Domínguez", "Escobar", "Ferreyra", "Giménez", "Herrera", "Ibáñez", "Juárez", "Ledesma", "Medina", "Navarro", "Ortiz", "Peralta", "Quiroga", "Ríos", "Sosa", "Toledo", "Vera"];
let n = 0;
async function players(categoryId, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const firstName = FIRST[(n * 7) % FIRST.length];
    const lastName = LAST[(n * 3 + Math.floor(n / LAST.length)) % LAST.length];
    n++;
    out.push((await api("POST", "/players", { firstName, lastName, nickname: "Demo", gender: "M", mainCategoryId: categoryId, city: "Belén de Escobar" })).item);
  }
  return out;
}
async function teams(tid, ps) {
  for (let i = 0; i < ps.length; i += 2) await api("POST", `/tournaments/${tid}/teams`, { player1Id: ps[i].id, player2Id: ps[i + 1].id, seed: i / 2 < 2 ? i / 2 + 1 : null });
}
const W = [[6, 3], [6, 4]];
const L = [[3, 6], [4, 6]];
const fixture = (tid) => api("GET", `/tournaments/${tid}/fixture`).then((r) => r.item);
async function groups(tid, count, date) {
  let s = await fixture(tid);
  s = (await api("PUT", `/tournaments/${tid}/fixture/config`, { version: s.version, config: { ...s.config, groupCount: count, goldPerGroup: 2, silver: "resto" } })).item;
  const active = s.teams.filter((t) => !t.withdrawn);
  const seeded = [...active].sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99) || a.id - b.id);
  const gs = Array.from({ length: count }, () => []);
  seeded.forEach((t, i) => gs[Math.floor(i / count) % 2 === 0 ? i % count : count - 1 - (i % count)].push(t.id));
  s = (await api("PUT", `/tournaments/${tid}/fixture/groups`, { version: s.version, groups: gs })).item;
  s = (await api("POST", `/tournaments/${tid}/fixture/schedule`, { version: s.version, phase: "grupos", groupId: null, startDate: date, intervalDays: 7, time: "21:00", court: "Cancha 1", overwrite: true })).item;
  return s;
}
async function play(tid, filter) {
  const s = await fixture(tid);
  for (const m of s.matches.filter(filter)) {
    if (m.status !== "pendiente" || m.team1Id === null || m.team2Id === null) continue;
    await api("PUT", `/tournaments/${tid}/fixture/matches/${m.id}/result`, { version: m.version, status: "jugado", sets: m.team1Id < m.team2Id ? W : [[6, 4], [3, 6], [7, 5]] });
  }
}
async function publish(tid) {
  const s = await fixture(tid);
  await api("POST", `/tournaments/${tid}/fixture/publish`, { version: s.version });
}

// ─── Torneo largo con tres categorías ───
step("Torneo largo «Open Demo 1000» con C5, C6 y C7");
const open = (await api("POST", "/events", {
  seasonId: season.id, name: "Open Demo 1000", type: "largo", series: "open_1000", startDate: "2026-08-03", endDate: "2026-10-30",
  venue: "Las Vías Padel Center", publicVisible: true, featured: true, registrationOpen: false,
  publicDescription: "Torneo de demostración: grupos todos contra todos, luego Copa de Oro y Copa de Plata. Partidos a 3 sets con tie break en 6-6.",
  prizeInfo: "Demostración: trofeos para campeones y finalistas de cada copa.",
  competitions: [{ categoryId: cat.C5.id }, { categoryId: cat.C6.id }, { categoryId: cat.C7.id }],
})).item;
const comp = Object.fromEntries(open.tournaments.map((t) => [t.categoryName, t.id]));

// C5: competencia completa → posiciones finales → acreditación.
await teams(comp.C5, await players(cat.C5.id, 16));
await groups(comp.C5, 2, "2026-08-04");
await play(comp.C5, (m) => m.phase === "grupos");
let s5 = await fixture(comp.C5);
const prop = await api("GET", `/tournaments/${comp.C5}/fixture/brackets/proposal`);
s5 = (await api("POST", `/tournaments/${comp.C5}/fixture/brackets`, { version: s5.version, brackets: prop.brackets })).item;
await play(comp.C5, (m) => m.phase !== "grupos" && m.round === 1);
await play(comp.C5, (m) => m.phase !== "grupos" && m.round === 2);
await publish(comp.C5);
const fp = await api("POST", `/tournaments/${comp.C5}/fixture/final/preview`, { stageMap: null });
s5 = await fixture(comp.C5);
await api("POST", `/tournaments/${comp.C5}/fixture/final`, { version: s5.version, stageMap: fp.stageMap });
const pv = await api("GET", `/tournaments/${comp.C5}/preview`);
await api("POST", `/tournaments/${comp.C5}/credits`, { previewHash: pv.previewHash });
step("  C5: terminado, posiciones aplicadas y puntos acreditados");

// C6: en curso (grupos a medio jugar), fixture publicado.
await teams(comp.C6, await players(cat.C6.id, 12));
await groups(comp.C6, 2, "2026-08-06");
const s6 = await fixture(comp.C6);
const half = new Set(s6.matches.filter((m) => m.round <= 2).map((m) => m.id));
await play(comp.C6, (m) => half.has(m.id));
await publish(comp.C6);
step("  C6: fase de grupos en curso, fixture publicado");

// C7: parejas inscriptas y grupos armados, sin resultados.
await teams(comp.C7, await players(cat.C7.id, 8));
await groups(comp.C7, 1, "2026-08-05");
await publish(comp.C7);
step("  C7: grupos armados, sin resultados");

// ─── Satélite (americano) con cuadro final cargado y acreditado ───
step("Satélite «Satélite Demo 100» (C8) con resultado final y puntos");
const sat = (await api("POST", "/events", {
  seasonId: season.id, name: "Satélite Demo 100", type: "americano", series: "satelite_100", startDate: "2026-09-12",
  venue: "Las Vías Padel Center", publicVisible: true, competitions: [{ categoryId: cat.C8.id }],
})).item;
const sid = sat.tournaments[0].id;
await teams(sid, await players(cat.C8.id, 8));
const stages = (await api("GET", `/tournaments/${sid}/scoring`)).item.stages.sort((a, b) => a.rank - b.rank);
const satTeams = (await api("GET", `/tournaments/${sid}/teams`)).items;
const order = [0, 1, 2, 2]; // campeón, finalista, dos semifinalistas
await api("PUT", `/tournaments/${sid}/results`, { results: satTeams.map((t, i) => ({ teamId: t.id, stageId: stages[Math.min(order[i] ?? stages.length - 1, stages.length - 1)].id, matchesPlayed: 0, matchesWon: 0 })) });
await api("PATCH", `/tournaments/${sid}/status`, { status: "en_curso" });
const pvs = await api("GET", `/tournaments/${sid}/preview`);
await api("POST", `/tournaments/${sid}/credits`, { previewHash: pvs.previewHash });

// ─── Próximo torneo (programado) ───
step("Próximo torneo «Challenger Demo 500» (C5 y C8, inscripción abierta)");
await api("POST", "/events", {
  seasonId: season.id, name: "Challenger Demo 500", type: "largo", series: "challenger_500", startDate: "2026-12-01", endDate: "2026-12-30",
  venue: "Las Vías Padel Center", publicVisible: true, registrationOpen: true,
  publicDescription: "Próximo torneo de demostración. La inscripción abre el botón de WhatsApp configurado.",
  competitions: [{ categoryId: cat.C5.id }, { categoryId: cat.C8.id }],
});

// ─── Contenidos ───
step("Novedad de bienvenida");
try {
  const content = { title: "Bienvenidos a la demo de Padel Time", excerpt: "Este es el entorno de prueba: los torneos, jugadores y rankings son ficticios.", pinned: true,
    blocks: [{ type: "paragraph", text: "Recorré Torneos, Rankings y Calendario. Todo lo que ves es de demostración y no forma parte de la web oficial." }] };
  const post = (await api("POST", "/cms/posts", { content })).item;
  await api("POST", `/cms/posts/${post.id}/publish`, { version: post.version });
} catch (e) {
  console.log(`  (novedad omitida: ${e.message})`);
}

console.log(`\n✓ Datos de demostración cargados en ${origin}`);
console.log(`  Web: ${origin}/torneos · Rankings: ${origin}/rankings · Panel: ${origin}/admin`);
