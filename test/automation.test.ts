/**
 * Fase 10 · Automatización integral: fixture de un torneo largo → posiciones finales → motor de
 * puntuación existente → acreditación → ranking anual. Correcciones con diferencias y reacreditación
 * por el mecanismo transaccional existente, sin duplicados. Compatibilidad con torneos antiguos.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { distributeGroups, drawOrder, type FixtureState, type SetScore } from "@shared/fixture";
import { Client, createUser, loggedInAdmin, rawFetch, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const W: SetScore[] = [[6, 3], [6, 4]];
const L: SetScore[] = [[3, 6], [4, 6]];

const fx = async (c: Client, tid: number) => (await c.get(`/api/tournaments/${tid}/fixture`)).json.item as FixtureState;
async function result(c: Client, tid: number, matchId: number, body: Json) {
  const m = (await fx(c, tid)).matches.find((x) => x.id === matchId)!;
  return c.put(`/api/tournaments/${tid}/fixture/matches/${matchId}/result`, { version: m.version, ...body });
}
const ranking = async (c: Client, seasonId: number, categoryId: number) =>
  (await c.get(`/api/rankings?seasonId=${seasonId}&categoryId=${categoryId}`)).json.rows as Json[];

/**
 * Competencia de demostración: evento con 4ta y 5ta; en 4ta, 8 parejas en 2 grupos, 2 a Oro y el resto a Plata.
 * Un jugador de la pareja 0 tiene categoría principal 5ta (juega en 4ta): sus puntos van al ranking de 5ta.
 */
async function demo() {
  const { client, user } = await loggedInAdmin();
  const base = await seedBasics(client);
  const ev = (await client.post("/api/events", {
    seasonId: base.season.id, name: "Qatar Major 2000", series: "master_2000", startDate: "2026-06-01", endDate: "2026-07-31",
    categoryIds: [base.cab4.id, base.cab5.id], publicVisible: true,
  })).json.item;
  const tid = ev.tournaments.find((t: Json) => t.categoryId === base.cab4.id).id as number;
  const teams: number[] = [];
  const players: Json[][] = [];
  for (let i = 0; i < 8; i++) {
    const p1 = (await client.post("/api/players", { firstName: `Ana${i}`, lastName: `Uno${i}`, gender: "M", mainCategoryId: i === 0 ? base.cab5.id : base.cab4.id })).json.item;
    const p2 = (await client.post("/api/players", { firstName: `Beto${i}`, lastName: `Dos${i}`, gender: "M", mainCategoryId: base.cab4.id })).json.item;
    const r = await client.post(`/api/tournaments/${tid}/teams`, { player1Id: p1.id, player2Id: p2.id });
    teams.push((r.json.items as Json[]).at(-1)!.id);
    players.push([p1, p2]);
  }
  let s = await fx(client, tid);
  const groups = distributeGroups(drawOrder(s.teams, null), 2).map((g) => g.map((t) => t.id));
  s = (await client.put(`/api/tournaments/${tid}/fixture/groups`, { version: s.version, groups })).json.item;
  // Grupos: gana siempre la pareja inscripta antes.
  for (const m of s.matches) await result(client, tid, m.id, { status: "jugado", sets: m.team1Id! < m.team2Id! ? W : L });
  s = await fx(client, tid);
  const prop = (await client.get(`/api/tournaments/${tid}/fixture/brackets/proposal`)).json;
  s = (await client.post(`/api/tournaments/${tid}/fixture/brackets`, { version: s.version, brackets: prop.brackets })).json.item;
  return { client, user, base, tid, teams, players, s };
}

/** Juega todos los partidos de los cuadros: gana siempre la pareja 1 (la mejor sembrada). */
async function playBrackets(c: Client, tid: number) {
  for (let round = 1; round <= 2; round++) {
    const s = await fx(c, tid);
    for (const m of s.matches.filter((x) => x.phase !== "grupos" && x.round === round && x.status === "pendiente")) {
      const r = await result(c, tid, m.id, { status: "jugado", sets: W });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    }
  }
  return fx(c, tid);
}

