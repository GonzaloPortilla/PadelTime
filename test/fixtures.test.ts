/**
 * Fase 9 · Fixtures de torneos largos (integración con la base y la API):
 * eventos con varias categorías, grupos, resultados, tablas, Copa de Oro / Plata, BYE, correcciones con
 * conflictos, retiros, publicación en la web, edición simultánea, permisos e integridad de lo existente.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { distributeGroups, drawOrder, type FixtureState, type SetScore } from "@shared/fixture";
import { Client, createUser, loggedInAdmin, rawFetch, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const W: SetScore[] = [[6, 3], [6, 4]];
const L: SetScore[] = [[3, 6], [4, 6]];

async function setup(teamCount = 8, eventCategories?: (b: Awaited<ReturnType<typeof seedBasics>>) => number[]) {
  const { client } = await loggedInAdmin();
  const base = await seedBasics(client);
  const cats = eventCategories ? eventCategories(base) : [base.cab4.id, base.cab5.id];
  const ev = await client.post("/api/events", {
    seasonId: base.season.id, name: "Qatar Major 2000", series: "master_2000", startDate: "2026-06-01", endDate: "2026-07-31",
    venue: "Las Vías", categoryIds: cats, publicVisible: true,
  });
  expect(ev.status).toBe(201);
  const tournament = ev.json.item.tournaments.find((t: Json) => t.categoryId === base.cab4.id) as Json;
  const teams: number[] = [];
  for (let i = 0; i < teamCount; i++) {
    const p1 = (await client.post("/api/players", { firstName: `Ana${i}`, lastName: `Uno${i}`, gender: "M", mainCategoryId: base.cab4.id })).json.item;
    const p2 = (await client.post("/api/players", { firstName: `Beto${i}`, lastName: `Dos${i}`, gender: "M", mainCategoryId: base.cab4.id })).json.item;
    const r = await client.post(`/api/tournaments/${tournament.id}/teams`, { player1Id: p1.id, player2Id: p2.id });
    expect(r.status).toBe(201);
    teams.push((r.json.items as Json[]).at(-1)!.id);
  }
  return { client, base, event: ev.json.item as Json, tid: tournament.id as number, teams };
}

const fx = async (c: Client, tid: number) => (await c.get(`/api/tournaments/${tid}/fixture`)).json.item as FixtureState;

async function makeGroups(c: Client, tid: number, groupCount = 2) {
  let s = await fx(c, tid);
  if (s.config.groupCount !== groupCount) {
    s = (await c.put(`/api/tournaments/${tid}/fixture/config`, { version: s.version, config: { ...s.config, groupCount } })).json.item;
  }
  const groups = distributeGroups(drawOrder(s.teams, null), groupCount).map((g) => g.map((t) => t.id));
  const r = await c.put(`/api/tournaments/${tid}/fixture/groups`, { version: s.version, groups });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.item as FixtureState;
}

async function result(c: Client, tid: number, matchId: number, body: Json) {
  const s = await fx(c, tid);
  const m = s.matches.find((x) => x.id === matchId)!;
  return c.put(`/api/tournaments/${tid}/fixture/matches/${matchId}/result`, { version: m.version, ...body });
}

/** Resultado de todos los partidos de grupo: gana siempre la pareja de id menor (orden total y sin empates). */
async function playGroups(c: Client, tid: number) {
  let s = await fx(c, tid);
  for (const m of s.matches.filter((x) => x.phase === "grupos")) {
    const r = await result(c, tid, m.id, { status: "jugado", sets: m.team1Id! < m.team2Id! ? W : L });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  }
  s = await fx(c, tid);
  return s;
}

async function organizer(name = "orga") {
  await createUser(name, "clave-segura-456", "organizador");
  const c = new Client();
  await c.login(name, "clave-segura-456");
  return c;
}

