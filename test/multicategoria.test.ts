/**
 * Torneos con varias categorías: un torneo (evento general) con una competencia por categoría.
 * Cada categoría tiene su propio fixture, resultados y acreditación; la web muestra el torneo una sola vez.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { distributeGroups, drawOrder, type FixtureState, type SetScore } from "@shared/fixture";
import { Client, loggedInAdmin, rawFetch } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const W: SetScore[] = [[6, 3], [6, 4]];

async function base() {
  const { client } = await loggedInAdmin();
  const cats: Json[] = [];
  for (const [name, level] of [["C5", 5], ["C6", 6], ["C7", 7], ["C8", 8]] as const) cats.push((await client.post("/api/categories", { name, gender: "M", level })).json.item);
  const damas = (await client.post("/api/categories", { name: "C5", gender: "F", level: 5 })).json.item;
  const season = (await client.post("/api/seasons", { name: "Temporada 2026", year: 2026, startDate: "2026-01-01", endDate: "2026-12-31" })).json.item;
  return { client, cats: cats as [Json, Json, Json, Json], damas, season };
}

async function openTournament(client: Client, seasonId: number, catIds: number[], extra: Json = {}) {
  const r = await client.post("/api/events", {
    seasonId, name: "Open Padel Time — Noviembre 2026", type: "largo", startDate: "2026-11-02", endDate: "2026-11-30",
    publicVisible: true, publicDescription: "Martes y jueves desde las 21.", competitions: catIds.map((categoryId) => ({ categoryId })), ...extra,
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.item as Json;
}

async function addTeams(client: Client, tid: number, categoryId: number, n: number, tag: string) {
  for (let i = 0; i < n; i++) {
    const p1 = (await client.post("/api/players", { firstName: `${tag}${i}`, lastName: "Uno", gender: "M", mainCategoryId: categoryId })).json.item;
    const p2 = (await client.post("/api/players", { firstName: `${tag}${i}`, lastName: "Dos", gender: "M", mainCategoryId: categoryId })).json.item;
    expect((await client.post(`/api/tournaments/${tid}/teams`, { player1Id: p1.id, player2Id: p2.id })).status).toBe(201);
  }
}

const fx = async (c: Client, tid: number) => (await c.get(`/api/tournaments/${tid}/fixture`)).json.item as FixtureState;
async function groupsFor(c: Client, tid: number) {
  let s = await fx(c, tid);
  s = (await c.put(`/api/tournaments/${tid}/fixture/config`, { version: s.version, config: { ...s.config, groupCount: 1 } })).json.item;
  const groups = distributeGroups(drawOrder(s.teams, null), 1).map((g) => g.map((t) => t.id));
  return (await c.put(`/api/tournaments/${tid}/fixture/groups`, { version: s.version, groups })).json.item as FixtureState;
}

describe("torneo con varias categorías", () => {
  it("1. se crea un único torneo con C5, C6, C7 y C8 (una competencia por categoría) y sin Damas", async () => {
    const { client, cats, damas, season } = await base();
    const ev = await openTournament(client, season.id, cats.map((c) => c.id));
    expect(ev.tournaments.map((t: Json) => t.categoryName)).toEqual(["C5", "C6", "C7", "C8"]);
    expect(ev.tournaments.every((t: Json) => t.eventId === ev.id && t.name === ev.name && t.type === "largo" && t.publicVisible && t.publicDescription === "Martes y jueves desde las 21.")).toBe(true);
    expect(ev.status).toBe("programado");
    // Cada competencia tiene su propia puntuación (copiada de la plantilla).
    for (const t of ev.tournaments) expect((await client.get(`/api/tournaments/${t.id}/scoring`)).json.item.stages.length).toBeGreaterThan(0);
    // Damas está discontinuada; una categoría no se repite en el torneo; hace falta al menos una.
    expect((await client.post("/api/events", { seasonId: season.id, name: "X", startDate: "2026-11-02", competitions: [{ categoryId: damas.id }] })).status).toBe(400);
    expect((await client.put(`/api/events/${ev.id}`, { seasonId: season.id, name: ev.name, startDate: "2026-11-02", endDate: "2026-11-30", competitions: [{ categoryId: cats[0].id }] })).status).toBe(409);
    expect((await client.post("/api/events", { seasonId: season.id, name: "Sin categorías", startDate: "2026-11-02", competitions: [] })).status).toBe(400);
    // Los datos generales se editan una sola vez y se copian a todas las categorías.
    const edited = (await client.put(`/api/events/${ev.id}`, { seasonId: season.id, name: "Open Noviembre", type: "largo", startDate: "2026-11-03", endDate: "2026-11-28", publicVisible: true, prizeInfo: "Paletas" })).json.item;
    expect(edited.tournaments.every((t: Json) => t.name === "Open Noviembre" && t.startDate === "2026-11-03" && t.prizeInfo === "Paletas")).toBe(true);
  });

  it("2. un torneo de una sola categoría (y el alta anterior por competencia) también queda dentro de su torneo", async () => {
    const { client, cats, season } = await base();
    const ev = await openTournament(client, season.id, [cats[1].id]);
    expect(ev.tournaments).toHaveLength(1);
    const legacy = (await client.post("/api/tournaments", { seasonId: season.id, name: "Satélite Diciembre", type: "americano", categoryId: cats[0].id, startDate: "2026-12-05" })).json.item;
    expect(legacy.eventId).not.toBeNull();
    const legacyEvent = (await client.get(`/api/events/${legacy.eventId}`)).json.item;
    expect(legacyEvent).toMatchObject({ name: "Satélite Diciembre", type: "americano", tournaments: [expect.objectContaining({ id: legacy.id })] });
    // Editar la competencia de un torneo de una categoría actualiza el torneo general.
    await client.put(`/api/tournaments/${legacy.id}`, { ...legacy, name: "Satélite Navidad", startDate: "2026-12-05", publicVisible: true });
    expect((await client.get(`/api/events/${legacy.eventId}`)).json.item).toMatchObject({ name: "Satélite Navidad", publicVisible: true });
  });

  it("3-4. fixtures independientes por categoría: cargar resultados en una no afecta a las demás", async () => {
    const { client, cats, season } = await base();
    const ev = await openTournament(client, season.id, cats.map((c) => c.id));
    const [c5, c6] = ev.tournaments as Json[];
    await addTeams(client, c5!.id, cats[0].id, 4, "A");
    await addTeams(client, c6!.id, cats[1].id, 3, "B");
    let s5 = await groupsFor(client, c5!.id);
    const s6 = await groupsFor(client, c6!.id);
    expect(s5.matches).toHaveLength(6);
    expect(s6.matches).toHaveLength(3);
    expect(s5.teams.map((t) => t.id).some((id) => s6.teams.some((u) => u.id === id))).toBe(false);
    const m = s5.matches[0]!;
    s5 = (await client.put(`/api/tournaments/${c5!.id}/fixture/matches/${m.id}/result`, { version: m.version, status: "jugado", sets: W })).json.item;
    expect(s5.standings[0]!.played).toBe(1);
    const after6 = await fx(client, c6!.id);
    expect(after6.version).toBe(s6.version);
    expect(after6.matches.every((x) => x.status === "pendiente")).toBe(true);
    // Un partido de otra categoría no se puede cargar desde esta.
    expect((await client.put(`/api/tournaments/${c6!.id}/fixture/matches/${m.id}/result`, { version: 1, status: "jugado", sets: W })).status).toBe(404);
  });

  it("5. se finaliza y acredita una categoría mientras las otras siguen abiertas, sin duplicados", async () => {
    const { client, cats, season } = await base();
    const ev = await openTournament(client, season.id, cats.map((c) => c.id));
    const [c5, c6] = ev.tournaments as Json[];
    await addTeams(client, c5!.id, cats[0].id, 2, "A");
    await addTeams(client, c6!.id, cats[1].id, 2, "B");
    await client.patch(`/api/tournaments/${c6!.id}/status`, { status: "en_curso" });
    // C5: instancias y acreditación (flujo existente).
    const teams = (await client.get(`/api/tournaments/${c5!.id}/teams`)).json.items as Json[];
    const stages = (await client.get(`/api/tournaments/${c5!.id}/scoring`)).json.item.stages as Json[];
    await client.put(`/api/tournaments/${c5!.id}/results`, { results: [{ teamId: teams[0]!.id, stageId: stages[0]!.id }, { teamId: teams[1]!.id, stageId: stages[1]!.id }] });
    await client.patch(`/api/tournaments/${c5!.id}/status`, { status: "en_curso" });
    await client.patch(`/api/tournaments/${c5!.id}/status`, { status: "finalizado" });
    const preview = (await client.get(`/api/tournaments/${c5!.id}/preview`)).json;
    expect((await client.post(`/api/tournaments/${c5!.id}/credits`, { previewHash: preview.previewHash })).status).toBe(201);
    expect((await client.post(`/api/tournaments/${c5!.id}/credits`, { previewHash: preview.previewHash })).status).toBe(409); // sin duplicados

    const evNow = (await client.get(`/api/events/${ev.id}`)).json.item;
    expect(evNow.status).toBe("en_curso"); // una categoría terminada, otras abiertas
    expect(evNow.tournaments.map((t: Json) => [t.categoryName, t.status, t.creditedVersion])).toEqual([
      ["C5", "finalizado", 1], ["C6", "en_curso", null], ["C7", "programado", null], ["C8", "programado", null],
    ]);
    // Los puntos sólo son de C5.
    const moved = await env.DB.prepare("SELECT DISTINCT tournament_id FROM point_movements").all();
    expect(moved.results).toEqual([{ tournament_id: c5!.id }]);
    const r5 = (await client.get(`/api/rankings?seasonId=${season.id}&categoryId=${cats[0].id}`)).json.rows as Json[];
    expect(r5).toHaveLength(4);
    expect((await client.get(`/api/rankings?seasonId=${season.id}&categoryId=${cats[1].id}`)).json.rows).toHaveLength(0);
  });

  it("6. la web muestra el torneo una sola vez y cada categoría con su propio fixture", async () => {
    const { client, cats, season } = await base();
    const ev = await openTournament(client, season.id, cats.map((c) => c.id));
    const [c5, c6] = ev.tournaments as Json[];
    await addTeams(client, c5!.id, cats[0].id, 3, "Ana");
    await addTeams(client, c6!.id, cats[1].id, 3, "Beto");
    const s5 = await groupsFor(client, c5!.id);
    await client.post(`/api/tournaments/${c5!.id}/fixture/publish`, { version: s5.version });

    const list = await (await rawFetch("/torneos")).text();
    expect(list.split("Open Padel Time — Noviembre 2026").length - 1).toBe(1); // una sola tarjeta
    expect(list).toContain("C5 · C6 · C7 · C8");
    const cal = await (await rawFetch("/calendario?mes=2026-11")).text();
    // Un solo torneo en el calendario: chip de inicio y de fin (texto + título) y una fila en la agenda = 5 (con 4 torneos serían 20).
    expect(cal.match(/Open Padel Time — Noviembre 2026/g)?.length).toBe(5);
    expect(cal).toContain("C5 · C6 · C7 · C8");

    const page5 = await (await rawFetch(`/torneos/open-padel-time-noviembre-2026-${c5!.id}`)).text();
    expect(page5).toContain('aria-label="Categorías del torneo"');
    for (const c of ev.tournaments) expect(page5).toContain(`-${c.id}"`);
    expect(page5).toContain('id="fixture"');
    expect(page5).toContain("Ana0 Uno");
    const page6 = await (await rawFetch(`/torneos/open-padel-time-noviembre-2026-${c6!.id}`)).text();
    expect(page6).not.toContain('id="fixture"'); // C6 todavía no publicó su fixture
    expect(page6).not.toContain("Ana0 Uno");
  });

  it("7. los torneos anteriores siguen funcionando (una categoría, carga manual, acreditación y web)", async () => {
    const { client, cats, season } = await base();
    const t = (await client.post("/api/tournaments", { seasonId: season.id, name: "Apertura", type: "largo", categoryId: cats[0].id, startDate: "2026-03-01", endDate: "2026-04-01", publicVisible: true })).json.item;
    await addTeams(client, t.id, cats[0].id, 1, "Viejo");
    const team = (await client.get(`/api/tournaments/${t.id}/teams`)).json.items[0];
    const stages = (await client.get(`/api/tournaments/${t.id}/scoring`)).json.item.stages as Json[];
    await client.put(`/api/tournaments/${t.id}/results`, { results: [{ teamId: team.id, stageId: stages[0]!.id }] });
    await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
    const p = (await client.get(`/api/tournaments/${t.id}/preview`)).json;
    expect((await client.post(`/api/tournaments/${t.id}/credits`, { previewHash: p.previewHash })).status).toBe(201);
    const html = await (await rawFetch(`/torneos/apertura-${t.id}`)).text();
    expect(html).toContain("Resultado final");
    expect(html).not.toContain('aria-label="Categorías del torneo"'); // una sola categoría: sin selector
  });

  it("borrar la última categoría elimina el torneo vacío", async () => {
    const { client, cats, season } = await base();
    const ev = await openTournament(client, season.id, [cats[2].id]);
    expect((await client.delete(`/api/tournaments/${ev.tournaments[0].id}`)).status).toBe(200);
    expect((await client.get(`/api/events/${ev.id}`)).status).toBe(404);
  });
});