const finalPreview = async (c: Client, tid: number, stageMap: Json | null = null) => (await c.post(`/api/tournaments/${tid}/fixture/final/preview`, { stageMap })).json;
const confirmCredit = async (c: Client, tid: number, reason?: string) => {
  const p = (await c.get(`/api/tournaments/${tid}/preview`)).json;
  return c.post(`/api/tournaments/${tid}/credits`, { previewHash: p.previewHash, reason });
};

describe("circuito completo: fixture → posiciones finales → acreditación → ranking", () => {
  it("de la competencia al ranking anual con la categoría principal correcta y sin duplicados", async () => {
    const { client, base, tid, teams, players } = await demo();
    expect((await fx(client, tid)).tournament.status).toBe("en_curso"); // armar el fixture inició el torneo

    // Mientras la competencia no termina no hay propuesta de puntos ni movimientos.
    expect((await finalPreview(client, tid)).complete).toBe(false);
    let s = await playBrackets(client, tid);
    expect(s.final.complete).toBe(true);
    expect(s.issues.some((i) => i.code === "puntos_pendientes")).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements").first("n")).toBe(0);

    // Posiciones finales y propuesta de equivalencia con la puntuación del torneo (plantilla "Torneo largo estándar").
    const fp = await finalPreview(client, tid);
    expect(fp.complete).toBe(true);
    const champion = fp.rows.find((r: Json) => r.key === "oro:1");
    expect(champion).toMatchObject({ label: "Campeón · Copa de Oro", stageLabel: "Campeón", matchesPlayed: 5, matchesWon: 5 });
    expect(fp.rows.find((r: Json) => r.key === "oro:2")).toMatchObject({ stageLabel: "Finalista" });
    expect(fp.rows.filter((r: Json) => r.key === "oro:4").map((r: Json) => r.stageLabel)).toEqual(["Semifinal", "Semifinal"]);
    expect(fp.rows.filter((r: Json) => r.key.startsWith("plata")).every((r: Json) => r.stageLabel === "Fase de grupos")).toBe(true);
    expect(fp.review).toEqual(expect.arrayContaining(["plata:1", "plata:2", "plata:4"]));
    expect(fp.preview.canConfirm).toBe(true);
    expect(fp.diff).toBeNull();
    // La propuesta usa el motor existente: 100 / 70 / 50 / 5 por jugador.
    const pts = (teamId: number) => fp.preview.rows.filter((r: Json) => r.teamId === teamId).map((r: Json) => r.points);
    expect(pts(champion.teamId)).toEqual([100, 100]);

    // La carga manual paralela queda bloqueada: una sola fuente de verdad.
    const manual = await client.put(`/api/tournaments/${tid}/results`, { results: [{ teamId: teams[0], stageId: null }] });
    expect(manual.status).toBe(409);
    expect(manual.json.error.message).toContain("Fixture → Puntos");

    // Aplicar no acredita: sólo deja las instancias en las parejas.
    s = await fx(client, tid);
    const applied = await client.post(`/api/tournaments/${tid}/fixture/final`, { version: s.version, stageMap: fp.stageMap });
    expect(applied.status, JSON.stringify(applied.json)).toBe(200);
    expect((applied.json.item as FixtureState).final.applied).toBe(true);
    expect((applied.json.item as FixtureState).tournament.status).toBe("finalizado");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements").first("n")).toBe(0);
    const teamRows = (await client.get(`/api/tournaments/${tid}/teams`)).json.items as Json[];
    expect(teamRows.find((t) => t.id === champion.teamId)).toMatchObject({ matchesPlayed: 5, matchesWon: 5 });

    // Acreditación con el flujo de siempre.
    const credit = await confirmCredit(client, tid);
    expect(credit.status, JSON.stringify(credit.json)).toBe(201);
    // Un segundo intento no duplica.
    expect((await confirmCredit(client, tid)).status).toBe(409);

    // Ranking anual: el jugador de categoría principal 5ta suma en 5ta, su compañero en 4ta.
    const [p1, p2] = players[0] as [Json, Json];
    const r4 = await ranking(client, base.season.id, base.cab4.id);
    const r5 = await ranking(client, base.season.id, base.cab5.id);
    const champTeamIdx = teams.indexOf(champion.teamId);
    expect(champTeamIdx).toBe(0); // la pareja 0 gana todo
    expect(r5.map((x) => [x.playerId, x.points])).toEqual([[p1.id, 100]]);
    expect(r4.find((x) => x.playerId === p2.id)!.points).toBe(100);
    expect(r4.find((x) => x.playerId === p1.id)).toBeUndefined();
    expect(r4).toHaveLength(15);
    // Ausencia de duplicados: un movimiento por jugador.
    const dup = await env.DB.prepare("SELECT player_id, COUNT(*) AS n FROM point_movements WHERE tournament_id = ? GROUP BY player_id HAVING n > 1").bind(tid).all();
    expect(dup.results).toEqual([]);
    s = await fx(client, tid);
    expect(s.final.creditedVersion).toBe(1);
    expect(s.issues.some((i) => i.code.startsWith("puntos_"))).toBe(false);
  });

  it("corrección después de acreditar: muestra diferencias, exige motivo y reacredita sin duplicar", async () => {
    const { client, base, tid, teams, players } = await demo();
    let s = await playBrackets(client, tid);
    const fp = await finalPreview(client, tid);
    await client.post(`/api/tournaments/${tid}/fixture/final`, { version: s.version, stageMap: fp.stageMap });
    expect((await confirmCredit(client, tid)).status).toBe(201);

    // Se corrige la final de Oro: ahora gana la pareja 2.
    s = await fx(client, tid);
    const final = s.matches.find((m) => m.phase === "oro" && m.round === 2)!;
    const dry = await client.post(`/api/tournaments/${tid}/fixture/matches/${final.id}/result-preview`, { status: "jugado", sets: L });
    expect(dry.status).toBe(200);
    expect(dry.json.creditedVersion).toBe(1);
    expect(dry.json.finalChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ before: "Campeón · Copa de Oro", after: "Finalista · Copa de Oro" }),
      expect.objectContaining({ before: "Finalista · Copa de Oro", after: "Campeón · Copa de Oro" }),
    ]));
    // El dry-run no guardó nada.
    expect((await fx(client, tid)).matches.find((m) => m.id === final.id)!.winner).toBe(1);

    expect((await result(client, tid, final.id, { status: "jugado", sets: L })).status).toBe(400); // sin motivo
    s = (await result(client, tid, final.id, { status: "jugado", sets: L, reason: "Se cargó invertido" })).json.item;
    expect(s.issues.find((i) => i.code === "puntos_desactualizados")?.level).toBe("error");
    // Los puntos todavía no cambiaron: nada se modifica en silencio.
    const before = await ranking(client, base.season.id, base.cab5.id);
    expect(before[0]!.points).toBe(100);

    const fp2 = await finalPreview(client, tid);
    expect(fp2.diff.filter((d: Json) => d.delta !== 0).map((d: Json) => d.delta).sort((a: number, b: number) => a - b)).toEqual([-30, -30, 30, 30]);
    expect((await client.post(`/api/tournaments/${tid}/fixture/final`, { version: s.version, stageMap: fp2.stageMap })).status).toBe(400);
    s = (await client.post(`/api/tournaments/${tid}/fixture/final`, { version: s.version, stageMap: fp2.stageMap, reason: "Corrección de la final de Oro" })).json.item;
    expect(s.final.applied).toBe(true);

    // El flujo de corrección existente: exige motivo, revierte y acredita la versión 2 en una transacción.
    const preview = (await client.get(`/api/tournaments/${tid}/preview`)).json;
    expect(preview.upToDate).toBe(false);
    expect(preview.diff.some((d: Json) => d.delta === -30)).toBe(true);
    expect((await confirmCredit(client, tid)).status).toBe(400);
    const corr = await confirmCredit(client, tid, "Corrección de la final de Oro");
    expect(corr.status, JSON.stringify(corr.json)).toBe(201);

    const [p1] = players[0] as [Json];
    expect((await ranking(client, base.season.id, base.cab5.id)).find((x) => x.playerId === p1.id)!.points).toBe(70);
    const sums = await env.DB.prepare("SELECT player_id, SUM(points) AS pts FROM point_movements WHERE tournament_id = ? GROUP BY player_id").bind(tid).all<{ player_id: number; pts: number }>();
    const total = sums.results.reduce((a, r) => a + r.pts, 0);
    expect(total).toBe(2 * (100 + 70 + 50 + 50) + 2 * 4 * 5); // 4 de Oro + 4 de Plata ("Fase de grupos")
    const credits = await env.DB.prepare("SELECT version, status FROM tournament_credits WHERE tournament_id = ? ORDER BY version").bind(tid).all();
    expect(credits.results).toEqual([{ version: 1, status: "reemplazada" }, { version: 2, status: "vigente" }]);
    s = await fx(client, tid);
    expect(s.final.creditedVersion).toBe(2);
    expect(s.issues.some((i) => i.code.startsWith("puntos_"))).toBe(false);
    void teams;
  });

  it("vista previa de una corrección que afecta un partido ya jugado: informa el conflicto antes de guardar", async () => {
    const { client, tid } = await demo();
    let s = await playBrackets(client, tid);
    const semi = s.matches.find((m) => m.phase === "oro" && m.round === 1 && m.slot === 0)!;
    const dry = (await client.post(`/api/tournaments/${tid}/fixture/matches/${semi.id}/result-preview`, { status: "jugado", sets: L })).json;
    expect(dry.conflicts).toHaveLength(1);
    expect(dry.conflicts[0]).toContain("se jugó con");
    expect(dry.bracket).toEqual([]); // la final ya jugada no se toca
    s = await fx(client, tid);
    expect(s.conflicts).toEqual([]);
  });

  it("una equivalencia incompleta no se puede aplicar y la propuesta se puede ajustar (p. ej. Plata)", async () => {
    const { client, tid } = await demo();
    const s = await playBrackets(client, tid);
    const fp = await finalPreview(client, tid);
    const semi = fp.rows.find((r: Json) => r.key === "oro:4").stageId;
    const custom = { ...fp.stageMap, "plata:1": semi };
    const fp2 = await finalPreview(client, tid, custom);
    expect(fp2.rows.find((r: Json) => r.key === "plata:1").stageLabel).toBe("Semifinal");
    expect(fp2.preview.issues.some((i: Json) => i.level === "warning" || i.level === "error")).toBe(true); // supera el cupo de semifinal
    const incomplete = { ...fp.stageMap, grupos: null, "plata:2": null };
    expect((await client.post(`/api/tournaments/${tid}/fixture/final`, { version: s.version, stageMap: incomplete })).status).toBe(400);
    const bogus = { ...fp.stageMap, "oro:64": semi };
    expect((await client.post(`/api/tournaments/${tid}/fixture/final/preview`, { stageMap: bogus })).status).toBe(400);
  });
});