describe("eventos con varias categorías", () => {
  it("crea un evento con una competencia (torneo largo) por categoría y rechaza ramas discontinuadas", async () => {
    const { client, base, event } = await setup(0);
    expect(event.tournaments.map((t: Json) => t.categoryName).sort()).toEqual(["4ta", "5ta"]);
    expect(event.tournaments.every((t: Json) => t.type === "largo" && t.eventId === event.id && t.name === "Qatar Major 2000")).toBe(true);
    // Cada categoría tiene su propia puntuación copiada de la plantilla (no se duplican datos deportivos).
    const scoring = (await client.get(`/api/tournaments/${event.tournaments[0].id}/scoring`)).json.item;
    expect(scoring.stages.length).toBeGreaterThan(0);
    const damas = await client.post("/api/events", { seasonId: base.season.id, name: "X", startDate: "2026-06-01", endDate: "2026-06-30", categoryIds: [base.dam4.id] });
    expect(damas.status).toBe(400);
    expect(damas.json.error.message).toContain("discontinuada");
    // Agregar una categoría ya incluida → conflicto.
    const dup = await client.put(`/api/events/${event.id}`, { seasonId: base.season.id, name: "Qatar Major 2000", startDate: "2026-06-01", endDate: "2026-07-31", categoryIds: [base.cab4.id] });
    expect(dup.status).toBe(409);
  });

  it("al borrar el evento las categorías se conservan como torneos sueltos", async () => {
    const { client, event } = await setup(0);
    expect((await client.delete(`/api/events/${event.id}`)).status).toBe(200);
    const t = (await client.get(`/api/tournaments/${event.tournaments[0].id}`)).json.item;
    expect(t.eventId).toBeNull();
  });
});

describe("fase de grupos", () => {
  it("arma los grupos, genera todos contra todos y valida la distribución", async () => {
    const { client, tid, teams } = await setup(8);
    const s = await makeGroups(client, tid);
    expect(s.groups.map((g) => g.teamIds.length)).toEqual([4, 4]);
    expect(s.matches.filter((m) => m.phase === "grupos")).toHaveLength(12);
    // Grupos que no incluyen a todas las parejas, o con repetidas → rechazo.
    const bad1 = await client.put(`/api/tournaments/${tid}/fixture/groups`, { version: s.version, groups: [teams.slice(0, 4), teams.slice(4, 7)] });
    expect(bad1.status).toBe(400);
    const bad2 = await client.put(`/api/tournaments/${tid}/fixture/groups`, { version: s.version, groups: [teams.slice(0, 4), [...teams.slice(4, 7), teams[0]]] });
    expect(bad2.status).toBe(400);
  });

  it("carga resultados, calcula tablas y bloquea rearmar grupos con resultados", async () => {
    const { client, tid } = await setup(8);
    const s0 = await makeGroups(client, tid);
    const m = s0.matches[0]!;
    const bad = await result(client, tid, m.id, { status: "jugado", sets: [[6, 5], [6, 0]] });
    expect(bad.status).toBe(400);
    const ok = await result(client, tid, m.id, { status: "jugado", sets: [[6, 4], [3, 6], [7, 6]] });
    expect(ok.status).toBe(200);
    const st = (ok.json.item as FixtureState).standings.find((x) => x.groupId === m.groupId)!;
    const row = st.rows.find((r) => r.teamId === m.team1Id)!;
    expect(row).toMatchObject({ played: 1, won: 1, setsWon: 2, setsLost: 1, gamesWon: 16, gamesLost: 16 });
    const again = await client.put(`/api/tournaments/${tid}/fixture/groups`, { version: (ok.json.item as FixtureState).version, groups: s0.groups.map((g) => g.teamIds) });
    expect(again.status).toBe(409);
  });

  it("una corrección exige motivo y queda en el historial", async () => {
    const { client, tid } = await setup(4);
    const s0 = await makeGroups(client, tid, 1);
    const m = s0.matches[0]!;
    await result(client, tid, m.id, { status: "jugado", sets: W });
    const noReason = await result(client, tid, m.id, { status: "jugado", sets: L });
    expect(noReason.status).toBe(400);
    const fixed = await result(client, tid, m.id, { status: "jugado", sets: L, reason: "Se cargó invertido" });
    expect(fixed.status).toBe(200);
    const hist = (await client.get(`/api/tournaments/${tid}/fixture/history`)).json.items as Json[];
    expect(hist.map((h) => h.action)).toEqual(["correccion", "resultado"]);
    expect(hist[0]).toMatchObject({ reason: "Se cargó invertido", before: { winner: 1 }, after: { winner: 2 } });
  });

  it("empate sin resolver: no deja armar los cuadros hasta definir el orden a mano", async () => {
    const { client, tid } = await setup(3);
    let s = await makeGroups(client, tid, 1);
    // Círculo: 1>2, 2>3, 3>1 con marcadores idénticos → empate total.
    const [a, b, c] = s.groups[0]!.teamIds as [number, number, number];
    for (const m of s.matches) {
      const winnerTeam = (m.team1Id === a && m.team2Id === b) || (m.team1Id === b && m.team2Id === c) || (m.team1Id === c && m.team2Id === a) ? 1
        : (m.team2Id === a && m.team1Id === b) || (m.team2Id === b && m.team1Id === c) || (m.team2Id === c && m.team1Id === a) ? 2 : 1;
      await result(client, tid, m.id, { status: "jugado", sets: winnerTeam === 1 ? W : L });
    }
    s = await fx(client, tid);
    expect(s.standings[0]!.unresolved).toHaveLength(1);
    expect(s.issues.some((i) => i.code === "empate")).toBe(true);
    const prop = (await client.get(`/api/tournaments/${tid}/fixture/brackets/proposal`)).json;
    expect(prop.ready).toBe(false);
    const order = await client.put(`/api/tournaments/${tid}/fixture/groups/${s.groups[0]!.id}/order`, { version: s.version, teamIds: [c, a, b] });
    expect(order.status).toBe(200);
    expect((order.json.item as FixtureState).standings[0]!.rows.map((r) => r.teamId)).toEqual([c, a, b]);
    expect((await client.get(`/api/tournaments/${tid}/fixture/brackets/proposal`)).json.ready).toBe(true);
  });
});

