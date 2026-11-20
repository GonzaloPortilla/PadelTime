import { Hono } from "hono";
import { adjustmentSchema, annulSchema, movementsQuerySchema } from "@shared/schemas";
import type { CreditStatus, MovementKind, SeasonStatus } from "@shared/constants";
import type { Paginated, PlayerPointsResponse, PlayerPointsSummary, PointMovement } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId, parseQuery } from "../lib/validate";
import { auditStmt } from "../lib/audit";

interface MovementRow {
  id: number; kind: MovementKind; points: number; stage_points: number; bonus_points: number;
  season_id: number; season_name: string; category_id: number; category_name: string; division_name: string | null;
  player_id: number; player_name: string; player_code: string;
  tournament_id: number | null; tournament_name: string | null; tournament_date: string | null;
  credit_version: number | null; credit_status: CreditStatus | null; partner_name: string | null; stage_label: string | null;
  reason: string | null; reverses_movement_id: number | null; reversed_by_id: number | null; balance_import_id: number | null; created_at: string; created_by_name: string | null;
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.kind, m.points, m.stage_points, m.bonus_points, m.season_id, s.name AS season_name,
         m.category_id, c.name AS category_name, d.name AS division_name,
         m.player_id, p.first_name || ' ' || p.last_name AS player_name, p.code AS player_code,
         m.tournament_id, t.name AS tournament_name, t.start_date AS tournament_date,
         cr.version AS credit_version, cr.status AS credit_status, m.partner_name, m.stage_label, m.reason,
         m.reverses_movement_id, rv.id AS reversed_by_id, m.balance_import_id, m.created_at, u.display_name AS created_by_name
    FROM point_movements m
    JOIN seasons s ON s.id = m.season_id
    JOIN categories c ON c.id = m.category_id
    JOIN players p ON p.id = m.player_id
    LEFT JOIN divisions d ON d.id = m.division_id
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    LEFT JOIN tournament_credits cr ON cr.id = m.credit_id
    LEFT JOIN point_movements rv ON rv.reverses_movement_id = m.id
    LEFT JOIN users u ON u.id = m.created_by`;

const mapMovement = (r: MovementRow): PointMovement => ({
  id: r.id, kind: r.kind, points: r.points, stagePoints: r.stage_points, bonusPoints: r.bonus_points,
  seasonId: r.season_id, seasonName: r.season_name, categoryId: r.category_id, categoryName: r.category_name, divisionName: r.division_name,
  playerId: r.player_id, playerName: r.player_name, playerCode: r.player_code,
  tournamentId: r.tournament_id, tournamentName: r.tournament_name, tournamentDate: r.tournament_date,
  creditVersion: r.credit_version, creditStatus: r.credit_status, partnerName: r.partner_name, stageLabel: r.stage_label,
  reason: r.reason, reversesMovementId: r.reverses_movement_id, reversedById: r.reversed_by_id, balanceImportId: r.balance_import_id,
  createdAt: r.created_at, createdByName: r.created_by_name,
});

export const movementRoutes = new Hono<AppEnv>();

/** Libro de movimientos (auditoría), con filtros. */
movementRoutes.get("/", async (c) => {
  const q = parseQuery(c, movementsQuerySchema);
  const conditions: string[] = [];
  const binds: unknown[] = [];
  const add = (sql: string, v: unknown) => { conditions.push(sql); binds.push(v); };
  if (q.seasonId) add("m.season_id = ?", q.seasonId);
  if (q.playerId) add("m.player_id = ?", q.playerId);
  if (q.tournamentId) add("m.tournament_id = ?", q.tournamentId);
  if (q.kind) add("m.kind = ?", q.kind);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const db = c.env.DB;
  const [rows, count] = await db.batch([
    db.prepare(`${MOVEMENT_SELECT} ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`).bind(...binds, q.pageSize, (q.page - 1) * q.pageSize),
    db.prepare(`SELECT COUNT(*) AS n FROM point_movements m ${where}`).bind(...binds),
  ]);
  const body: Paginated<PointMovement> = {
    items: (rows!.results as MovementRow[]).map(mapMovement),
    total: (count!.results[0] as { n: number }).n,
    page: q.page,
    pageSize: q.pageSize,
  };
  return c.json(body);
});

/** Ajuste manual de puntos (bonificación o sanción), siempre con motivo. */
movementRoutes.post("/adjustments", async (c) => {
  const input = await parseBody(c, adjustmentSchema);
  const db = c.env.DB;
  const [player, season] = await Promise.all([
    db.prepare("SELECT id, first_name, last_name, main_category_id FROM players WHERE id = ?").bind(input.playerId)
      .first<{ id: number; first_name: string; last_name: string; main_category_id: number }>(),
    db.prepare("SELECT id, name, status FROM seasons WHERE id = ?").bind(input.seasonId).first<{ id: number; name: string; status: SeasonStatus }>(),
  ]);
  if (!player) throw badRequest("El jugador no existe", { playerId: "Jugador inexistente" });
  if (!season) throw badRequest("La temporada no existe", { seasonId: "Temporada inexistente" });
  if (season.status === "cerrada") throw conflict("La temporada está cerrada: no admite ajustes.");
  const userId = c.get("user").id;
  await db.batch([
    db
      .prepare("INSERT INTO point_movements (season_id, player_id, category_id, kind, points, reason, created_by) VALUES (?, ?, ?, 'ajuste', ?, ?, ?)")
      .bind(season.id, player.id, player.main_category_id, input.points, input.reason, userId),
    auditStmt(db, userId, "ajustar", "jugador", player.id,
      `Ajuste de ${input.points > 0 ? "+" : ""}${input.points} pts a ${player.first_name} ${player.last_name} (${season.name}). Motivo: ${input.reason}`),
  ]);
  return c.json({ ok: true }, 201);
});

/** Anula un ajuste manual con un contraasiento (el ajuste original se conserva). */
movementRoutes.post("/:id/annul", async (c) => {
  const id = parseId(c.req.param("id"), "El movimiento");
  const { reason } = await parseBody(c, annulSchema);
  const db = c.env.DB;
  const m = await db
    .prepare(
      `SELECT m.id, m.kind, m.points, m.season_id, m.player_id, m.category_id, m.balance_import_id, s.status AS season_status,
              (SELECT id FROM point_movements r WHERE r.reverses_movement_id = m.id) AS reversed_by
         FROM point_movements m JOIN seasons s ON s.id = m.season_id WHERE m.id = ?`,
    )
    .bind(id)
    .first<{ id: number; kind: MovementKind; points: number; season_id: number; player_id: number; category_id: number; season_status: SeasonStatus; reversed_by: number | null; balance_import_id: number | null }>();
  if (!m) throw notFound("El movimiento");
  if (m.kind !== "ajuste") {
    throw badRequest("Sólo se pueden anular ajustes manuales. Los puntos de torneos se corrigen o revierten desde el torneo.");
  }
  if (m.balance_import_id !== null) {
    throw conflict("Es un saldo inicial importado: se revierte desde Importar rankings (la importación completa). Para corregir a un solo jugador, cargá un ajuste manual.");
  }
  if (m.reversed_by) throw conflict("Ese ajuste ya fue anulado.");
  if (m.season_status === "cerrada") throw conflict("La temporada está cerrada.");
  const userId = c.get("user").id;
  await db.batch([
    db
      .prepare(
        `INSERT INTO point_movements (season_id, player_id, category_id, kind, points, reverses_movement_id, reason, created_by)
         VALUES (?, ?, ?, 'anulacion_ajuste', ?, ?, ?, ?)`,
      )
      .bind(m.season_id, m.player_id, m.category_id, -m.points, m.id, reason, userId),
    auditStmt(db, userId, "anular", "jugador", m.player_id, `Anuló un ajuste de ${m.points} pts. Motivo: ${reason}`),
  ]);
  return c.json({ ok: true });
});

export const playerPointsRoutes = new Hono<AppEnv>();

/** Historial de puntos de un jugador: totales por temporada/categoría y todos sus movimientos. */
playerPointsRoutes.get("/:id/points", async (c) => {
  const id = parseId(c.req.param("id"), "El jugador");
  const db = c.env.DB;
  const exists = await db.prepare("SELECT id FROM players WHERE id = ?").bind(id).first();
  if (!exists) throw notFound("El jugador");
  const [summary, movements] = await db.batch([
    db
      .prepare(
        `SELECT m.season_id, s.name AS season_name, s.status AS season_status, m.category_id, c.name AS category_name, SUM(m.points) AS points
           FROM point_movements m JOIN seasons s ON s.id = m.season_id JOIN categories c ON c.id = m.category_id
          WHERE m.player_id = ? GROUP BY m.season_id, m.category_id ORDER BY s.year DESC, s.start_date DESC, c.level`,
      )
      .bind(id),
    db.prepare(`${MOVEMENT_SELECT} WHERE m.player_id = ? ORDER BY m.id DESC LIMIT 500`).bind(id),
  ]);
  const body: PlayerPointsResponse = {
    summary: (summary!.results as { season_id: number; season_name: string; season_status: SeasonStatus; category_id: number; category_name: string; points: number }[]).map(
      (r): PlayerPointsSummary => ({
        seasonId: r.season_id, seasonName: r.season_name, seasonStatus: r.season_status, categoryId: r.category_id, categoryName: r.category_name, points: r.points,
      }),
    ),
    movements: (movements!.results as MovementRow[]).map(mapMovement),
  };
  return c.json(body);
});
