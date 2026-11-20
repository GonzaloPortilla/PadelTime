/**
 * Fase 5B · Respaldo y recuperación: el respaldo descargable se restaura completo en una base nueva.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { BACKUP_TABLES, dumpHeader, dumpPage, sqlLiteral } from "@shared/backup";
import { cleanupExpired } from "../worker/lib/maintenance";
import { Client, createUser, loggedInAdmin, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Mismo algoritmo que la pantalla Respaldo (src/pages/BackupPage.tsx), contra la API real. */
async function downloadBackup(client: Client) {
  const start = await client.post("/api/backup/start");
  expect(start.status).toBe(200);
  const counts = Object.fromEntries((start.json.tables as Json[]).map((t) => [t.table, t.count]));
  const parts = [dumpHeader({ generatedAt: start.json.generatedAt, counts })];
  let requests = 0;
  for (const { table } of start.json.tables as Json[]) {
    let after = 0;
    for (;;) {
      const page = await client.get(`/api/backup/${table}?after=${after}`);
      expect(page.status).toBe(200);
      requests++;
      parts.push(dumpPage(page.json));
      if (page.json.next === null) break;
      after = page.json.next;
    }
  }
  return { sql: parts.join(""), counts, requests };
}

async function realisticData() {
  const { client, user } = await loggedInAdmin();
  const base = await seedBasics(client);
  await client.patch(`/api/seasons/${base.season.id}/status`, { status: "activa" });
  const players: Json[] = [];
  for (let i = 0; i < 6; i++) {
    players.push((await client.post("/api/players", {
      firstName: `Nombre ${i}`, lastName: `O'Connor ${i}`, gender: "M", mainCategoryId: base.cab4.id, notes: "Línea 1\nLínea 2; con 'comillas'",
    })).json.item);
  }
  const t = (await client.post("/api/tournaments", {
    seasonId: base.season.id, name: "Apertura", type: "largo", categoryId: base.cab4.id, divisionId: null, startDate: "2026-03-01", endDate: "2026-03-02",
  })).json.item;
  await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
  const teams = [];
  for (let i = 0; i < 6; i += 2) teams.push((await client.post(`/api/tournaments/${t.id}/teams`, { player1Id: players[i]!.id, player2Id: players[i + 1]!.id })).json.items);
  const allTeams = (await client.get(`/api/tournaments/${t.id}/teams`)).json.items as Json[];
  const sc = (await client.get(`/api/tournaments/${t.id}/scoring`)).json.item;
  await client.put(`/api/tournaments/${t.id}/results`, {
    results: allTeams.map((tm, i) => ({ teamId: tm.id, stageId: sc.stages[i].id, matchesPlayed: 2, matchesWon: 1 })),
  });
  let preview = (await client.get(`/api/tournaments/${t.id}/preview`)).json;
  await client.post(`/api/tournaments/${t.id}/credits`, { previewHash: preview.previewHash });
  // Una corrección para tener contraasientos (autorreferencias en point_movements).
  await client.put(`/api/tournaments/${t.id}/results`, { results: [{ teamId: allTeams[2]!.id, stageId: sc.stages[3].id, matchesPlayed: 2, matchesWon: 1 }] });
  preview = (await client.get(`/api/tournaments/${t.id}/preview`)).json;
  await client.post(`/api/tournaments/${t.id}/credits`, { previewHash: preview.previewHash, reason: "Corrección" });
  await client.post("/api/movements/adjustments", { playerId: players[0]!.id, seasonId: base.season.id, points: -5, reason: "Sanción" });
  return { client, user, base, players, t };
}