describe("Copa de Oro / Plata, avances y conflictos", () => {
  it("clasifica a Oro y Plata, completa la final y no sobrescribe partidos jugados", async () => {
    const { client, tid } = await setup(8);
    await makeGroups(client, tid);
    let s = await playGroups(client, tid);
    expect(s.standings.every((x) => x.complete)).toBe(true);

    const prop = (await client.get(`/api/tournaments/${tid}/fixture/brackets/proposal`)).json;
    expect(prop.ready).toBe(true);
    expect(prop.brackets.map((b: Json) => b.phase)).toEqual(["oro", "plata"]);
    // Una propuesta con parejas cambiadas por otras no se acepta; un intercambio de lugares sí.
    const tampered = structuredClone(prop.brackets);
    tampered[0].pairs[0][0] = { kind: "pareja", teamId: 1 };
    expect((await client.post(`/api/tournaments/${tid}/fixture/brackets`, { version: s.version, brackets: tampered })).status).toBe(400);
    const swapped = structuredClone(prop.brackets);
    [swapped[0].pairs[0][1], swapped[0].pairs[1][1]] = [swapped[0].pairs[1][1], swapped[0].pairs[0][1]];
    const created = await client.post(`/api/tournaments/${tid}/fixture/brackets`, { version: s.version, brackets: swapped });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    s = created.json.item;

    const gold = s.matches.filter((m) => m.phase === "oro");
    expect(gold).toHaveLength(3); // 2 semifinales + final
    const [sf1, sf2, final] = [gold.find((m) => m.round === 1 && m.slot === 0)!, gold.find((m) => m.round === 1 && m.slot === 1)!, gold.find((m) => m.round === 2)!];
    // Los cuatro de Oro son 1° y 2° de cada grupo.
    const goldTeams = [sf1.team1Id, sf1.team2Id, sf2.team1Id, sf2.team2Id];
    const top2 = s.standings.flatMap((st) => st.rows.slice(0, 2).map((r) => r.teamId));
    expect(goldTeams.sort()).toEqual(top2.sort());
    expect(s.matches.filter((m) => m.phase === "plata")).toHaveLength(3);
    expect(final.team1Id).toBeNull();

    await result(client, tid, sf1.id, { status: "jugado", sets: W });
    s = (await result(client, tid, sf2.id, { status: "jugado", sets: W })).json.item;
    const f2 = s.matches.find((m) => m.id === final.id)!;
    expect([f2.team1Id, f2.team2Id]).toEqual([sf1.team1Id, sf2.team1Id]);

    // Se juega la final y después se corrige una semifinal: la final NO se toca, se informa el conflicto.
    s = (await result(client, tid, final.id, { status: "jugado", sets: W })).json.item;
    s = (await result(client, tid, sf2.id, { status: "jugado", sets: L, reason: "Error de carga" })).json.item;
    const f3 = s.matches.find((m) => m.id === final.id)!;
    expect(f3).toMatchObject({ team2Id: sf2.team1Id, status: "jugado", winner: 1 });
    expect(s.conflicts).toEqual([expect.objectContaining({ matchId: final.id, side: 2, current: sf2.team1Id, expected: sf2.team2Id })]);
    expect(s.issues.some((i) => i.code === "conflicto")).toBe(true);

    // Resolución administrativa: un organizador no puede anular; un administrador sí, y el cruce se completa.
    const org = await organizer();
    const denied = await org.post(`/api/tournaments/${tid}/fixture/matches/${final.id}/annul`, { version: f3.version, reason: "Conflicto por corrección" });
    expect(denied.status).toBe(403);
    const annulled = await client.post(`/api/tournaments/${tid}/fixture/matches/${final.id}/annul`, { version: f3.version, reason: "Conflicto por corrección" });
    expect(annulled.status).toBe(200);
    s = annulled.json.item;
    expect(s.conflicts).toEqual([]);
    expect(s.matches.find((m) => m.id === final.id)).toMatchObject({ status: "pendiente", team2Id: sf2.team2Id });
  });

  it("eliminación directa con cabezas de serie y BYE automáticos", async () => {
    const { client, tid, teams } = await setup(6);
    let s = await fx(client, tid);
    const cfg = { ...s.config, format: "eliminacion" };
    s = (await client.put(`/api/tournaments/${tid}/fixture/config`, { version: s.version, config: cfg })).json.item;
    // Las cabezas de serie se cargan en la pareja (como hasta ahora).
    const teamRows = (await client.get(`/api/tournaments/${tid}/teams`)).json.items as Json[];
    const t5 = teamRows.find((t) => t.id === teams[5])!;
    await client.put(`/api/teams/${t5.id}`, { player1Id: t5.players[0].id, player2Id: t5.players[1].id, seed: 1 });
    s = await fx(client, tid);
    const prop = (await client.get(`/api/tournaments/${tid}/fixture/brackets/proposal`)).json;
    expect(prop.brackets[0].phase).toBe("cuadro");
    expect(prop.brackets[0].pairs[0]).toEqual([{ kind: "pareja", teamId: teams[5] }, { kind: "bye" }]);
    s = (await client.post(`/api/tournaments/${tid}/fixture/brackets`, { version: s.version, brackets: prop.brackets })).json.item;
    const r1 = s.matches.filter((m) => m.phase === "cuadro" && m.round === 1);
    expect(r1.filter((m) => m.status === "bye")).toHaveLength(2);
    const semi = s.matches.find((m) => m.phase === "cuadro" && m.round === 2 && m.slot === 0)!;
    expect(semi.team1Id).toBe(teams[5]); // el BYE avanzó solo
    const byeMatch = r1.find((m) => m.status === "bye")!;
    expect((await result(client, tid, byeMatch.id, { status: "jugado", sets: W })).status).toBe(409);
  });

  it("retiro de una pareja con W.O. en sus partidos pendientes", async () => {
    const { client, tid, teams } = await setup(4);
    let s = await makeGroups(client, tid, 1);
    s = (await client.post(`/api/tournaments/${tid}/fixture/teams/${teams[0]}/withdraw`, { version: s.version, reason: "Lesión", walkover: true })).json.item;
    const theirs = s.matches.filter((m) => m.team1Id === teams[0] || m.team2Id === teams[0]);
    expect(theirs.every((m) => m.status === "wo" && (m.team1Id === teams[0] ? m.winner === 2 : m.winner === 1))).toBe(true);
    const st = s.standings[0]!;
    expect(st.rows.at(-1)).toMatchObject({ teamId: teams[0], withdrawn: true, lost: 3 });
    const hist = (await client.get(`/api/tournaments/${tid}/fixture/history`)).json.items as Json[];
    expect(hist.filter((h) => h.action === "retiro")).toHaveLength(3);
  });
});

