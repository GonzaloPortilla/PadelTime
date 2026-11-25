/**
 * Migración 0008 sobre datos anteriores: los torneos de una sola categoría (con parejas, puntos acreditados
 * y fixture) quedan como un torneo general con una competencia, sin perder ni duplicar nada.
 */
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

describe("migración 0008: torneos con varias categorías", () => {
  it("convierte cada torneo anterior en un torneo con una competencia y conserva todo", async () => {
    const db = env.RESTORE_DB;
    const all = env.TEST_MIGRATIONS;
    const idx = all.findIndex((m) => m.name.startsWith("0008"));
    expect(idx).toBeGreaterThan(0);
    await applyD1Migrations(db, all.slice(0, idx));

    // Datos "de antes": dos torneos sueltos (uno acreditado) y un evento de la Fase 9 con dos categorías.
    await db.batch([
      db.prepare("INSERT INTO users (id, username, display_name, password_hash, role) VALUES (1, 'admin', 'Admin', 'x', 'admin')"),
      db.prepare("INSERT INTO categories (id, name, gender, level) VALUES (1, 'C5', 'M', 5), (2, 'C6', 'M', 6)"),
      db.prepare("INSERT INTO seasons (id, name, year, start_date, end_date, status) VALUES (1, 'T2026', 2026, '2026-01-01', '2026-12-31', 'activa')"),
      db.prepare("INSERT INTO players (id, first_name, last_name, gender, main_category_id) VALUES (1, 'Ana', 'Uno', 'M', 1), (2, 'Beto', 'Dos', 'M', 1)"),
      db.prepare(`INSERT INTO tournaments (id, season_id, name, type, category_id, start_date, end_date, status, public_visible, featured, public_description, series)
                  VALUES (10, 1, 'Apertura', 'largo', 1, '2026-03-01', '2026-04-01', 'finalizado', 1, 1, 'Info del Apertura', 'open_1000'),
                         (11, 1, 'Satélite Marzo', 'americano', 2, '2026-03-15', '2026-03-15', 'programado', 0, 0, NULL, 'satelite_100')`),
      db.prepare("INSERT INTO tournament_teams (id, tournament_id) VALUES (100, 10)"),
      db.prepare("INSERT INTO tournament_team_players (team_id, tournament_id, player_id, ranking_category_id) VALUES (100, 10, 1, 1), (100, 10, 2, 1)"),
      db.prepare("INSERT INTO tournament_credits (id, tournament_id, season_id, version, preview_hash, total_points) VALUES (1, 10, 1, 1, 'h', 200)"),
      db.prepare(`INSERT INTO point_movements (season_id, player_id, category_id, kind, points, tournament_id, credit_id)
                  VALUES (1, 1, 1, 'acreditacion', 100, 10, 1), (1, 2, 1, 'acreditacion', 100, 10, 1)`),
      db.prepare("INSERT INTO tournament_events (id, season_id, name, start_date, end_date) VALUES (5, 1, 'Qatar Major', '2026-06-01', '2026-07-31')"),
      db.prepare(`INSERT INTO tournaments (id, season_id, name, type, category_id, start_date, end_date, event_id, public_visible, prize_info)
                  VALUES (12, 1, 'Qatar Major', 'largo', 1, '2026-06-01', '2026-07-31', 5, 1, 'Premios Qatar'),
                         (13, 1, 'Qatar Major', 'largo', 2, '2026-06-01', '2026-07-31', 5, 0, 'Premios Qatar')`),
      db.prepare("INSERT INTO tournament_fixtures (tournament_id, config) VALUES (12, '{}')"),
    ]);
    const before = await db.prepare("SELECT (SELECT COUNT(*) FROM point_movements) AS m, (SELECT COUNT(*) FROM tournament_credits) AS c, (SELECT COUNT(*) FROM tournaments) AS t, (SELECT COUNT(*) FROM tournament_teams) AS tt").first();

    await applyD1Migrations(db, all.slice(idx, idx + 1));

    // Ningún dato deportivo cambia; los ids de competencia se conservan.
    const after = await db.prepare("SELECT (SELECT COUNT(*) FROM point_movements) AS m, (SELECT COUNT(*) FROM tournament_credits) AS c, (SELECT COUNT(*) FROM tournaments) AS t, (SELECT COUNT(*) FROM tournament_teams) AS tt").first();
    expect(after).toEqual(before);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE event_id IS NULL").first("n")).toBe(0);

    // Cada torneo suelto quedó con su torneo general y sus datos públicos.
    const ev10 = await db.prepare("SELECT e.* FROM tournament_events e JOIN tournaments t ON t.event_id = e.id WHERE t.id = 10").first<Record<string, unknown>>();
    expect(ev10).toMatchObject({ name: "Apertura", type: "largo", series: "open_1000", start_date: "2026-03-01", end_date: "2026-04-01", public_visible: 1, featured: 1, public_description: "Info del Apertura", source_tournament_id: 10 });
    const ev11 = await db.prepare("SELECT e.* FROM tournament_events e JOIN tournaments t ON t.event_id = e.id WHERE t.id = 11").first<Record<string, unknown>>();
    expect(ev11).toMatchObject({ name: "Satélite Marzo", type: "americano", public_visible: 0 });
    // El evento de la Fase 9 toma los datos públicos de sus categorías y sigue con sus dos competencias.
    expect(await db.prepare("SELECT public_visible, prize_info, type FROM tournament_events WHERE id = 5").first()).toEqual({ public_visible: 1, prize_info: "Premios Qatar", type: "largo" });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE event_id = 5").first("n")).toBe(2);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM tournament_events").first("n")).toBe(3);

    // Una categoría no puede repetirse dentro de un torneo.
    await expect(db.prepare("INSERT INTO tournaments (season_id, name, type, category_id, start_date, end_date, event_id) VALUES (1, 'X', 'largo', 1, '2026-06-01', '2026-06-02', 5)").run()).rejects.toThrow(/UNIQUE/);
  });
});

describe("base sin migrar", () => {
  it("detecta tablas o columnas faltantes para avisar que hay que aplicar migraciones", async () => {
    const { isSchemaOutdated, SCHEMA_OUTDATED_MESSAGE } = await import("../worker/lib/errors");
    expect(isSchemaOutdated(new Error("D1_ERROR: no such table: tournament_events: SQLITE_ERROR"))).toBe(true);
    expect(isSchemaOutdated(new Error("D1_ERROR: no such column: t.event_id"))).toBe(true);
    expect(isSchemaOutdated(new Error("UNIQUE constraint failed"))).toBe(false);
    expect(SCHEMA_OUTDATED_MESSAGE).toContain("npm run db:migrate:local");
  });
});
