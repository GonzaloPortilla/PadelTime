import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Client, loggedInAdmin, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function setup() {
  const { client } = await loggedInAdmin();
  const base = await seedBasics(client);
  await client.patch(`/api/seasons/${base.season.id}/status`, { status: "activa" });
  const mk = async (firstName: string, lastName: string, categoryId = base.cab4.id, gender = "M") =>
    (await client.post("/api/players", { firstName, lastName, gender, mainCategoryId: categoryId })).json.item as Json;
  const juan = await mk("Juan", "Pérez");
  const martin = await mk("Martín", "Gómez");
  const sofia = await mk("Sofía", "Martínez", base.dam4.id, "F");
  return { client, ...base, juan, martin, sofia, mk };
}

function payload(s: Awaited<ReturnType<typeof setup>>, over: Json = {}) {
  return {
    fileName: "ranking-4ta-2026.xlsx",
    fileHash: HASH_A,
    sheetNames: ["Hoja1"],
    mapping: { col_name: 1, col_points: 2 },
    newPlayers: [{ key: "n1", firstName: "Lucas", lastName: "Nuevo", gender: "M", mainCategoryId: s.cab4.id }],
    rows: [
      { rowNumber: 2, sourceName: "PEREZ, JUAN", sourcePosition: "1", playerId: s.juan.id, newKey: null, seasonId: s.season.id, categoryId: s.cab4.id, divisionId: null, points: 320 },
      { rowNumber: 3, sourceName: "Martin Gomez", sourcePosition: "2", playerId: s.martin.id, newKey: null, seasonId: s.season.id, categoryId: s.cab4.id, divisionId: null, points: 250 },
      { rowNumber: 4, sourceName: "LUCAS NUEVO", sourcePosition: "3", playerId: null, newKey: "n1", seasonId: s.season.id, categoryId: s.cab4.id, divisionId: null, points: 90 },
    ],
    skippedRows: 1,
    warnings: [],
    ...over,
  };
}

const rankingOf = async (c: Client, seasonId: number, categoryId: number) => (await c.get(`/api/rankings?seasonId=${seasonId}&categoryId=${categoryId}`)).json as Json;
const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;

describe("vista previa de importación de rankings", () => {
  it("no escribe nada y resume rankings, jugadores y puntos", async () => {
    const s = await setup();
    const r = await s.client.post("/api/ranking-imports/preview", payload(s));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, rowCount: 3, playerCount: 3, newPlayerCount: 1, totalPoints: 660 });
    expect(r.json.rankings).toEqual([expect.objectContaining({ categoryName: "4ta", gender: "M", players: 3, points: 660, existingPoints: 0 })]);
    expect(await count("SELECT COUNT(*) AS n FROM point_movements")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM ranking_imports")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM players")).toBe(3);
  });

  it("detecta jugador repetido en el mismo ranking, rama equivocada y referencias inválidas", async () => {
    const s = await setup();
    const p = payload(s);
    p.rows.push({ rowNumber: 9, sourceName: "J. PEREZ", sourcePosition: null, playerId: s.juan.id, newKey: null, seasonId: s.season.id, categoryId: s.cab4.id, divisionId: null, points: 10 } as never);
    p.rows.push({ rowNumber: 10, sourceName: "SOFIA MARTINEZ", sourcePosition: null, playerId: s.sofia.id, newKey: null, seasonId: s.season.id, categoryId: s.cab4.id, divisionId: null, points: 10 } as never);
    p.rows.push({ rowNumber: 11, sourceName: "X", sourcePosition: null, playerId: s.martin.id, newKey: null, seasonId: s.season.id, categoryId: s.cab5.id, divisionId: 99999, points: 10 } as never);
    const r = await s.client.post("/api/ranking-imports/preview", p);
    expect(r.json.ok).toBe(false);
    const msgs = (r.json.issues as Json[]).filter((i) => i.level === "error").map((i) => i.message).join("\n");
    expect(msgs).toMatch(/aparece 2 veces en el mismo ranking/);
    expect(msgs).toMatch(/rama distinta/);
    expect(msgs).toMatch(/división que no pertenece|inexistente/);
  });

  it("advierte categoría principal distinta, temporada cerrada y homónimos", async () => {
    const s = await setup();
    const cerrada = (await s.client.post("/api/seasons", { name: "Temporada 2024", year: 2024, startDate: "2024-01-01", endDate: "2024-12-31" })).json.item;
    await env.DB.prepare("UPDATE seasons SET status = 'cerrada' WHERE id = ?").bind(cerrada.id).run();
    const p = payload(s, {
      newPlayers: [{ key: "n1", firstName: "Juan", lastName: "Pérez", gender: "M", mainCategoryId: s.cab5.id }],
      rows: [
        { rowNumber: 2, sourceName: "Martin Gomez", playerId: s.martin.id, newKey: null, seasonId: cerrada.id, categoryId: s.cab5.id, divisionId: null, points: 40 },
        { rowNumber: 3, sourceName: "Juan Perez (otro)", playerId: null, newKey: "n1", seasonId: cerrada.id, categoryId: s.cab5.id, divisionId: null, points: 30 },
      ],
    });
    const r = await s.client.post("/api/ranking-imports/preview", p);
    expect(r.json.ok).toBe(true);
    const warns = (r.json.issues as Json[]).map((i) => i.message).join("\n");
    expect(warns).toMatch(/distinto de su categoría principal/);
    expect(warns).toMatch(/Temporada 2024 está cerrada/);
    expect(warns).toMatch(/Ya existe un jugador llamado Juan Pérez/);
  });
});

