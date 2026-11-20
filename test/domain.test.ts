import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { loggedInAdmin, seedBasics } from "./helpers";

const basePlayer = (categoryId: number, extra: Record<string, unknown> = {}) => ({
  firstName: "Juan",
  lastName: "Pérez",
  gender: "M",
  mainCategoryId: categoryId,
  ...extra,
});

describe("categorías y divisiones", () => {
  it("crea, valida y lista categorías por rama", async () => {
    const { client } = await loggedInAdmin();
    const { cab4 } = await seedBasics(client);
    // Mismo nombre en otra rama: permitido. En la misma rama: conflicto.
    const dup = await client.post("/api/categories", { name: "4TA", gender: "M", level: 4 });
    expect(dup.status).toBe(409);
    const invalid = await client.post("/api/categories", { name: "", gender: "X", level: 0 });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.json.error.fields)).toEqual(expect.arrayContaining(["name", "gender", "level"]));

    const damas = await client.get("/api/categories?gender=F");
    expect(damas.json.items).toHaveLength(1);
    const div = await client.post(`/api/categories/${cab4.id}/divisions`, { name: "A", sortOrder: 1 });
    expect(div.status).toBe(201);
    expect(div.json.item.divisions).toHaveLength(1);
    expect((await client.post(`/api/categories/${cab4.id}/divisions`, { name: "a" })).status).toBe(409);
  });

  it("no desactiva categorías con jugadores activos y no cambia la rama si está en uso", async () => {
    const { client } = await loggedInAdmin();
    const { cab4 } = await seedBasics(client);
    await client.post("/api/players", basePlayer(cab4.id));
    const off = await client.patch(`/api/categories/${cab4.id}/active`, { active: false });
    expect(off.status).toBe(409);
    expect(off.json.error.message).toMatch(/1 jugador activo/);
    const gender = await client.put(`/api/categories/${cab4.id}`, { name: "4ta", gender: "F", level: 4, active: true });
    expect(gender.status).toBe(409);
    expect((await client.delete(`/api/categories/${cab4.id}`)).status).toBe(409);
  });

  it("elimina categorías sin uso", async () => {
    const { client } = await loggedInAdmin();
    const created = await client.post("/api/categories", { name: "Error", gender: "M", level: 9 });
    expect((await client.delete(`/api/categories/${created.json.item.id}`)).status).toBe(200);
    expect((await client.get(`/api/categories/${created.json.item.id}`)).status).toBe(404);
  });
});