describe("sincronización pública", () => {
  it("la página del torneo muestra fixture y resultado final acreditado, sin duplicar la lista de parejas", async () => {
    const { client, tid } = await demo();
    let s = await playBrackets(client, tid);
    const fp = await finalPreview(client, tid);
    s = (await client.post(`/api/tournaments/${tid}/fixture/final`, { version: s.version, stageMap: fp.stageMap })).json.item;
    await client.post(`/api/tournaments/${tid}/fixture/publish`, { version: s.version });
    await confirmCredit(client, tid);
    const html = await (await rawFetch(`/torneos/qatar-major-2000-${tid}`)).text();
    expect(html).toContain('id="fixture"');
    expect(html).toContain("Resultado final");
    expect(html).toContain("Campeón");
    expect(html).not.toContain("Parejas inscriptas");
  });
});

describe("compatibilidad con torneos antiguos", () => {
  it("un torneo largo sin fixture sigue con la carga manual y la acreditación de siempre", async () => {
    const { client } = await loggedInAdmin();
    const base = await seedBasics(client);
    const t = (await client.post("/api/tournaments", { seasonId: base.season.id, name: "Apertura", type: "largo", categoryId: base.cab4.id, startDate: "2026-03-01", endDate: "2026-04-01" })).json.item;
    const p = await Promise.all([0, 1, 2, 3].map((i) => client.post("/api/players", { firstName: `X${i}`, lastName: `Y${i}`, gender: "M", mainCategoryId: base.cab4.id })));
    const team = ((await client.post(`/api/tournaments/${t.id}/teams`, { player1Id: p[0]!.json.item.id, player2Id: p[1]!.json.item.id })).json.items as Json[]).at(-1)!;
    const scoring = (await client.get(`/api/tournaments/${t.id}/scoring`)).json.item;
    await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
    const res = await client.put(`/api/tournaments/${t.id}/results`, { results: [{ teamId: team.id, stageId: scoring.stages[0].id }] });
    expect(res.status).toBe(200);
    expect((await confirmCredit(client, t.id)).status).toBe(201);
    // Abrir la pestaña Fixture (sin armar nada) no bloquea nada.
    expect((await client.get(`/api/tournaments/${t.id}/fixture`)).status).toBe(200);
    expect((await client.put(`/api/tournaments/${t.id}/results`, { results: [{ teamId: team.id, stageId: scoring.stages[1].id }] })).status).toBe(200);
  });

  it("los Satélites / Americanos conservan su flujo y no tienen fixture", async () => {
    const { client } = await loggedInAdmin();
    const base = await seedBasics(client);
    const t = (await client.post("/api/tournaments", { seasonId: base.season.id, name: "Satélite", type: "americano", categoryId: base.cab4.id, startDate: "2026-05-01", publicVisible: true })).json.item;
    expect((await client.get(`/api/tournaments/${t.id}/fixture`)).status).toBe(409);
    const p = await Promise.all([0, 1].map((i) => client.post("/api/players", { firstName: `S${i}`, lastName: `T${i}`, gender: "M", mainCategoryId: base.cab4.id })));
    const team = ((await client.post(`/api/tournaments/${t.id}/teams`, { player1Id: p[0]!.json.item.id, player2Id: p[1]!.json.item.id })).json.items as Json[]).at(-1)!;
    const scoring = (await client.get(`/api/tournaments/${t.id}/scoring`)).json.item;
    await client.put(`/api/tournaments/${t.id}/results`, { results: [{ teamId: team.id, stageId: scoring.stages[0].id }] });
    await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
    expect((await confirmCredit(client, t.id)).status).toBe(201);
    const html = await (await rawFetch(`/torneos/satelite-${t.id}`)).text();
    expect(html).toContain("Resultado final");
    expect(html).toContain("S0 T0");
    expect(html).not.toContain('id="fixture"');
    void createUser;
  });
});

describe("resguardos de la acreditación con fixture", () => {
  it("no se acredita con la competencia a medio jugar ni con posiciones sin aplicar", async () => {
    const { client, tid } = await demo();
    const p1 = (await client.get(`/api/tournaments/${tid}/preview`)).json;
    expect(p1.canConfirm).toBe(false);
    expect(p1.issues[0].code).toBe("fixture_pendiente");
    expect((await client.post(`/api/tournaments/${tid}/credits`, { previewHash: p1.previewHash })).status).toBe(409);
    await playBrackets(client, tid);
    const p2 = (await client.get(`/api/tournaments/${tid}/preview`)).json;
    expect(p2.issues[0].message).toContain("Fixture → Puntos");
  });
});
