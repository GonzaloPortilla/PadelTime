/**
 * Fase 5B · Integridad de puntuaciones.
 * Cada prueba recorre la API real (Worker + D1 con migraciones) y verifica invariantes contables:
 * el registro de movimientos es la única fuente de verdad y los rankings siempre son su suma.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Client, createUser, loggedInAdmin, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function setup(opts: { cumulative?: boolean; bonus?: { participation: number; played: number; won: number } } = {}) {
  const { client } = await loggedInAdmin();
  const base = await seedBasics(client);
  await client.patch(`/api/seasons/${base.season.id}/status`, { status: "activa" });
  const div = (await client.post(`/api/categories/${base.cab4.id}/divisions`, { name: "A", sortOrder: 1 })).json;
  const divisionId = div.item.divisions[0].id as number;
  const mkPlayer = async (n: string, categoryId = base.cab4.id) =>
    (await client.post("/api/players", { firstName: n, lastName: `Ap${n}`, gender: "M", mainCategoryId: categoryId })).json.item as Json;
  const mkTournament = async (name: string, start = "2026-04-01") => {
    const t = (await client.post("/api/tournaments", {
      seasonId: base.season.id, name, type: "largo", categoryId: base.cab4.id, divisionId, startDate: start, endDate: start,
    })).json.item as Json;
    await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
    if (opts.cumulative || opts.bonus) {
      const sc = (await client.get(`/api/tournaments/${t.id}/scoring`)).json.item as Json;
      const res = await client.put(`/api/tournaments/${t.id}/scoring`, {
        cumulative: !!opts.cumulative,
        participationBonus: opts.bonus?.participation ?? 0,
        matchPlayedBonus: opts.bonus?.played ?? 0,
        matchWonBonus: opts.bonus?.won ?? 0,
        rulesNotes: null,
        stages: sc.stages.map((s: Json) => ({ id: s.id, label: s.label, points: s.points, maxTeams: s.maxTeams })),
      });
      if (res.status !== 200) throw new Error(JSON.stringify(res.json));
    }
    return t;
  };
  return { client, ...base, divisionId, mkPlayer, mkTournament };
}

const stage = async (client: Client, tid: number, label: string) =>
  ((await client.get(`/api/tournaments/${tid}/scoring`)).json.item.stages as Json[]).find((s) => s.label === label)!.id as number;

async function team(client: Client, tid: number, a: number, b: number) {
  const res = await client.post(`/api/tournaments/${tid}/teams`, { player1Id: a, player2Id: b });
  if (res.status !== 201) throw new Error(JSON.stringify(res.json));
  const items = res.json.items as Json[];
  return items.find((t) => t.players.some((p: Json) => p.id === a))!.id as number;
}

async function results(client: Client, tid: number, rows: { teamId: number; stageId: number | null; matchesPlayed?: number; matchesWon?: number }[]) {
  const res = await client.put(`/api/tournaments/${tid}/results`, {
    results: rows.map((r) => ({ matchesPlayed: 0, matchesWon: 0, ...r })),
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.json));
}

async function confirm(client: Client, tid: number, reason?: string) {
  const preview = (await client.get(`/api/tournaments/${tid}/preview`)).json;
  return client.post(`/api/tournaments/${tid}/credits`, { previewHash: preview.previewHash, reason });
}

const rankingOf = async (client: Client, seasonId: number, categoryId: number, divisionId?: number) =>
  ((await client.get(`/api/rankings?seasonId=${seasonId}&categoryId=${categoryId}${divisionId ? `&divisionId=${divisionId}` : ""}`)).json.rows ?? []) as Json[];

const pointsOf = (rows: Json[], playerId: number) => rows.find((r) => r.playerId === playerId)?.points ?? 0;

/** Suma del registro por jugador, directamente en la base. */
async function ledger(seasonId: number) {
  const { results: rows } = await env.DB.prepare(
    "SELECT player_id, category_id, SUM(points) AS points FROM point_movements WHERE season_id = ? GROUP BY player_id, category_id",
  ).bind(seasonId).all<{ player_id: number; category_id: number; points: number }>();
  return rows;
}

/** Invariante: lo que muestra cada ranking es exactamente la suma de movimientos. */
async function assertRankingsMatchLedger(client: Client, seasonId: number) {
  for (const row of await ledger(seasonId)) {
    const ranking = await rankingOf(client, seasonId, row.category_id);
    if (row.points === 0) continue;
    expect(pointsOf(ranking, row.player_id)).toBe(row.points);
  }
}

