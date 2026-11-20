import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Client, loggedInAdmin, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Escenario base: temporada activa, torneo largo de 4ta Caballeros con la plantilla estándar. */
async function scenario(opts: { type?: "largo" | "americano"; divisionId?: number } = {}) {
  const { client } = await loggedInAdmin();
  const base = await seedBasics(client);
  await client.patch(`/api/seasons/${base.season.id}/status`, { status: "activa" });
  const tournament = (await client.post("/api/tournaments", {
    seasonId: base.season.id, name: "Apertura", type: opts.type ?? "largo", categoryId: base.cab4.id,
    divisionId: opts.divisionId ?? null, startDate: "2026-03-01", endDate: "2026-03-30",
  })).json.item;
  await client.patch(`/api/tournaments/${tournament.id}/status`, { status: "en_curso" });
  const mkPlayer = async (firstName: string, lastName: string, categoryId = base.cab4.id, gender = "M") =>
    (await client.post("/api/players", { firstName, lastName, gender, mainCategoryId: categoryId })).json.item;
  return { client, ...base, tournament, mkPlayer };
}

async function addTeam(client: Client, tournamentId: number, p1: number, p2: number) {
  const res = await client.post(`/api/tournaments/${tournamentId}/teams`, { player1Id: p1, player2Id: p2 });
  if (res.status !== 201) throw new Error(JSON.stringify(res.json));
  return res.json.items as Json[];
}

const stageId = (scoring: Json, label: string) => scoring.stages.find((s: Json) => s.label === label).id as number;
const scoringOf = async (client: Client, tid: number) => (await client.get(`/api/tournaments/${tid}/scoring`)).json.item as Json;
const ranking = async (client: Client, q: string) => (await client.get(`/api/rankings?${q}`)).json as Json;

async function setResults(client: Client, tid: number, results: { teamId: number; stageId: number | null; matchesPlayed?: number; matchesWon?: number }[]) {
  const res = await client.put(`/api/tournaments/${tid}/results`, { results });
  if (res.status !== 200) throw new Error(JSON.stringify(res.json));
}

async function confirm(client: Client, tid: number, reason?: string) {
  const preview = (await client.get(`/api/tournaments/${tid}/preview`)).json;
  return client.post(`/api/tournaments/${tid}/credits`, { previewHash: preview.previewHash, reason });
}

/** Torneo con 4 parejas: campeón, finalista y dos semifinalistas. */
async function fourTeams() {
  const s = await scenario();
  const ps = [];
  for (let i = 1; i <= 8; i++) ps.push(await s.mkPlayer(`Jugador${i}`, `Apellido${i}`));
  for (let i = 0; i < 8; i += 2) await addTeam(s.client, s.tournament.id, ps[i].id, ps[i + 1].id);
  const teams = (await s.client.get(`/api/tournaments/${s.tournament.id}/teams`)).json.items as Json[];
  const sc = await scoringOf(s.client, s.tournament.id);
  await setResults(s.client, s.tournament.id, [
    { teamId: teams[0]!.id, stageId: stageId(sc, "Campeón") },
    { teamId: teams[1]!.id, stageId: stageId(sc, "Finalista") },
    { teamId: teams[2]!.id, stageId: stageId(sc, "Semifinal") },
    { teamId: teams[3]!.id, stageId: stageId(sc, "Semifinal") },
  ]);
  return { ...s, ps, teams, sc };
}

