import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { loggedInAdmin, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function setup() {
  const { client } = await loggedInAdmin();
  const base = await seedBasics(client);
  await client.patch(`/api/seasons/${base.season.id}/status`, { status: "activa" });
  const t = (await client.post("/api/tournaments", { seasonId: base.season.id, name: "Master", type: "largo", categoryId: base.cab4.id, startDate: "2026-06-01", endDate: "2026-06-30" })).json.item;
  await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
  const players: Json[] = [];
  for (let i = 0; i < 8; i++) players.push((await client.post("/api/players", { firstName: `N${i}`, lastName: `Apellido${i}`, gender: "M", mainCategoryId: base.cab4.id })).json.item);
  const scoring = (await client.get(`/api/tournaments/${t.id}/scoring`)).json.item;
  const stage = (label: string) => scoring.stages.find((s: Json) => s.label === label).id as number;
  const source = { fileName: "cuadro.png", recognitionMode: "estructura", elapsedMs: 3000, createdPlayers: 0, correctedFields: 1, warnings: ["lectura dudosa"], summary: [] };
  return { client, ...base, t, players, stage, source };
}

describe("directorio de jugadores", () => {
  it("exige la rama y devuelve los jugadores con su categoría", async () => {
    const s = await setup();
    expect((await s.client.get("/api/players/directory")).status).toBe(400);
    const r = await s.client.get("/api/players/directory?gender=M");
    expect(r.json.items).toHaveLength(8);
    expect(r.json.items[0]).toMatchObject({ mainCategoryName: "4ta", active: true });
  });
});

describe("importación de un cuadro", () => {
  it("reemplaza parejas, carga instancias y NO acredita puntos", async () => {
    const s = await setup();
    const [a, b, c, d, e, f, g, h] = s.players.map((p) => p.id);
    // Pareja previa que debe desaparecer al reemplazar.
    await s.client.post(`/api/tournaments/${s.t.id}/teams`, { player1Id: a, player2Id: h });
    const res = await s.client.post(`/api/tournaments/${s.t.id}/import`, {
      mode: "reemplazar",
      source: s.source,
      teams: [
        { player1Id: a, player2Id: b, stageId: s.stage("Campeón"), matchesPlayed: 2, matchesWon: 2 },
        { player1Id: c, player2Id: d, stageId: s.stage("Finalista"), matchesPlayed: 2, matchesWon: 1 },
        { player1Id: e, player2Id: f, stageId: s.stage("Semifinal"), matchesPlayed: 1, matchesWon: 0 },
        { player1Id: g, player2Id: h, stageId: s.stage("Semifinal"), matchesPlayed: 1, matchesWon: 0 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.json.inserted).toBe(4);
    const teams = res.json.items as Json[];
    expect(teams).toHaveLength(4);
    expect(teams.every((t) => t.players.length === 2)).toBe(true);
    expect(teams.find((t) => t.players.some((p: Json) => p.id === a))!.matchesWon).toBe(2);

    // Nada acreditado: ni acreditaciones ni movimientos.
    const credits = await env.DB.prepare("SELECT COUNT(*) AS n FROM tournament_credits").first<{ n: number }>();
    const moves = await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements").first<{ n: number }>();
    expect(credits!.n).toBe(0);
    expect(moves!.n).toBe(0);
    // Sin marcas temporales residuales.
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM tournament_teams WHERE notes IS NOT NULL").first<{ n: number }>())!.n).toBe(0);

    // La previsualización de la Fase 2 ya muestra los puntos propuestos.
    const preview = (await s.client.get(`/api/tournaments/${s.t.id}/preview`)).json;
    expect(preview.canConfirm).toBe(true);
    expect(preview.totals).toEqual({ teams: 4, players: 8, points: 2 * (100 + 70 + 50 + 50) });

    // Queda el registro auditable de la importación.
    const imports = (await s.client.get(`/api/tournaments/${s.t.id}/imports`)).json.items;
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ fileName: "cuadro.png", recognitionMode: "estructura", importMode: "reemplazar", teamCount: 4, correctedFields: 1, warnings: ["lectura dudosa"], createdByName: "ADMIN" });
  });

  it("en modo agregar actualiza la misma dupla, suma las nuevas y rechaza jugadores ya inscriptos con otra pareja", async () => {
    const s = await setup();
    const [a, b, c, d, e] = s.players.map((p) => p.id);
    await s.client.post(`/api/tournaments/${s.t.id}/teams`, { player1Id: a, player2Id: b });
    const res = await s.client.post(`/api/tournaments/${s.t.id}/import`, {
      mode: "agregar", source: s.source,
      teams: [
        { player1Id: b, player2Id: a, stageId: s.stage("Campeón"), matchesPlayed: 1, matchesWon: 1 },
        { player1Id: c, player2Id: d, stageId: s.stage("Finalista"), matchesPlayed: 1, matchesWon: 0 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ inserted: 1, updated: 1 });
    expect(res.json.items).toHaveLength(2);
    const conflict = await s.client.post(`/api/tournaments/${s.t.id}/import`, {
      mode: "agregar", source: s.source, teams: [{ player1Id: a, player2Id: e, stageId: null }],
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.message).toMatch(/ya está inscripto/);
  });

  it("valida jugadores, ramas, repeticiones e instancias (todo o nada)", async () => {
    const s = await setup();
    const [a, b, c, d] = s.players.map((p) => p.id);
    const dama = (await s.client.post("/api/players", { firstName: "Ana", lastName: "Dama", gender: "F", mainCategoryId: s.dam4.id })).json.item;
    const post = (teams: Json[]) => s.client.post(`/api/tournaments/${s.t.id}/import`, { mode: "reemplazar", source: s.source, teams });
    expect((await post([{ player1Id: a, player2Id: dama.id, stageId: null }])).status).toBe(400);
    expect((await post([{ player1Id: a, player2Id: b, stageId: null }, { player1Id: a, player2Id: c, stageId: null }])).status).toBe(400);
    expect((await post([{ player1Id: a, player2Id: b, stageId: 99999 }])).status).toBe(400);
    expect((await post([{ player1Id: a, player2Id: a, stageId: null }])).status).toBe(400);
    await s.client.patch(`/api/players/${d}/active`, { active: false });
    const inactive = await post([{ player1Id: c, player2Id: d, stageId: null }]);
    expect(inactive.status).toBe(400);
    expect(inactive.json.error.message).toMatch(/inactivo/);
    expect((await s.client.get(`/api/tournaments/${s.t.id}/teams`)).json.items).toHaveLength(0);
  });

  it("no permite importar en torneos de temporadas cerradas o cancelados", async () => {
    const s = await setup();
    const [p0, p1] = s.players as [Json, Json];
    await s.client.patch(`/api/tournaments/${s.t.id}/status`, { status: "cancelado" });
    const res = await s.client.post(`/api/tournaments/${s.t.id}/import`, { mode: "reemplazar", source: s.source, teams: [{ player1Id: p0.id, player2Id: p1.id, stageId: null }] });
    expect(res.status).toBe(409);
  });

  it("importa un cuadro de 16 parejas en una sola operación", async () => {
    const s = await setup();
    const ids: number[] = s.players.map((p) => p.id);
    for (let i = 0; i < 24; i++) {
      const row = await env.DB.prepare("INSERT INTO players (first_name, last_name, gender, main_category_id, search_text) VALUES (?, ?, 'M', ?, '') RETURNING id").bind(`X${i}`, `Y${i}`, s.cab4.id).first<{ id: number }>();
      ids.push(row!.id);
    }
    const teams = Array.from({ length: 16 }, (_, i) => ({
      player1Id: ids[i * 2]!, player2Id: ids[i * 2 + 1]!,
      stageId: s.stage(i === 0 ? "Campeón" : i === 1 ? "Finalista" : i < 4 ? "Semifinal" : i < 8 ? "Cuartos de final" : "Octavos de final"),
      matchesPlayed: 1, matchesWon: 0,
    }));
    const res = await s.client.post(`/api/tournaments/${s.t.id}/import`, { mode: "reemplazar", source: s.source, teams });
    expect(res.status).toBe(201);
    expect(res.json.items).toHaveLength(16);
    const preview = (await s.client.get(`/api/tournaments/${s.t.id}/preview`)).json;
    expect(preview.canConfirm).toBe(true);
    expect(preview.totals.players).toBe(32);
  });
});