describe("jugadores", () => {
  it("permite homónimos con identificadores distintos y avisa duplicados", async () => {
    const { client } = await loggedInAdmin();
    const { cab4, cab5 } = await seedBasics(client);
    const a = await client.post("/api/players", basePlayer(cab4.id));
    const b = await client.post("/api/players", basePlayer(cab5.id, { firstName: "juan", lastName: "Perez" }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.json.item.id).not.toBe(b.json.item.id);
    expect(a.json.item.code).toBe("J-00001");
    const audit = await env.DB.prepare("SELECT entity_id FROM audit_log WHERE entity = 'jugador' ORDER BY id").all<{ entity_id: number }>();
    expect(audit.results.map((r) => r.entity_id)).toEqual([a.json.item.id, b.json.item.id]);
    expect(b.json.item.code).toBe("J-00002");

    const dups = await client.get("/api/players/duplicates?firstName=JUAN&lastName=perez");
    expect(dups.json.items).toHaveLength(2);
    const excl = await client.get(`/api/players/duplicates?firstName=Juan&lastName=Pérez&excludeId=${a.json.item.id}`);
    expect(excl.json.items).toHaveLength(1);
  });

  it("valida rama de la categoría, documento único y datos", async () => {
    const { client } = await loggedInAdmin();
    const { cab4, dam4 } = await seedBasics(client);
    const wrongGender = await client.post("/api/players", basePlayer(dam4.id));
    expect(wrongGender.status).toBe(400);
    expect(wrongGender.json.error.fields.mainCategoryId).toBeDefined();
    expect((await client.post("/api/players", basePlayer(cab4.id, { documentNumber: "30.123.456" }))).status).toBe(201);
    const dupDoc = await client.post("/api/players", basePlayer(cab4.id, { firstName: "Otro", documentNumber: "30123456" }));
    expect(dupDoc.status).toBe(409);
    expect(dupDoc.json.error.fields.documentNumber).toBeDefined();
    const bad = await client.post("/api/players", basePlayer(cab4.id, { email: "no-es-email", birthDate: "2020-02-30" }));
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields).toHaveProperty("email");
    expect(bad.json.error.fields).toHaveProperty("birthDate");
  });

  it("busca ignorando acentos y mayúsculas, por código, con filtros y paginación", async () => {
    const { client } = await loggedInAdmin();
    const { cab4, cab5, dam4 } = await seedBasics(client);
    await client.post("/api/players", basePlayer(cab4.id, { firstName: "José", lastName: "Gómez", nickname: "Pepe" }));
    await client.post("/api/players", basePlayer(cab5.id, { firstName: "Martín", lastName: "Núñez" }));
    await client.post("/api/players", { firstName: "María", lastName: "Gómez", gender: "F", mainCategoryId: dam4.id });

    expect((await client.get("/api/players?q=gomez")).json.total).toBe(2);
    expect((await client.get("/api/players?q=JOSE%20GOMEZ")).json.total).toBe(1);
    expect((await client.get("/api/players?q=pepe")).json.total).toBe(1);
    expect((await client.get("/api/players?q=nunez")).json.items[0].firstName).toBe("Martín");
    expect((await client.get("/api/players?q=J-00002")).json.items[0].lastName).toBe("Núñez");
    expect((await client.get("/api/players?gender=F")).json.total).toBe(1);
    expect((await client.get(`/api/players?categoryId=${cab5.id}`)).json.total).toBe(1);
    expect((await client.get("/api/players?q=100%25")).json.total).toBe(0); // comodín escapado
    const page = await client.get("/api/players?pageSize=2&page=2");
    expect(page.json.items).toHaveLength(1);
    expect(page.json.total).toBe(3);
  });

  it("registra el historial de categoría al dar de alta y al cambiar", async () => {
    const { client } = await loggedInAdmin();
    const { cab4, cab5 } = await seedBasics(client);
    const p = (await client.post("/api/players", basePlayer(cab5.id))).json.item;
    const upd = await client.put(`/api/players/${p.id}`, basePlayer(cab4.id, { categoryChangeType: "ascenso", categoryChangeReason: "Campeón" }));
    expect(upd.status).toBe(200);
    expect(upd.json.item.mainCategoryName).toBe("4ta");
    const detail = await client.get(`/api/players/${p.id}`);
    const history = detail.json.item.categoryHistory;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ fromCategoryName: "5ta", toCategoryName: "4ta", changeType: "ascenso", reason: "Campeón" });
    expect(history[1]).toMatchObject({ fromCategoryName: null, toCategoryName: "5ta", changeType: "alta" });
    // Editar sin cambiar categoría no agrega historial.
    await client.put(`/api/players/${p.id}`, basePlayer(cab4.id, { phone: "11 5555-5555" }));
    expect((await client.get(`/api/players/${p.id}`)).json.item.categoryHistory).toHaveLength(2);
  });

  it("desactiva y reactiva jugadores; los inactivos no aparecen por defecto", async () => {
    const { client } = await loggedInAdmin();
    const { cab4 } = await seedBasics(client);
    const p = (await client.post("/api/players", basePlayer(cab4.id))).json.item;
    expect((await client.patch(`/api/players/${p.id}/active`, { active: false })).json.item.active).toBe(false);
    expect((await client.get("/api/players")).json.total).toBe(0);
    expect((await client.get("/api/players?status=inactivos")).json.total).toBe(1);
    expect((await client.get("/api/players?status=todos")).json.total).toBe(1);
    expect((await client.patch(`/api/players/${p.id}/active`, { active: true })).json.item.active).toBe(true);
  });

  it("devuelve 404 para jugadores inexistentes o ids inválidos", async () => {
    const { client } = await loggedInAdmin();
    expect((await client.get("/api/players/999")).status).toBe(404);
    expect((await client.get("/api/players/abc")).status).toBe(404);
  });
});