describe("plantillas de puntuación", () => {
  it("vienen dos plantillas predeterminadas y un torneo nuevo copia la de su tipo", async () => {
    const s = await scenario({ type: "americano" });
    const templates = (await s.client.get("/api/scoring-templates")).json.items;
    expect(templates.map((t: Json) => t.name).sort()).toEqual(["Americano estándar", "Torneo largo estándar"]);
    const sc = await scoringOf(s.client, s.tournament.id);
    expect(sc.templateName).toBe("Americano estándar");
    expect(sc.stages.map((x: Json) => [x.label, x.points])).toEqual([
      ["Campeón", 50], ["Finalista", 35], ["Semifinal", 25], ["Cuartos de final", 15], ["Fase de grupos", 5],
    ]);
  });

  it("crea plantillas, mantiene una sola predeterminada por tipo y editar la plantilla no altera torneos existentes", async () => {
    const s = await scenario();
    const created = await s.client.post("/api/scoring-templates", {
      name: "Master", defaultForType: "largo", cumulative: false, participationBonus: 2,
      stages: [{ label: "Campeón", points: 500, maxTeams: 1 }, { label: "Finalista", points: 300, maxTeams: 1 }],
    });
    expect(created.status).toBe(201);
    expect(created.json.item.stages.map((x: Json) => x.rank)).toEqual([1, 2]);
    const all = (await s.client.get("/api/scoring-templates")).json.items as Json[];
    expect(all.filter((t) => t.defaultForType === "largo").map((t) => t.name)).toEqual(["Master"]);

    const tpl = all.find((t) => t.name === "Torneo largo estándar")!;
    await s.client.put(`/api/scoring-templates/${tpl.id}`, { ...tpl, stages: [{ label: "Campeón", points: 1 }] });
    // El torneo creado antes conserva su propia copia.
    expect((await scoringOf(s.client, s.tournament.id)).stages[0].points).toBe(100);
    expect((await s.client.post("/api/scoring-templates", { name: "master", stages: [{ label: "A", points: 1 }] })).status).toBe(409);
    const dupStage = await s.client.post("/api/scoring-templates", { name: "X", stages: [{ label: "A", points: 1 }, { label: "a", points: 2 }] });
    expect(dupStage.status).toBe(400);
  });

  it("edita la puntuación de un torneo conservando las instancias asignadas", async () => {
    const s = await fourTeams();
    const sc = s.sc;
    // Renombra, cambia puntos, reordena dos instancias y agrega una nueva.
    const stages = sc.stages.map((x: Json) => ({ id: x.id, label: x.label, points: x.points, maxTeams: x.maxTeams }));
    stages[0].points = 120;
    stages[2].label = "Semis";
    stages.push({ label: "Consuelo", points: 3, maxTeams: null });
    const res = await s.client.put(`/api/tournaments/${s.tournament.id}/scoring`, { cumulative: false, participationBonus: 0, matchPlayedBonus: 0, matchWonBonus: 0, rulesNotes: "Reglamento 2026", stages });
    expect(res.status).toBe(200);
    expect(res.json.item.stages.map((x: Json) => x.label)).toContain("Consuelo");
    expect(res.json.item.rulesNotes).toBe("Reglamento 2026");
    const preview = (await s.client.get(`/api/tournaments/${s.tournament.id}/preview`)).json;
    expect(preview.rows.filter((r: Json) => r.stageLabel === "Campeón").every((r: Json) => r.points === 120)).toBe(true);
    expect(preview.rows.filter((r: Json) => r.stageLabel === "Semis")).toHaveLength(4);

    // No se puede quitar una instancia con parejas asignadas.
    const removing = stages.filter((x: Json) => x.label !== "Finalista");
    expect((await s.client.put(`/api/tournaments/${s.tournament.id}/scoring`, { stages: removing })).status).toBe(409);
  });

  it("aplicar otra plantilla reasigna las instancias por orden", async () => {
    const s = await fourTeams();
    const americano = ((await s.client.get("/api/scoring-templates")).json.items as Json[]).find((t) => t.name === "Americano estándar")!;
    const res = await s.client.post(`/api/tournaments/${s.tournament.id}/scoring/apply-template`, { templateId: americano.id });
    expect(res.status).toBe(200);
    const preview = (await s.client.get(`/api/tournaments/${s.tournament.id}/preview`)).json;
    expect(preview.rows.find((r: Json) => r.stageLabel === "Campeón").points).toBe(50);
    expect(preview.canConfirm).toBe(true);
  });
});