describe("integridad · puntos por pareja", () => {
  it("ambos integrantes reciben exactamente los mismos puntos deportivos, aunque acumulen en categorías distintas", async () => {
    const s = await setup({ bonus: { participation: 3, played: 2, won: 5 } });
    const t = await s.mkTournament("Apertura");
    const a = await s.mkPlayer("A");
    const b = await s.mkPlayer("B", s.cab5.id); // juega en 4ta, su principal es 5ta
    const c = await s.mkPlayer("C");
    const d = await s.mkPlayer("D");
    const t1 = await team(s.client, t.id, a.id, b.id);
    const t2 = await team(s.client, t.id, c.id, d.id);
    await results(s.client, t.id, [
      { teamId: t1, stageId: await stage(s.client, t.id, "Campeón"), matchesPlayed: 4, matchesWon: 4 },
      { teamId: t2, stageId: await stage(s.client, t.id, "Finalista"), matchesPlayed: 4, matchesWon: 3 },
    ]);
    expect((await confirm(s.client, t.id)).status).toBe(201);

    const { results: mv } = await env.DB.prepare(
      "SELECT player_id, team_id, category_id, division_id, points, stage_points, bonus_points FROM point_movements WHERE tournament_id = ? ORDER BY player_id",
    ).bind(t.id).all<Json>();
    const byTeam = new Map<number, Json[]>();
    for (const m of mv) byTeam.set(m.team_id, [...(byTeam.get(m.team_id) ?? []), m]);
    for (const members of byTeam.values()) {
      expect(members).toHaveLength(2);
      expect(members[0]!.points).toBe(members[1]!.points);
      expect(members[0]!.stage_points).toBe(members[1]!.stage_points);
      expect(members[0]!.bonus_points).toBe(members[1]!.bonus_points);
    }
    // Campeón: 100 + 3 + 4×2 + 4×5 = 131. Finalista: 70 + 3 + 8 + 15 = 96.
    expect(mv.find((m) => m.player_id === a.id)!.points).toBe(131);
    expect(mv.find((m) => m.player_id === c.id)!.points).toBe(96);
    // Cada uno acumula en su categoría principal; la división del torneo sólo aplica a quien es de esa categoría.
    expect(mv.find((m) => m.player_id === a.id)).toMatchObject({ category_id: s.cab4.id, division_id: s.divisionId });
    expect(mv.find((m) => m.player_id === b.id)).toMatchObject({ category_id: s.cab5.id, division_id: null });
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab5.id), b.id)).toBe(131);
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab4.id), b.id)).toBe(0);
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab4.id, s.divisionId), a.id)).toBe(131);
  });
});