describe("publicación del fixture", () => {
  it("la web muestra sólo lo publicado y se actualiza al volver a publicar", async () => {
    const { client, tid } = await setup(4);
    const t = (await client.get(`/api/tournaments/${tid}`)).json.item as Json;
    const page = async () => (await rawFetch(`/torneos/${t.name.toLowerCase().replace(/\s+/g, "-")}-${tid}`, { redirect: "follow" })).text();
    let s = await makeGroups(client, tid, 1);
    expect(await page()).not.toContain('id="fixture"');

    const pub = await client.post(`/api/tournaments/${tid}/fixture/publish`, { version: s.version });
    expect(pub.status).toBe(200);
    s = pub.json.item;
    expect(s.publication?.fixtureVersion).toBe(s.version);
    let html = await page();
    expect(html).toContain('id="fixture"');
    expect(html).toContain("Grupos y posiciones");
    expect(html).toContain("Ana0 Uno0 / Beto0 Dos0");
    expect(html).not.toContain("6-3 6-4");

    // Un resultado nuevo no aparece hasta publicar otra vez.
    s = (await result(client, tid, s.matches[0]!.id, { status: "jugado", sets: W })).json.item;
    expect(s.version).toBeGreaterThan(s.publication!.fixtureVersion);
    expect(await page()).not.toContain("6-3 6-4");
    await client.post(`/api/tournaments/${tid}/fixture/publish`, { version: s.version });
    html = await page();
    expect(html).toContain("6-3 6-4");
    expect(html).not.toContain("teamId");

    // Quitar de la web.
    s = await fx(client, tid);
    expect((await client.request("DELETE", `/api/tournaments/${tid}/fixture/publish`, { version: s.version })).status).toBe(200);
    expect(await page()).not.toContain('id="fixture"');
  });

  it("la página del torneo enlaza las otras categorías del evento", async () => {
    const { client, event, tid } = await setup(0);
    const other = event.tournaments.find((x: Json) => x.id !== tid);
    const res = await rawFetch(`/torneos/qatar-major-2000-${tid}`);
    const html = await res.text();
    expect(html).toContain(`qatar-major-2000-${other.id}`);
    void client;
  });
});