describe("parejas", () => {
  it("valida rama, jugadores inactivos y que nadie se inscriba dos veces", async () => {
    const s = await scenario();
    const a = await s.mkPlayer("A", "Uno");
    const b = await s.mkPlayer("B", "Dos");
    const c = await s.mkPlayer("C", "Tres");
    const dama = await s.mkPlayer("Ana", "Dama", s.dam4.id, "F");
    await addTeam(s.client, s.tournament.id, a.id, b.id);
    expect((await s.client.post(`/api/tournaments/${s.tournament.id}/teams`, { player1Id: a.id, player2Id: c.id })).status).toBe(409);
    const wrong = await s.client.post(`/api/tournaments/${s.tournament.id}/teams`, { player1Id: c.id, player2Id: dama.id });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.fields.player2Id).toBeDefined();
    expect((await s.client.post(`/api/tournaments/${s.tournament.id}/teams`, { player1Id: c.id, player2Id: c.id })).status).toBe(400);
    await s.client.patch(`/api/players/${c.id}/active`, { active: false });
    const d = await s.mkPlayer("D", "Cuatro");
    expect((await s.client.post(`/api/tournaments/${s.tournament.id}/teams`, { player1Id: c.id, player2Id: d.id })).status).toBe(400);
  });

  it("edita los integrantes y elimina parejas", async () => {
    const s = await scenario();
    const [a, b, c] = [await s.mkPlayer("A", "Uno"), await s.mkPlayer("B", "Dos"), await s.mkPlayer("C", "Tres")];
    const [team] = await addTeam(s.client, s.tournament.id, a.id, b.id);
    const edited = await s.client.put(`/api/teams/${team!.id}`, { player1Id: a.id, player2Id: c.id, seed: 1 });
    expect(edited.json.items[0].players.map((p: Json) => p.lastName)).toEqual(["Uno", "Tres"]);
    expect(edited.json.items[0].seed).toBe(1);
    expect((await s.client.delete(`/api/teams/${team!.id}`)).json.items).toHaveLength(0);
  });
});