describe("integridad · reglamento de cada torneo", () => {
  it("regla general: el campeón recibe sólo los puntos de campeón (no suma fases anteriores)", async () => {
    const s = await setup();
    const t = await s.mkTournament("General");
    const ps = await Promise.all(["A", "B", "C", "D"].map((n) => s.mkPlayer(n)));
    const t1 = await team(s.client, t.id, ps[0]!.id, ps[1]!.id);
    const t2 = await team(s.client, t.id, ps[2]!.id, ps[3]!.id);
    await results(s.client, t.id, [
      { teamId: t1, stageId: await stage(s.client, t.id, "Campeón") },
      { teamId: t2, stageId: await stage(s.client, t.id, "Cuartos de final") },
    ]);
    await confirm(s.client, t.id);
    const r = await rankingOf(s.client, s.season.id, s.cab4.id);
    expect(pointsOf(r, ps[0]!.id)).toBe(100);
    expect(pointsOf(r, ps[2]!.id)).toBe(30);
  });

  it("reglamento acumulativo: suma la instancia alcanzada y todas las anteriores, sólo en ese torneo", async () => {
    const s = await setup({ cumulative: true });
    const acumulativo = await s.mkTournament("Especial");
    const ps = await Promise.all(["A", "B", "C", "D"].map((n) => s.mkPlayer(n)));
    const t1 = await team(s.client, acumulativo.id, ps[0]!.id, ps[1]!.id);
    const t2 = await team(s.client, acumulativo.id, ps[2]!.id, ps[3]!.id);
    await results(s.client, acumulativo.id, [
      { teamId: t1, stageId: await stage(s.client, acumulativo.id, "Campeón") },
      { teamId: t2, stageId: await stage(s.client, acumulativo.id, "Cuartos de final") },
    ]);
    await confirm(s.client, acumulativo.id);
    const r = await rankingOf(s.client, s.season.id, s.cab4.id);
    // 100 + 70 + 50 + 30 + 15 + 8 + 5 = 278 ; cuartos: 30 + 15 + 8 + 5 = 58
    expect(pointsOf(r, ps[0]!.id)).toBe(278);
    expect(pointsOf(r, ps[2]!.id)).toBe(58);
  });

  it("cambiar la plantilla o la puntuación después de acreditar no altera los puntos ya acreditados", async () => {
    const s = await setup();
    const t = await s.mkTournament("Apertura");
    const [a, b] = await Promise.all([s.mkPlayer("A"), s.mkPlayer("B")]);
    const t1 = await team(s.client, t.id, a.id, b.id);
    await results(s.client, t.id, [{ teamId: t1, stageId: await stage(s.client, t.id, "Campeón") }]);
    await confirm(s.client, t.id);
    const templates = (await s.client.get("/api/scoring-templates")).json.items as Json[];
    const largo = templates.find((x) => x.name === "Torneo largo estándar")!;
    await s.client.put(`/api/scoring-templates/${largo.id}`, {
      ...largo, stages: largo.stages.map((x: Json) => ({ label: x.label, points: x.points * 10, maxTeams: x.maxTeams })),
    });
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab4.id), a.id)).toBe(100);
    // Editar la puntuación propia del torneo deja la acreditación "desactualizada" pero no mueve puntos hasta confirmar.
    const sc = (await s.client.get(`/api/tournaments/${t.id}/scoring`)).json.item as Json;
    await s.client.put(`/api/tournaments/${t.id}/scoring`, {
      cumulative: false, participationBonus: 0, matchPlayedBonus: 0, matchWonBonus: 0, rulesNotes: null,
      stages: sc.stages.map((x: Json) => ({ id: x.id, label: x.label, points: x.label === "Campeón" ? 120 : x.points, maxTeams: x.maxTeams })),
    });
    const preview = (await s.client.get(`/api/tournaments/${t.id}/preview`)).json;
    expect(preview.upToDate).toBe(false);
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab4.id), a.id)).toBe(100);
  });
});