describe("temporadas", () => {
  it("permite una sola temporada activa", async () => {
    const { client } = await loggedInAdmin();
    const { season } = await seedBasics(client);
    expect(season.status).toBe("planificada");
    const s2 = (await client.post("/api/seasons", { name: "Temporada 2027", year: 2027, startDate: "2027-01-01", endDate: "2027-12-31" })).json.item;
    expect((await client.patch(`/api/seasons/${season.id}/status`, { status: "activa" })).status).toBe(200);
    const second = await client.patch(`/api/seasons/${s2.id}/status`, { status: "activa" });
    expect(second.status).toBe(409);
    expect(second.json.error.message).toMatch(/Temporada 2026/);
  });

  it("valida fechas y no cierra con torneos abiertos", async () => {
    const { client } = await loggedInAdmin();
    const { season, cab4 } = await seedBasics(client);
    const bad = await client.post("/api/seasons", { name: "Mal", year: 2026, startDate: "2026-12-01", endDate: "2026-01-01" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields.endDate).toBeDefined();
    await client.post("/api/tournaments", { seasonId: season.id, name: "Apertura", type: "largo", categoryId: cab4.id, startDate: "2026-03-01", endDate: "2026-04-01" });
    const close = await client.patch(`/api/seasons/${season.id}/status`, { status: "cerrada" });
    expect(close.status).toBe(409);
    const shrink = await client.put(`/api/seasons/${season.id}`, { name: "Temporada 2026", year: 2026, startDate: "2026-05-01", endDate: "2026-12-31" });
    expect(shrink.status).toBe(400);
    expect((await client.delete(`/api/seasons/${season.id}`)).status).toBe(409);
  });
});

describe("torneos", () => {
  it("crea torneos largos y americanos con sus reglas de fecha", async () => {
    const { client } = await loggedInAdmin();
    const { season, cab4 } = await seedBasics(client);
    const americano = await client.post("/api/tournaments", {
      seasonId: season.id, name: "Americano de invierno", type: "americano", categoryId: cab4.id,
      startDate: "2026-07-10", endDate: "2026-07-20",
    });
    expect(americano.status).toBe(201);
    expect(americano.json.item.endDate).toBe("2026-07-10"); // un solo día
    expect(americano.json.item.status).toBe("programado");
    expect(americano.json.item.gender).toBe("M");

    const outside = await client.post("/api/tournaments", {
      seasonId: season.id, name: "Fuera", type: "largo", categoryId: cab4.id, startDate: "2027-02-01", endDate: "2027-03-01",
    });
    expect(outside.status).toBe(400);
    expect(outside.json.error.fields.startDate).toBeDefined();
  });

  it("valida que la división pertenezca a la categoría", async () => {
    const { client } = await loggedInAdmin();
    const { season, cab4, cab5 } = await seedBasics(client);
    const withDiv = (await client.post(`/api/categories/${cab5.id}/divisions`, { name: "Oro" })).json.item;
    const divisionId = withDiv.divisions[0].id;
    const wrong = await client.post("/api/tournaments", {
      seasonId: season.id, name: "Torneo", type: "largo", categoryId: cab4.id, divisionId, startDate: "2026-03-01",
    });
    expect(wrong.status).toBe(400);
    const ok = await client.post("/api/tournaments", {
      seasonId: season.id, name: "Torneo", type: "largo", categoryId: cab5.id, divisionId, startDate: "2026-03-01",
    });
    expect(ok.status).toBe(201);
    expect(ok.json.item.divisionName).toBe("Oro");
    // División en uso: no se puede eliminar.
    expect((await client.delete(`/api/divisions/${divisionId}`)).status).toBe(400);
  });

  it("controla las transiciones de estado y el borrado", async () => {
    const { client } = await loggedInAdmin();
    const { season, cab4 } = await seedBasics(client);
    const t = (await client.post("/api/tournaments", {
      seasonId: season.id, name: "Clausura", type: "largo", categoryId: cab4.id, startDate: "2026-09-01", endDate: "2026-10-15",
    })).json.item;
    expect((await client.patch(`/api/tournaments/${t.id}/status`, { status: "finalizado" })).status).toBe(400);
    expect((await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" })).json.item.status).toBe("en_curso");
    expect((await client.delete(`/api/tournaments/${t.id}`)).status).toBe(409);
    expect((await client.patch(`/api/tournaments/${t.id}/status`, { status: "finalizado" })).json.item.status).toBe("finalizado");

    // Con todos los torneos finalizados, la temporada se puede cerrar y queda bloqueada.
    expect((await client.patch(`/api/seasons/${season.id}/status`, { status: "cerrada" })).status).toBe(200);
    expect((await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" })).status).toBe(409);
    const blocked = await client.post("/api/tournaments", {
      seasonId: season.id, name: "Nuevo", type: "americano", categoryId: cab4.id, startDate: "2026-11-01",
    });
    expect(blocked.status).toBe(400);
  });

  it("filtra por temporada, rama, tipo, estado y texto sin acentos", async () => {
    const { client } = await loggedInAdmin();
    const { season, cab4, dam4 } = await seedBasics(client);
    const mk = (name: string, type: string, categoryId: number, startDate: string) =>
      client.post("/api/tournaments", { seasonId: season.id, name, type, categoryId, startDate });
    await mk("Copa Otoño", "largo", cab4.id, "2026-04-01");
    await mk("Americano Damas", "americano", dam4.id, "2026-05-01");
    await mk("Americano Caballeros", "americano", cab4.id, "2026-06-01");
    expect((await client.get("/api/tournaments")).json.items).toHaveLength(3);
    expect((await client.get("/api/tournaments?gender=F")).json.items).toHaveLength(1);
    expect((await client.get("/api/tournaments?type=americano")).json.items).toHaveLength(2);
    expect((await client.get("/api/tournaments?q=otono")).json.items[0].name).toBe("Copa Otoño");
    expect((await client.get(`/api/tournaments?seasonId=${season.id}&status=programado`)).json.items).toHaveLength(3);
  });
});

describe("dashboard", () => {
  it("resume jugadores, temporada activa, torneos y actividad", async () => {
    const { client } = await loggedInAdmin();
    const { season, cab4, dam4 } = await seedBasics(client);
    await client.patch(`/api/seasons/${season.id}/status`, { status: "activa" });
    await client.post("/api/players", basePlayer(cab4.id));
    await client.post("/api/players", { firstName: "Ana", lastName: "Paz", gender: "F", mainCategoryId: dam4.id });
    await client.post("/api/tournaments", { seasonId: season.id, name: "Fin de año", type: "americano", categoryId: cab4.id, startDate: "2026-12-20" });
    const d = (await client.get("/api/dashboard")).json;
    expect(d.players).toMatchObject({ active: 2, inactive: 0, byGender: { M: 1, F: 1 } });
    expect(d.categories.active).toBe(3);
    expect(d.activeSeason.name).toBe("Temporada 2026");
    expect(d.activeSeason.progress).toBeGreaterThanOrEqual(0);
    expect(d.tournaments.scheduled).toBe(1);
    expect(d.recentActivity.length).toBeGreaterThan(0);
    expect(d.recentActivity[0].userName).toBe("ADMIN");
    expect(d.playersByCategory.find((x: { name: string; gender: string }) => x.name === "4ta" && x.gender === "M").count).toBe(1);
  });
});