async function tableRows(db: D1Database, table: string) {
  return (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
}

describe("respaldo", () => {
  it("sólo un administrador puede descargarlo y sólo de tablas permitidas", async () => {
    await createUser("orga", "clave-segura-456", "organizador");
    const org = new Client();
    await org.login("orga", "clave-segura-456");
    expect((await org.post("/api/backup/start")).status).toBe(403);
    expect((await org.get("/api/backup/users")).status).toBe(403);
    const { client } = await loggedInAdmin();
    expect((await client.get("/api/backup/sessions")).status).toBe(400);
    expect((await client.get("/api/backup/sqlite_master")).status).toBe(400);
    expect((await client.get("/api/backup/users?after=-1")).status).toBe(400);
    expect((await new Client().get("/api/backup/users")).status).toBe(401);
  });

  it("se restaura completo en una base nueva: todas las tablas quedan idénticas y los rankings coinciden", async () => {
    const { client, base } = await realisticData();
    const { sql, counts } = await downloadBackup(client);
    expect(sql).toContain("CONFIDENCIAL");
    expect(counts.point_movements).toBeGreaterThan(6);

    // Base nueva con migraciones (como haría `wrangler d1 migrations apply` sobre una base recién creada).
    const target = env.RESTORE_DB;
    await applyD1Migrations(target, env.TEST_MIGRATIONS);
    // Igual que `wrangler d1 execute --file`: una sentencia por línea, sin transacción explícita.
    const statements = sql.split("\n").filter((l) => l && !l.startsWith("--"));
    for (let i = 0; i < statements.length; i += 50) {
      await target.batch(statements.slice(i, i + 50).map((s) => target.prepare(s)));
    }

    for (const table of BACKUP_TABLES) {
      const [a, b] = await Promise.all([tableRows(env.DB, table), tableRows(target, table)]);
      if (table === "app_settings") {
        // public_version puede diferir (los triggers la incrementan durante la restauración): sólo importa que exista.
        const strip = (rows: Json[]) => rows.map((r) => (r.key === "public_version" ? { key: r.key } : r));
        expect(strip(b)).toEqual(strip(a));
        continue;
      }
      expect(b, table).toEqual(a);
    }
    // El ranking calculado en la base restaurada es el mismo.
    const q = `SELECT player_id, SUM(points) AS p FROM point_movements WHERE season_id = ${base.season.id} GROUP BY player_id ORDER BY player_id`;
    expect((await target.prepare(q).all()).results).toEqual((await env.DB.prepare(q).all()).results);
    // Los movimientos siguen siendo inmutables en la base restaurada.
    await expect(target.prepare("DELETE FROM point_movements").run()).rejects.toThrow(/inmutables/);
  });

  it("pagina tablas grandes sin perder ni repetir filas", async () => {
    const { client, user } = await loggedInAdmin();
    const stmt = env.DB.prepare("INSERT INTO audit_log (user_id, action, entity, summary) VALUES (?, 'x', 'y', ?)");
    const rows = Array.from({ length: 2350 }, (_, i) => stmt.bind(user.id, `fila ${i}`));
    for (let i = 0; i < rows.length; i += 500) await env.DB.batch(rows.slice(i, i + 500));
    const { sql, requests } = await downloadBackup(client);
    const inserted = sql.split("\n").filter((l) => l.startsWith('INSERT INTO "audit_log"'));
    const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())!.n;
    expect(inserted).toHaveLength(total);
    expect(new Set(inserted).size).toBe(total);
    expect(requests).toBeGreaterThan(BACKUP_TABLES.length); // hubo más de una página
  });

  it("escapa correctamente texto con comillas, saltos de línea y valores nulos", () => {
    expect(sqlLiteral("O'Connor")).toBe("'O''Connor'");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(12)).toBe("12");
    expect(sqlLiteral("a\nb")).toBe("'a' || char(10) || 'b'");
    expect(dumpPage({ table: "players", columns: ["notes"], rows: [["x\r\ny"]] }).trim().split("\n")).toHaveLength(1);
  });
});

describe("mantenimiento diario", () => {
  it("borra sólo sesiones vencidas e intentos viejos, sin tocar datos", async () => {
    const { client, user } = await loggedInAdmin();
    await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES ('vieja', ?, '2020-01-01T00:00:00.000Z')").bind(user.id).run();
    await env.DB.prepare("INSERT INTO login_attempts (key, failures, window_start) VALUES ('ip:1', 2, '2020-01-01T00:00:00.000Z')").run();
    await env.DB.prepare("INSERT INTO login_attempts (key, failures, window_start) VALUES ('ip:2', 2, ?)").bind(new Date().toISOString()).run();
    const r = await cleanupExpired(env.DB);
    expect(r).toEqual({ sessions: 1, attempts: 1 });
    expect((await client.get("/api/auth/me")).json.user.id).toBe(user.id); // la sesión vigente sigue
  });
});