describe("edición simultánea, alcance e integridad", () => {
  it("dos organizadores: el segundo en modificar la estructura recibe 409 y nada se pisa", async () => {
    const { client, tid } = await setup(4);
    const org = await organizer();
    const s = await fx(client, tid);
    const a = await client.put(`/api/tournaments/${tid}/fixture/config`, { version: s.version, config: { ...s.config, groupCount: 1 } });
    expect(a.status).toBe(200);
    const b = await org.put(`/api/tournaments/${tid}/fixture/config`, { version: s.version, config: { ...s.config, groupCount: 3 } });
    expect(b.status).toBe(409);
    expect(b.json.error.message).toContain("ADMIN");
    expect((await fx(client, tid)).config.groupCount).toBe(1);
  });

  it("dos organizadores cargando el mismo partido: el segundo recibe 409", async () => {
    const { client, tid } = await setup(4);
    const org = await organizer();
    const s = await makeGroups(client, tid, 1);
    const m = s.matches[0]!;
    expect((await client.put(`/api/tournaments/${tid}/fixture/matches/${m.id}/result`, { version: m.version, status: "jugado", sets: W })).status).toBe(200);
    expect((await org.put(`/api/tournaments/${tid}/fixture/matches/${m.id}/result`, { version: m.version, status: "jugado", sets: L })).status).toBe(409);
    // Otro partido distinto sí se puede cargar sin recargar (no se bloquea a todos por un cambio ajeno).
    const m2 = s.matches[1]!;
    expect((await org.put(`/api/tournaments/${tid}/fixture/matches/${m2.id}/result`, { version: m2.version, status: "jugado", sets: L })).status).toBe(200);
  });

  it("los Satélites / Americanos no tienen fixture", async () => {
    const { client } = await loggedInAdmin();
    const base = await seedBasics(client);
    const t = (await client.post("/api/tournaments", { seasonId: base.season.id, name: "Satélite", type: "americano", categoryId: base.cab4.id, startDate: "2026-05-01" })).json.item;
    const r = await client.get(`/api/tournaments/${t.id}/fixture`);
    expect(r.status).toBe(409);
    expect(r.json.error.message).toContain("sólo para torneos largos");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM tournament_fixtures WHERE tournament_id = ?").bind(t.id).first("n")).toBe(0);
    // Un americano no se puede agrupar en un evento.
    const ev = await client.post("/api/tournaments", { seasonId: base.season.id, name: "Sat 2", type: "americano", categoryId: base.cab4.id, startDate: "2026-05-02", eventId: 1 });
    expect(ev.status).toBe(400);
  });

  it("una pareja en el fixture queda fija: no se cambian sus jugadores ni se borra", async () => {
    const { client, tid, teams, base } = await setup(4);
    await makeGroups(client, tid, 1);
    const rows = (await client.get(`/api/tournaments/${tid}/teams`)).json.items as Json[];
    const team = rows.find((t) => t.id === teams[0])!;
    const other = (await client.post("/api/players", { firstName: "Nuevo", lastName: "Jugador", gender: "M", mainCategoryId: base.cab4.id })).json.item;
    expect((await client.put(`/api/teams/${team.id}`, { player1Id: team.players[0].id, player2Id: other.id, seed: null })).status).toBe(409);
    expect((await client.put(`/api/teams/${team.id}`, { player1Id: team.players[0].id, player2Id: team.players[1].id, seed: 3 })).status).toBe(200);
    expect((await client.delete(`/api/teams/${team.id}`)).status).toBe(409);
  });

  it("cupo de parejas configurable", async () => {
    const { client, tid, base } = await setup(2);
    const s = await fx(client, tid);
    expect((await client.put(`/api/tournaments/${tid}/fixture/config`, { version: s.version, config: { ...s.config, maxTeams: 1 } })).status).toBe(400);
    await client.put(`/api/tournaments/${tid}/fixture/config`, { version: s.version, config: { ...s.config, maxTeams: 2 } });
    const p1 = (await client.post("/api/players", { firstName: "X", lastName: "Y", gender: "M", mainCategoryId: base.cab4.id })).json.item;
    const p2 = (await client.post("/api/players", { firstName: "Z", lastName: "W", gender: "M", mainCategoryId: base.cab4.id })).json.item;
    const r = await client.post(`/api/tournaments/${tid}/teams`, { player1Id: p1.id, player2Id: p2.id });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toContain("cupo");
  });

  it("el fixture no toca acreditaciones ni movimientos de puntos", async () => {
    const { client, tid } = await setup(4);
    const before = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM point_movements) AS m, (SELECT COUNT(*) FROM tournament_credits) AS c").first<Json>();
    await makeGroups(client, tid, 1);
    await playGroups(client, tid);
    const s = await fx(client, tid);
    await client.post(`/api/tournaments/${tid}/fixture/publish`, { version: s.version });
    const after = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM point_movements) AS m, (SELECT COUNT(*) FROM tournament_credits) AS c").first<Json>();
    expect(after).toEqual(before);
    // La acreditación sigue funcionando como siempre (instancias cargadas a mano en "Parejas y resultados").
    const preview = await client.get(`/api/tournaments/${tid}/preview`);
    expect(preview.status).toBe(200);
  });

  it("cabezas de serie por ranking: suma de los puntos de los dos integrantes", async () => {
    const { client, tid, teams } = await setup(4);
    const rows = (await client.get(`/api/tournaments/${tid}/teams`)).json.items as Json[];
    const t = (await client.get(`/api/tournaments/${tid}`)).json.item as Json;
    // Ajustes manuales: la pareja 3 suma 300, la 2 suma 100.
    for (const [teamId, pts] of [[teams[2], 200], [teams[1], 100]] as const) {
      const team = rows.find((x) => x.id === teamId)!;
      for (const p of team.players) {
        await env.DB.prepare("INSERT INTO point_movements (season_id, player_id, category_id, kind, points, reason) VALUES (?, ?, ?, 'ajuste', ?, 'prueba')").bind(t.seasonId, p.id, t.categoryId, pts / 2 + (teamId === teams[2] ? 50 : 0)).run();
      }
    }
    const s = await fx(client, tid);
    const r = await client.post(`/api/tournaments/${tid}/fixture/seed-by-ranking`, { version: s.version, count: 2 });
    expect(r.status).toBe(200);
    const seeds = (r.json.item as FixtureState).teams.filter((x) => x.seed !== null).sort((a, b) => a.seed! - b.seed!).map((x) => x.id);
    expect(seeds).toEqual([teams[2], teams[1]]);
  });
});