describe("integridad · sin acreditaciones duplicadas", () => {
  it("confirmar dos veces, en paralelo o una corrección idéntica nunca duplica puntos", async () => {
    const s = await setup();
    const t = await s.mkTournament("Apertura");
    const [a, b] = await Promise.all([s.mkPlayer("A"), s.mkPlayer("B")]);
    const t1 = await team(s.client, t.id, a.id, b.id);
    await results(s.client, t.id, [{ teamId: t1, stageId: await stage(s.client, t.id, "Campeón") }]);
    const preview = (await s.client.get(`/api/tournaments/${t.id}/preview`)).json;
    const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => s.client.post(`/api/tournaments/${t.id}/credits`, { previewHash: preview.previewHash })));
    expect([r1!.status, r2!.status, r3!.status].filter((x) => x === 201)).toHaveLength(1);
    // Repetir con los mismos datos (aun como "corrección" con motivo) se rechaza.
    expect((await confirm(s.client, t.id, "otra vez")).status).toBe(409);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(points) AS p FROM point_movements WHERE tournament_id = ?").bind(t.id).first<{ n: number; p: number }>();
    expect(n).toEqual({ n: 2, p: 200 });
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab4.id), a.id)).toBe(100);
  });

  it("dos organizadores corrigiendo a la vez: sólo una corrección se aplica y el saldo queda consistente", async () => {
    const s = await setup();
    const org = await createUser("orga", "clave-segura-456", "organizador");
    const other = new Client();
    await other.login(org.username, org.password);
    const t = await s.mkTournament("Apertura");
    const [a, b, c, d] = await Promise.all(["A", "B", "C", "D"].map((n) => s.mkPlayer(n)));
    const t1 = await team(s.client, t.id, a!.id, b!.id);
    const t2 = await team(s.client, t.id, c!.id, d!.id);
    const champ = await stage(s.client, t.id, "Campeón");
    const final = await stage(s.client, t.id, "Finalista");
    await results(s.client, t.id, [{ teamId: t1, stageId: champ }, { teamId: t2, stageId: final }]);
    await confirm(s.client, t.id);
    await results(s.client, t.id, [{ teamId: t1, stageId: final }, { teamId: t2, stageId: champ }]);
    const preview = (await s.client.get(`/api/tournaments/${t.id}/preview`)).json;
    const [x, y] = await Promise.all([
      s.client.post(`/api/tournaments/${t.id}/credits`, { previewHash: preview.previewHash, reason: "Se invirtió la final" }),
      other.post(`/api/tournaments/${t.id}/credits`, { previewHash: preview.previewHash, reason: "Se invirtió la final" }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const credits = await env.DB.prepare("SELECT status FROM tournament_credits WHERE tournament_id = ? ORDER BY version").bind(t.id).all<{ status: string }>();
    expect(credits.results.map((r) => r.status)).toEqual(["reemplazada", "vigente"]);
    const r = await rankingOf(s.client, s.season.id, s.cab4.id);
    expect(pointsOf(r, a!.id)).toBe(70);
    expect(pointsOf(r, c!.id)).toBe(100);
  });
});

describe("integridad · correcciones y reversiones", () => {
  it("cada corrección contraasienta exactamente la versión anterior y el saldo final es el de la última versión", async () => {
    const s = await setup();
    const t = await s.mkTournament("Apertura");
    const ps = await Promise.all(["A", "B", "C", "D", "E", "F"].map((n) => s.mkPlayer(n)));
    const t1 = await team(s.client, t.id, ps[0]!.id, ps[1]!.id);
    const t2 = await team(s.client, t.id, ps[2]!.id, ps[3]!.id);
    const champ = await stage(s.client, t.id, "Campeón");
    const final = await stage(s.client, t.id, "Finalista");
    const semi = await stage(s.client, t.id, "Semifinal");
    await results(s.client, t.id, [{ teamId: t1, stageId: champ }, { teamId: t2, stageId: final }]);
    await confirm(s.client, t.id);
    // v2: se agrega una pareja y cambia una instancia.
    const t3 = await team(s.client, t.id, ps[4]!.id, ps[5]!.id);
    await results(s.client, t.id, [{ teamId: t2, stageId: semi }, { teamId: t3, stageId: final }]);
    expect((await confirm(s.client, t.id)).status).toBe(400); // la corrección exige motivo
    expect((await confirm(s.client, t.id, "Faltaba una pareja")).status).toBe(201);
    // v3: se quita una pareja.
    await s.client.delete(`/api/teams/${t3}`);
    expect((await confirm(s.client, t.id, "La pareja no jugó")).status).toBe(201);

    // Toda acreditación reemplazada tiene cada uno de sus movimientos contraasentado exactamente una vez.
    const unbalanced = await env.DB.prepare(
      `SELECT m.id FROM point_movements m JOIN tournament_credits cr ON cr.id = m.credit_id
        WHERE cr.status <> 'vigente' AND m.kind = 'acreditacion'
          AND (SELECT COUNT(*) FROM point_movements r WHERE r.reverses_movement_id = m.id AND r.points = -m.points) <> 1`,
    ).all();
    expect(unbalanced.results).toHaveLength(0);
    // Ningún movimiento de la versión vigente fue revertido.
    const activeReversed = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM point_movements m JOIN tournament_credits cr ON cr.id = m.credit_id AND cr.status = 'vigente'
        WHERE EXISTS (SELECT 1 FROM point_movements r WHERE r.reverses_movement_id = m.id)`,
    ).first<{ n: number }>();
    expect(activeReversed!.n).toBe(0);

    const r = await rankingOf(s.client, s.season.id, s.cab4.id);
    expect(pointsOf(r, ps[0]!.id)).toBe(100);
    expect(pointsOf(r, ps[2]!.id)).toBe(50);
    expect(pointsOf(r, ps[4]!.id)).toBe(0);
    expect(r.find((x) => x.playerId === ps[4]!.id)).toBeUndefined();
    await assertRankingsMatchLedger(s.client, s.season.id);
    // Las estadísticas de desempate cuentan sólo la versión vigente (1 torneo, no 3).
    expect(r.find((x) => x.playerId === ps[0]!.id)!.tournaments).toBe(1);
  });

  it("revertir deja el saldo del torneo en cero sin borrar historial, y no afecta otros torneos ni ajustes", async () => {
    const s = await setup();
    const [a, b] = await Promise.all([s.mkPlayer("A"), s.mkPlayer("B")]);
    const t1 = await s.mkTournament("Uno", "2026-04-01");
    const t2 = await s.mkTournament("Dos", "2026-05-01");
    for (const t of [t1, t2]) {
      const tm = await team(s.client, t.id, a.id, b.id);
      await results(s.client, t.id, [{ teamId: tm, stageId: await stage(s.client, t.id, "Campeón") }]);
      await confirm(s.client, t.id);
    }
    await s.client.post("/api/movements/adjustments", { playerId: a.id, seasonId: s.season.id, points: -10, reason: "Sanción" });
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements").first<{ n: number }>();
    await s.client.post(`/api/tournaments/${t1.id}/credits/revert`, { reason: "Torneo duplicado" });
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements").first<{ n: number }>();
    expect(after!.n).toBe(before!.n + 2); // se agregan contraasientos, nada se borra
    const sumT1 = await env.DB.prepare("SELECT SUM(points) AS p FROM point_movements WHERE tournament_id = ?").bind(t1.id).first<{ p: number }>();
    expect(sumT1!.p).toBe(0);
    const r = await rankingOf(s.client, s.season.id, s.cab4.id);
    expect(pointsOf(r, a.id)).toBe(90);
    expect(pointsOf(r, b.id)).toBe(100);
    await assertRankingsMatchLedger(s.client, s.season.id);
  });

  it("si un jugador cambió de categoría, corregir el torneo mantiene sus puntos donde se acreditaron", async () => {
    const s = await setup();
    const t = await s.mkTournament("Apertura");
    const [a, b, c, d] = await Promise.all(["A", "B", "C", "D"].map((n) => s.mkPlayer(n)));
    const t1 = await team(s.client, t.id, a!.id, b!.id);
    const t2 = await team(s.client, t.id, c!.id, d!.id);
    await results(s.client, t.id, [
      { teamId: t1, stageId: await stage(s.client, t.id, "Campeón") },
      { teamId: t2, stageId: await stage(s.client, t.id, "Finalista") },
    ]);
    await confirm(s.client, t.id);
    // A asciende a... (en el seed 5ta es de menor nivel: lo usamos como "otra categoría")
    await s.client.put(`/api/players/${a!.id}`, { firstName: a!.firstName, lastName: a!.lastName, gender: "M", mainCategoryId: s.cab5.id, categoryChangeType: "descenso" });
    // Sin cambios en los resultados, la acreditación sigue al día (no pide "corregir").
    const p1 = (await s.client.get(`/api/tournaments/${t.id}/preview`)).json;
    expect(p1.upToDate).toBe(true);
    expect(p1.issues.some((i: Json) => i.code === "categoria_acreditada")).toBe(true);
    // Se corrige otra pareja: los puntos de A no se mudan de categoría.
    await results(s.client, t.id, [{ teamId: t2, stageId: await stage(s.client, t.id, "Semifinal") }]);
    expect((await confirm(s.client, t.id, "Error en la final")).status).toBe(201);
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab4.id), a!.id)).toBe(100);
    expect(await rankingOf(s.client, s.season.id, s.cab5.id)).toHaveLength(0);
    // En torneos nuevos, A ya acumula en su nueva categoría.
    const t3 = await s.mkTournament("Clausura", "2026-06-01");
    const e = await s.mkPlayer("E");
    const t3a = await team(s.client, t3.id, a!.id, e.id);
    await results(s.client, t3.id, [{ teamId: t3a, stageId: await stage(s.client, t3.id, "Finalista") }]);
    await confirm(s.client, t3.id);
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab5.id), a!.id)).toBe(70);
  });
});

describe("integridad · rankings desde movimientos confirmados", () => {
  it("resultados cargados o editados sin confirmar no cambian el ranking", async () => {
    const s = await setup();
    const t = await s.mkTournament("Apertura");
    const [a, b] = await Promise.all([s.mkPlayer("A"), s.mkPlayer("B")]);
    const t1 = await team(s.client, t.id, a.id, b.id);
    await results(s.client, t.id, [{ teamId: t1, stageId: await stage(s.client, t.id, "Campeón") }]);
    expect(await rankingOf(s.client, s.season.id, s.cab4.id)).toHaveLength(0);
    await confirm(s.client, t.id);
    await results(s.client, t.id, [{ teamId: t1, stageId: await stage(s.client, t.id, "Semifinal") }]);
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab4.id), a.id)).toBe(100);
    // La vista pública muestra lo mismo que el ranking interno.
    const html = await (await import("./helpers")).rawFetch(`/publico/ranking/${s.season.id}/${s.cab4.id}`).then((r) => r.text());
    expect(html).toContain("ApA");
    expect(html).toMatch(/>\s*100\s*</);
  });
});

describe("integridad · temporadas históricas", () => {
  it("una temporada cerrada queda intacta: nada la modifica y sólo un administrador puede reabrirla", async () => {
    const s = await setup();
    const t = await s.mkTournament("Apertura");
    const [a, b] = await Promise.all([s.mkPlayer("A"), s.mkPlayer("B")]);
    const t1 = await team(s.client, t.id, a.id, b.id);
    await results(s.client, t.id, [{ teamId: t1, stageId: await stage(s.client, t.id, "Campeón") }]);
    await confirm(s.client, t.id);
    expect((await s.client.patch(`/api/seasons/${s.season.id}/status`, { status: "cerrada" })).status).toBe(200);
    const snapshot = await ledger(s.season.id);
    const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements WHERE season_id = ?").bind(s.season.id).first<{ n: number }>())!.n;
    const n0 = await count();

    const champ = await stage(s.client, t.id, "Campeón");
    const attempts = [
      await s.client.put(`/api/tournaments/${t.id}/results`, { results: [{ teamId: t1, stageId: champ, matchesPlayed: 1, matchesWon: 1 }] }),
      await s.client.post(`/api/tournaments/${t.id}/credits/revert`, { reason: "x" }),
      await confirm(s.client, t.id, "x"),
      await s.client.post("/api/movements/adjustments", { playerId: a.id, seasonId: s.season.id, points: 5, reason: "x" }),
      await s.client.post(`/api/tournaments/${t.id}/teams`, { player1Id: a.id, player2Id: b.id }),
      await s.client.delete(`/api/teams/${t1}`),
      await s.client.put(`/api/rankings/tiebreakers/${s.season.id}`, { tiebreakers: ["titulos"] }),
      await s.client.post(`/api/tournaments/${t.id}/scoring/apply-template`, { templateId: 1 }),
    ];
    for (const r of attempts) expect([400, 409]).toContain(r.status);
    expect(await count()).toBe(n0);
    expect(await ledger(s.season.id)).toEqual(snapshot);

    // Una temporada nueva arranca de cero y no toca la anterior.
    const s2 = (await s.client.post("/api/seasons", { name: "Temporada 2027", year: 2027, startDate: "2027-01-01", endDate: "2027-12-31" })).json.item;
    await s.client.patch(`/api/seasons/${s2.id}/status`, { status: "activa" });
    await s.client.post("/api/movements/adjustments", { playerId: a.id, seasonId: s2.id, points: 7, reason: "Bonificación" });
    expect(pointsOf(await rankingOf(s.client, s2.id, s.cab4.id), a.id)).toBe(7);
    expect(pointsOf(await rankingOf(s.client, s.season.id, s.cab4.id), a.id)).toBe(100);

    // Reabrir: un organizador no puede; un administrador sí.
    const org = await createUser("orga", "clave-segura-456", "organizador");
    const other = new Client();
    await other.login(org.username, org.password);
    expect((await other.patch(`/api/seasons/${s.season.id}/status`, { status: "planificada" })).status).toBe(403);
    expect((await s.client.patch(`/api/seasons/${s.season.id}/status`, { status: "planificada" })).status).toBe(200);
  });
});

describe("integridad · historial protegido", () => {
  it("no se borran temporadas, categorías ni divisiones con puntos; no se cambia la rama de un jugador con historial", async () => {
    const s = await setup();
    const planned = (await s.client.post("/api/seasons", { name: "Temporada 2027", year: 2027, startDate: "2027-01-01", endDate: "2027-12-31" })).json.item;
    const a = await s.mkPlayer("A");
    expect((await s.client.post("/api/movements/adjustments", { playerId: a.id, seasonId: planned.id, points: 10, reason: "Saldo" })).status).toBe(201);
    const del = await s.client.delete(`/api/seasons/${planned.id}`);
    expect(del.status).toBe(409);
    expect(del.json.error.message).toMatch(/puntos registrados/);

    const t = await s.mkTournament("Apertura");
    const b = await s.mkPlayer("B");
    await team(s.client, t.id, a.id, b.id);
    const gender = await s.client.put(`/api/players/${a.id}`, { firstName: a.firstName, lastName: a.lastName, gender: "F", mainCategoryId: s.dam4.id });
    expect(gender.status).toBe(409);
    // Un jugador sin historial sí puede corregir su rama.
    const c = await s.mkPlayer("C");
    expect((await s.client.put(`/api/players/${c.id}`, { firstName: c.firstName, lastName: c.lastName, gender: "F", mainCategoryId: s.dam4.id })).status).toBe(200);
  });
});