describe("acreditación", () => {
  it("cada integrante recibe la misma puntuación y se acredita una sola vez", async () => {
    const s = await fourTeams();
    const res = await confirm(s.client, s.tournament.id);
    expect(res.status).toBe(201);
    expect(res.json.item).toMatchObject({ version: 1, status: "vigente", playerCount: 8, teamCount: 4, totalPoints: 2 * (100 + 70 + 50 + 50) });

    const r = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`);
    expect(r.rows.map((x: Json) => x.points)).toEqual([100, 100, 70, 70, 50, 50, 50, 50]);
    expect(r.rows[0]).toMatchObject({ position: 1, tied: true, titles: 1, finals: 1, tournaments: 1 });

    // Un segundo intento con los mismos resultados se rechaza: no hay doble acreditación.
    const again = await confirm(s.client, s.tournament.id);
    expect(again.status).toBe(409);
    expect(again.json.error.message).toMatch(/ya está acreditado/);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements WHERE tournament_id = ?").bind(s.tournament.id).first<{ n: number }>();
    expect(n!.n).toBe(8);
    expect((await s.client.get(`/api/tournaments/${s.tournament.id}`)).json.item.status).toBe("finalizado");
  });

  it("dos confirmaciones simultáneas producen una sola acreditación (atomicidad)", async () => {
    const s = await fourTeams();
    const preview = (await s.client.get(`/api/tournaments/${s.tournament.id}/preview`)).json;
    const results = await Promise.all([1, 2, 3].map(() => s.client.post(`/api/tournaments/${s.tournament.id}/credits`, { previewHash: preview.previewHash })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const credits = await env.DB.prepare("SELECT COUNT(*) AS n FROM tournament_credits WHERE tournament_id = ?").bind(s.tournament.id).first<{ n: number }>();
    expect(credits!.n).toBe(1);
    const sum = await env.DB.prepare("SELECT SUM(points) AS p, COUNT(*) AS n FROM point_movements").first<{ p: number; n: number }>();
    expect(sum).toEqual({ p: 540, n: 8 });
  });

  it("rechaza confirmar con una previsualización desactualizada o con errores", async () => {
    const s = await fourTeams();
    const preview = (await s.client.get(`/api/tournaments/${s.tournament.id}/preview`)).json;
    await setResults(s.client, s.tournament.id, [{ teamId: s.teams[3]!.id, stageId: stageId(s.sc, "Cuartos de final") }]);
    const stale = await s.client.post(`/api/tournaments/${s.tournament.id}/credits`, { previewHash: preview.previewHash });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("previsualizacion_desactualizada");

    await setResults(s.client, s.tournament.id, [{ teamId: s.teams[3]!.id, stageId: stageId(s.sc, "Campeón") }]); // dos campeones
    const bad = await confirm(s.client, s.tournament.id);
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/admite 1 pareja/);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements").first<{ n: number }>())!.n).toBe(0);
  });

  it("no acredita torneos programados", async () => {
    const s = await fourTeams();
    await s.client.patch(`/api/tournaments/${s.tournament.id}/status`, { status: "programado" });
    expect((await confirm(s.client, s.tournament.id)).status).toBe(409);
  });

  it("acredita en la categoría principal aunque el jugador juegue otra categoría", async () => {
    const s = await scenario();
    const local = await s.mkPlayer("Local", "Cuarta");
    const visitante = await s.mkPlayer("Visitante", "Quinta", s.cab5.id);
    const [team] = await addTeam(s.client, s.tournament.id, local.id, visitante.id);
    const sc = await scoringOf(s.client, s.tournament.id);
    await setResults(s.client, s.tournament.id, [{ teamId: team!.id, stageId: stageId(sc, "Campeón") }]);
    const preview = (await s.client.get(`/api/tournaments/${s.tournament.id}/preview`)).json;
    expect(preview.rows.find((r: Json) => r.playerId === visitante.id)).toMatchObject({ categoryName: "5ta", otherCategory: true, points: 100 });
    await confirm(s.client, s.tournament.id);
    const r4 = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`);
    const r5 = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab5.id}`);
    expect(r4.rows.map((x: Json) => x.playerId)).toEqual([local.id]);
    expect(r5.rows.map((x: Json) => [x.playerId, x.points])).toEqual([[visitante.id, 100]]);
  });

  it("si el jugador cambia de categoría, lo ya acreditado queda donde estaba", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    const p = s.ps[0];
    await s.client.put(`/api/players/${p.id}`, { firstName: p.firstName, lastName: p.lastName, gender: "M", mainCategoryId: s.cab5.id, categoryChangeType: "descenso" });
    const r4 = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`);
    expect(r4.rows.find((x: Json) => x.playerId === p.id).points).toBe(100);
    const r5 = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab5.id}`);
    expect(r5.rows).toHaveLength(0);
  });

  it("aplica bonificaciones y reglamento acumulativo configurados en el torneo", async () => {
    const s = await fourTeams();
    const stages = s.sc.stages.map((x: Json) => ({ id: x.id, label: x.label, points: x.points, maxTeams: x.maxTeams }));
    await s.client.put(`/api/tournaments/${s.tournament.id}/scoring`, { cumulative: true, participationBonus: 2, matchPlayedBonus: 1, matchWonBonus: 0, stages });
    await setResults(s.client, s.tournament.id, [{ teamId: s.teams[0]!.id, stageId: stageId(s.sc, "Campeón"), matchesPlayed: 5, matchesWon: 5 }]);
    const preview = (await s.client.get(`/api/tournaments/${s.tournament.id}/preview`)).json;
    const champ = preview.rows.find((r: Json) => r.teamId === s.teams[0]!.id);
    expect(champ).toMatchObject({ stagePoints: 100 + 70 + 50 + 30 + 15 + 8 + 5, bonusPoints: 2 + 5, points: 278 + 7 });
    const res = await confirm(s.client, s.tournament.id);
    expect(res.status).toBe(201);
    const m = await env.DB.prepare("SELECT points, stage_points, bonus_points FROM point_movements WHERE player_id = ?").bind(s.ps[0].id).first();
    expect(m).toEqual({ points: 285, stage_points: 278, bonus_points: 7 });
  });

  it("procesa torneos grandes en un único batch (40 parejas, 80 jugadores)", async () => {
    const s = await scenario();
    const ids: number[] = [];
    // Alta directa para acelerar la preparación del test.
    for (let i = 0; i < 80; i++) {
      const row = await env.DB.prepare(
        "INSERT INTO players (first_name, last_name, gender, main_category_id, search_text) VALUES (?, ?, 'M', ?, '') RETURNING id",
      ).bind(`N${i}`, `A${i}`, s.cab4.id).first<{ id: number }>();
      ids.push(row!.id);
    }
    for (let i = 0; i < 80; i += 2) await addTeam(s.client, s.tournament.id, ids[i]!, ids[i + 1]!);
    const teams = (await s.client.get(`/api/tournaments/${s.tournament.id}/teams`)).json.items as Json[];
    const sc = await scoringOf(s.client, s.tournament.id);
    await setResults(s.client, s.tournament.id, teams.map((t, i) => ({
      teamId: t.id,
      stageId: stageId(sc, i === 0 ? "Campeón" : i === 1 ? "Finalista" : i < 4 ? "Semifinal" : i < 8 ? "Cuartos de final" : "Fase de grupos"),
    })));
    const res = await confirm(s.client, s.tournament.id);
    expect(res.status).toBe(201);
    expect(res.json.item.playerCount).toBe(80);
  });
});

describe("correcciones y reversiones", () => {
  it("corrige con motivo, reemplaza la acreditación y conserva el historial completo", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    // Se descubre que la final fue al revés.
    await setResults(s.client, s.tournament.id, [
      { teamId: s.teams[0]!.id, stageId: stageId(s.sc, "Finalista") },
      { teamId: s.teams[1]!.id, stageId: stageId(s.sc, "Campeón") },
    ]);
    const preview = (await s.client.get(`/api/tournaments/${s.tournament.id}/preview`)).json;
    expect(preview.upToDate).toBe(false);
    expect(preview.diff.filter((d: Json) => d.change === "modificado").map((d: Json) => d.delta).sort()).toEqual([-30, -30, 30, 30]);

    const noReason = await confirm(s.client, s.tournament.id);
    expect(noReason.status).toBe(400);
    expect(noReason.json.error.fields.reason).toBeDefined();

    const fixed = await confirm(s.client, s.tournament.id, "Se invirtió el resultado de la final");
    expect(fixed.status).toBe(201);
    expect(fixed.json.item.version).toBe(2);

    const r = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`);
    expect(r.rows.find((x: Json) => x.playerId === s.ps[0].id)).toMatchObject({ points: 70, titles: 0, finals: 1 });
    expect(r.rows.find((x: Json) => x.playerId === s.ps[2].id)).toMatchObject({ points: 100, titles: 1 });

    const credits = (await s.client.get(`/api/tournaments/${s.tournament.id}/credits`)).json.items;
    expect(credits.map((c: Json) => [c.version, c.status])).toEqual([[2, "vigente"], [1, "reemplazada"]]);
    expect(credits[1].closeReason).toBe("Se invirtió el resultado de la final");

    const kinds = await env.DB.prepare("SELECT kind, COUNT(*) AS n, SUM(points) AS p FROM point_movements GROUP BY kind ORDER BY kind").all();
    expect(kinds.results).toEqual([
      { kind: "acreditacion", n: 16, p: 540 * 2 },
      { kind: "reversion", n: 8, p: -540 },
    ]);
    const preview2 = (await s.client.get(`/api/tournaments/${s.tournament.id}/preview`)).json;
    expect(preview2.upToDate).toBe(true);
  });

  it("revierte la acreditación (puntos a cero) y permite volver a acreditar", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    expect((await s.client.post(`/api/tournaments/${s.tournament.id}/credits/revert`, {})).status).toBe(400);
    const rev = await s.client.post(`/api/tournaments/${s.tournament.id}/credits/revert`, { reason: "Se cargó el torneo equivocado" });
    expect(rev.status).toBe(200);
    expect((await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`)).rows).toHaveLength(0);
    expect((await s.client.post(`/api/tournaments/${s.tournament.id}/credits/revert`, { reason: "otra vez" })).status).toBe(409);

    const again = await confirm(s.client, s.tournament.id);
    expect(again.status).toBe(201);
    expect(again.json.item.version).toBe(2);
    expect((await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`)).rows[0].points).toBe(100);
    const total = await env.DB.prepare("SELECT SUM(points) AS p FROM point_movements").first<{ p: number }>();
    expect(total!.p).toBe(540);
  });

  it("anular el torneo revierte los puntos y lo cancela", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    await s.client.post(`/api/tournaments/${s.tournament.id}/credits/revert`, { reason: "Torneo anulado por lluvia", cancelTournament: true });
    expect((await s.client.get(`/api/tournaments/${s.tournament.id}`)).json.item.status).toBe("cancelado");
    // Cancelado: no se pueden modificar resultados.
    expect((await s.client.put(`/api/tournaments/${s.tournament.id}/results`, { results: [] })).status).toBe(409);
  });

  it("los movimientos son inmutables a nivel de base de datos", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    await expect(env.DB.prepare("UPDATE point_movements SET points = 999").run()).rejects.toThrow(/inmutables/);
    await expect(env.DB.prepare("DELETE FROM point_movements").run()).rejects.toThrow(/inmutables/);
  });

  it("bloquea cambios de estado o temporada mientras haya puntos acreditados", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    expect((await s.client.patch(`/api/tournaments/${s.tournament.id}/status`, { status: "en_curso" })).status).toBe(409);
    const t = (await s.client.get(`/api/tournaments/${s.tournament.id}`)).json.item;
    const changed = await s.client.put(`/api/tournaments/${s.tournament.id}`, { ...t, categoryId: s.cab5.id });
    expect(changed.status).toBe(409);
  });

  it("una temporada cerrada no admite cambios ni acreditaciones", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    expect((await s.client.patch(`/api/seasons/${s.season.id}/status`, { status: "cerrada" })).status).toBe(200);
    expect((await s.client.put(`/api/tournaments/${s.tournament.id}/results`, { results: [] })).status).toBe(409);
    expect((await s.client.post(`/api/tournaments/${s.tournament.id}/credits/revert`, { reason: "x" })).status).toBe(409);
    expect((await s.client.post("/api/movements/adjustments", { playerId: s.ps[0].id, seasonId: s.season.id, points: 5, reason: "x" })).status).toBe(409);
    // El ranking histórico se conserva.
    expect((await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`)).rows).toHaveLength(8);
  });
});

describe("ajustes manuales", () => {
  it("suma o resta con motivo y se anula una sola vez mediante contraasiento", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    const p = s.ps[7];
    expect((await s.client.post("/api/movements/adjustments", { playerId: p.id, seasonId: s.season.id, points: -20 })).status).toBe(400);
    expect((await s.client.post("/api/movements/adjustments", { playerId: p.id, seasonId: s.season.id, points: -20, reason: "Sanción por W.O." })).status).toBe(201);
    let r = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`);
    expect(r.rows.find((x: Json) => x.playerId === p.id)).toMatchObject({ points: 30, adjustments: -20 });

    const history = (await s.client.get(`/api/players/${p.id}/points`)).json;
    expect(history.summary).toEqual([expect.objectContaining({ seasonName: "Temporada 2026", categoryName: "4ta", points: 30 })]);
    const adj = history.movements.find((m: Json) => m.kind === "ajuste");
    expect(adj.reason).toBe("Sanción por W.O.");

    expect((await s.client.post(`/api/movements/${adj.id}/annul`, { reason: "Se presentó el certificado" })).status).toBe(200);
    expect((await s.client.post(`/api/movements/${adj.id}/annul`, { reason: "otra" })).status).toBe(409);
    const credit = history.movements.find((m: Json) => m.kind === "acreditacion");
    expect((await s.client.post(`/api/movements/${credit.id}/annul`, { reason: "x" })).status).toBe(400);
    r = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`);
    expect(r.rows.find((x: Json) => x.playerId === p.id).points).toBe(50);
  });
});

describe("rankings", () => {
  it("se reinician por temporada conservando la anterior", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    await s.client.patch(`/api/seasons/${s.season.id}/status`, { status: "cerrada" });
    const s2 = (await s.client.post("/api/seasons", { name: "Temporada 2027", year: 2027, startDate: "2027-01-01", endDate: "2027-12-31" })).json.item;
    await s.client.patch(`/api/seasons/${s2.id}/status`, { status: "activa" });
    expect((await ranking(s.client, `seasonId=${s2.id}&categoryId=${s.cab4.id}`)).rows).toHaveLength(0);
    expect((await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`)).rows).toHaveLength(8);
    const book = (await s.client.get(`/api/rankings/season/${s.season.id}`)).json;
    expect(book.categories.map((c: Json) => c.category.name)).toEqual(["4ta"]);
  });

  it("filtra por división del torneo", async () => {
    const { client } = await loggedInAdmin();
    const base = await seedBasics(client);
    await client.patch(`/api/seasons/${base.season.id}/status`, { status: "activa" });
    const cat = (await client.post(`/api/categories/${base.cab4.id}/divisions`, { name: "A" })).json.item;
    const divA = cat.divisions[0].id;
    const mk = async (name: string, divisionId: number | null) => {
      const t = (await client.post("/api/tournaments", { seasonId: base.season.id, name, type: "americano", categoryId: base.cab4.id, divisionId, startDate: "2026-05-01" })).json.item;
      await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
      return t;
    };
    const tA = await mk("Americano A", divA);
    const tGen = await mk("Americano general", null);
    const p = [];
    for (let i = 0; i < 4; i++) p.push((await client.post("/api/players", { firstName: `P${i}`, lastName: `L${i}`, gender: "M", mainCategoryId: base.cab4.id })).json.item);
    for (const [t, a, b] of [[tA, p[0], p[1]], [tGen, p[2], p[3]]] as const) {
      const [team] = await addTeam(client, t.id, a.id, b.id);
      const sc = await scoringOf(client, t.id);
      await setResults(client, t.id, [{ teamId: team!.id, stageId: stageId(sc, "Campeón") }]);
      expect((await confirm(client, t.id)).status).toBe(201);
    }
    expect((await ranking(client, `seasonId=${base.season.id}&categoryId=${base.cab4.id}`)).rows).toHaveLength(4);
    const byDiv = await ranking(client, `seasonId=${base.season.id}&categoryId=${base.cab4.id}&divisionId=${divA}`);
    expect(byDiv.division.name).toBe("A");
    expect(byDiv.rows.map((x: Json) => x.playerId).sort()).toEqual([p[0].id, p[1].id].sort());
  });

  it("aplica las reglas de desempate configuradas por temporada", async () => {
    const s = await fourTeams();
    await confirm(s.client, s.tournament.id);
    // Igualamos a un semifinalista con el campeón mediante un ajuste: 50 + 50 = 100.
    const semi = s.ps[4];
    await s.client.post("/api/movements/adjustments", { playerId: semi.id, seasonId: s.season.id, points: 50, reason: "Bonus" });
    let r = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`);
    expect(r.tiebreakers).toEqual(["titulos", "finales", "mejor_torneo", "menos_torneos"]);
    expect(r.rows.slice(0, 3).map((x: Json) => [x.playerId, x.position])).toEqual([[s.ps[0].id, 1], [s.ps[1].id, 1], [semi.id, 3]]);

    // Con un único criterio que no los diferencia, comparten posición.
    expect((await s.client.put(`/api/rankings/tiebreakers/${s.season.id}`, { tiebreakers: ["menos_torneos"] })).status).toBe(200);
    r = await ranking(s.client, `seasonId=${s.season.id}&categoryId=${s.cab4.id}`);
    expect(r.rows.filter((x: Json) => x.points === 100).every((x: Json) => x.position === 1 && x.tied)).toBe(true);
    expect(r.rows.filter((x: Json) => x.points === 100)).toHaveLength(3);

    const invalid = await s.client.put(`/api/rankings/tiebreakers/${s.season.id}`, { tiebreakers: ["mas_torneos", "menos_torneos"] });
    expect(invalid.status).toBe(400);
  });
});

describe("panel", () => {
  it("lista los torneos finalizados pendientes de acreditar", async () => {
    const s = await fourTeams();
    await s.client.patch(`/api/tournaments/${s.tournament.id}/status`, { status: "finalizado" });
    expect((await s.client.get("/api/dashboard")).json.pendingCredits.map((t: Json) => t.id)).toEqual([s.tournament.id]);
    await confirm(s.client, s.tournament.id);
    expect((await s.client.get("/api/dashboard")).json.pendingCredits).toHaveLength(0);
    expect((await s.client.get(`/api/tournaments/${s.tournament.id}`)).json.item.creditedVersion).toBe(1);
  });
});