describe("confirmación de importación", () => {
  it("registra saldos iniciales como movimientos y crea los jugadores nuevos en una transacción", async () => {
    const s = await setup();
    const r = await s.client.post("/api/ranking-imports", payload(s));
    expect(r.status).toBe(201);
    const moves = await env.DB.prepare("SELECT kind, points, reason, balance_import_id, tournament_id FROM point_movements ORDER BY id").all<Json>();
    expect(moves.results).toHaveLength(3);
    expect(moves.results.every((m) => m.kind === "ajuste" && m.reason === "Saldo inicial importado" && m.balance_import_id === r.json.id && m.tournament_id === null)).toBe(true);
    // Sin torneos ni acreditaciones inventadas.
    expect(await count("SELECT COUNT(*) AS n FROM tournaments")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM tournament_credits")).toBe(0);
    // Jugador nuevo con código, alta en el historial de categorías y sin referencia temporal.
    const nuevo = await env.DB.prepare("SELECT id, code, import_ref, search_text FROM players WHERE last_name = 'Nuevo'").first<Json>();
    expect(nuevo).toMatchObject({ import_ref: null, search_text: "lucas nuevo" });
    expect(nuevo!.code).toMatch(/^J-\d{5}$/);
    expect(await count(`SELECT COUNT(*) AS n FROM player_category_changes WHERE player_id = ${nuevo!.id} AND change_type = 'alta'`)).toBe(1);

    const rk = await rankingOf(s.client, s.season.id, s.cab4.id);
    expect(rk.rows.map((x: Json) => [x.lastName, x.points, x.initialBalance, x.adjustments, x.tournaments])).toEqual([
      ["Pérez", 320, 320, 0, 0],
      ["Gómez", 250, 250, 0, 0],
      ["Nuevo", 90, 90, 0, 0],
    ]);
    // Historial del jugador: el movimiento figura vinculado a la importación.
    const hist = (await s.client.get(`/api/players/${s.juan.id}/points`)).json;
    expect(hist.movements[0]).toMatchObject({ kind: "ajuste", balanceImportId: r.json.id, points: 320 });
    // Auditoría.
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'importar' AND entity = 'ranking'")).toBe(1);
  });

  it("impide importar dos veces el mismo archivo o el mismo contenido", async () => {
    const s = await setup();
    expect((await s.client.post("/api/ranking-imports", payload(s))).status).toBe(201);
    const again = await s.client.post("/api/ranking-imports", payload(s));
    expect(again.status).toBe(409);
    expect(again.json.error.message).toMatch(/ya fue importado/);
    // Mismo contenido con otro archivo (p. ej. el CSV del mismo Excel) y el jugador nuevo ya creado.
    const nuevo = await env.DB.prepare("SELECT id FROM players WHERE last_name = 'Nuevo'").first<{ id: number }>();
    const p = payload(s, { fileHash: HASH_B, newPlayers: [] });
    p.rows[2] = { ...p.rows[2]!, playerId: nuevo!.id, newKey: null };
    const other = await s.client.post("/api/ranking-imports", p);
    expect(other.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM point_movements")).toBe(3);
  });

  it("impide un segundo saldo al mismo jugador en el mismo ranking aunque el archivo sea otro", async () => {
    const s = await setup();
    await s.client.post("/api/ranking-imports", payload(s));
    const second = await s.client.post("/api/ranking-imports", payload(s, {
      fileHash: HASH_B, newPlayers: [],
      rows: [{ rowNumber: 2, sourceName: "Juan Perez", playerId: s.juan.id, newKey: null, seasonId: s.season.id, categoryId: s.cab4.id, divisionId: null, points: 5 }],
    }));
    expect(second.status).toBe(409);
    expect(second.json.error.message).toMatch(/ya tiene saldo inicial en el mismo ranking/);
    // Otro ranking (5ta) para el mismo jugador sí se permite.
    const other = await s.client.post("/api/ranking-imports", payload(s, {
      fileHash: HASH_B, newPlayers: [],
      rows: [{ rowNumber: 2, sourceName: "Juan Perez", playerId: s.juan.id, newKey: null, seasonId: s.season.id, categoryId: s.cab5.id, divisionId: null, points: 5 }],
    }));
    expect(other.status).toBe(201);
  });

  it("la base garantiza la unicidad aunque se saltee la validación (índice único)", async () => {
    const s = await setup();
    const r = await s.client.post("/api/ranking-imports", payload(s));
    await expect(
      env.DB.prepare("INSERT INTO initial_balances (import_id, row_number, source_name, player_id, season_id, category_id, division_key, points) VALUES (?, 99, 'x', ?, ?, ?, 0, 5)")
        .bind(r.json.id, s.juan.id, s.season.id, s.cab4.id).run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("rechaza filas con 0 puntos o decimales", async () => {
    const s = await setup();
    const p = payload(s);
    (p.rows[0] as Json).points = 0;
    expect((await s.client.post("/api/ranking-imports/preview", p)).status).toBe(400);
    (p.rows[0] as Json).points = 12.5;
    expect((await s.client.post("/api/ranking-imports/preview", p)).status).toBe(400);
  });

  it("suma el saldo a los puntos de torneos y lo informa en la vista previa", async () => {
    const s = await setup();
    await s.client.post("/api/movements/adjustments", { playerId: s.juan.id, seasonId: s.season.id, points: 15, reason: "Bonificación" });
    const pv = await s.client.post("/api/ranking-imports/preview", payload(s));
    expect(pv.json.rankings[0].existingPoints).toBe(15);
    expect((pv.json.issues as Json[]).some((i) => /ya tiene 15 puntos cargados/.test(i.message))).toBe(true);
    await s.client.post("/api/ranking-imports", payload(s));
    const rk = await rankingOf(s.client, s.season.id, s.cab4.id);
    expect(rk.rows[0]).toMatchObject({ lastName: "Pérez", points: 335, initialBalance: 320, adjustments: 15 });
  });
});

describe("reversión de importaciones", () => {
  it("anula todos los saldos con contraasientos, libera el archivo y conserva el historial", async () => {
    const s = await setup();
    const imp = (await s.client.post("/api/ranking-imports", payload(s))).json;
    const rev = await s.client.post(`/api/ranking-imports/${imp.id}/revert`, { reason: "Archivo equivocado" });
    expect(rev.status).toBe(200);
    expect(rev.json.reversed).toBe(3);
    const moves = await env.DB.prepare("SELECT kind, points FROM point_movements ORDER BY id").all<Json>();
    expect(moves.results.map((m) => m.kind)).toEqual(["ajuste", "ajuste", "ajuste", "anulacion_ajuste", "anulacion_ajuste", "anulacion_ajuste"]);
    expect(moves.results.reduce((a, m) => a + (m.points as number), 0)).toBe(0);
    const rk = await rankingOf(s.client, s.season.id, s.cab4.id);
    expect(rk.rows).toHaveLength(0);
    // Doble reversión: rechazada.
    expect((await s.client.post(`/api/ranking-imports/${imp.id}/revert`, { reason: "otra vez" })).status).toBe(409);
    // El listado refleja el estado y el detalle conserva las filas.
    const list = (await s.client.get("/api/ranking-imports")).json.items as Json[];
    expect(list[0]).toMatchObject({ status: "revertida", revertReason: "Archivo equivocado", createdPlayers: 1 });
    const detail = (await s.client.get(`/api/ranking-imports/${imp.id}`)).json;
    expect(detail.rows).toHaveLength(3);
    expect(detail.rows.every((r: Json) => r.active === false)).toBe(true);
    // Con la anterior revertida, el mismo archivo se puede volver a importar (sin recrear al jugador nuevo).
    const nuevo = await env.DB.prepare("SELECT id FROM players WHERE last_name = 'Nuevo'").first<{ id: number }>();
    const p = payload(s, { newPlayers: [] });
    p.rows[2] = { ...p.rows[2]!, playerId: nuevo!.id, newKey: null };
    expect((await s.client.post("/api/ranking-imports", p)).status).toBe(201);
    expect((await rankingOf(s.client, s.season.id, s.cab4.id)).rows).toHaveLength(3);
  });

  it("no permite anular un saldo importado suelto desde el libro de movimientos", async () => {
    const s = await setup();
    await s.client.post("/api/ranking-imports", payload(s));
    const m = await env.DB.prepare("SELECT id FROM point_movements LIMIT 1").first<{ id: number }>();
    const r = await s.client.post(`/api/movements/${m!.id}/annul`, { reason: "probar" });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/saldo inicial importado/);
  });

  it("exige sesión", async () => {
    const anon = new Client();
    expect((await anon.get("/api/ranking-imports")).status).toBe(401);
    expect((await anon.post("/api/ranking-imports/preview", {})).status).toBe(401);
  });
});

describe("importación grande (Fase 5B)", () => {
  it("acepta un ranking histórico completo de 1500 filas con jugadores nuevos en una sola importación", async () => {
    const s = await setup();
    const newPlayers = Array.from({ length: 1500 }, (_, i) => ({ key: `n${i}`, firstName: `Nombre${i}`, lastName: `Apellido Largo ${i}`, gender: "M", mainCategoryId: s.cab4.id }));
    const rows = newPlayers.map((p, i) => ({
      rowNumber: i + 2, sourceName: `${p.lastName.toUpperCase()}, ${p.firstName.toUpperCase()}`, sourcePosition: String(i + 1),
      playerId: null, newKey: p.key, seasonId: s.season.id, categoryId: s.cab4.id, divisionId: null, points: 3000 - i,
    }));
    const body = payload(s, { newPlayers, rows });
    expect(JSON.stringify(body).length).toBeGreaterThan(64 * 1024);
    const preview = await s.client.post("/api/ranking-imports/preview", body);
    expect(preview.status).toBe(200);
    const res = await s.client.post("/api/ranking-imports", body);
    expect(res.status).toBe(201);
    const r = await rankingOf(s.client, s.season.id, s.cab4.id);
    expect(r.rows).toHaveLength(1500);
    expect(r.rows[0].points).toBe(3000);
  });
});
