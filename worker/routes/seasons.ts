import { Hono } from "hono";
import { seasonSchema, seasonStatusSchema } from "@shared/schemas";
import { SEASON_STATUS_LABEL, type SeasonStatus } from "@shared/constants";
import type { Season } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";

interface Row {
  id: number;
  name: string;
  year: number;
  start_date: string;
  end_date: string;
  status: SeasonStatus;
  notes: string | null;
  tournament_count: number;
  finished_count: number;
}

export const SEASON_SELECT = `
  SELECT s.id, s.name, s.year, s.start_date, s.end_date, s.status, s.notes,
         (SELECT COUNT(*) FROM tournaments t WHERE t.season_id = s.id AND t.status <> 'cancelado') AS tournament_count,
         (SELECT COUNT(*) FROM tournaments t WHERE t.season_id = s.id AND t.status = 'finalizado') AS finished_count
    FROM seasons s`;

export const mapSeason = (r: Row): Season => ({
  id: r.id,
  name: r.name,
  year: r.year,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  notes: r.notes,
  tournamentCount: r.tournament_count,
  finishedCount: r.finished_count,
});

async function getSeason(db: D1Database, id: number): Promise<Season> {
  const row = await db.prepare(`${SEASON_SELECT} WHERE s.id = ?`).bind(id).first<Row>();
  if (!row) throw notFound("La temporada");
  return mapSeason(row);
}

export const seasonRoutes = new Hono<AppEnv>();

seasonRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `${SEASON_SELECT} ORDER BY CASE s.status WHEN 'activa' THEN 0 WHEN 'planificada' THEN 1 ELSE 2 END, s.year DESC, s.start_date DESC`,
  ).all<Row>();
  return c.json({ items: results.map(mapSeason) });
});

seasonRoutes.get("/:id", async (c) => {
  return c.json({ item: await getSeason(c.env.DB, parseId(c.req.param("id"), "La temporada")) });
});

seasonRoutes.post("/", async (c) => {
  const input = await parseBody(c, seasonSchema);
  const db = c.env.DB;
  const [res] = await db.batch<{ id: number }>([
    db
      .prepare("INSERT INTO seasons (name, year, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(input.name, input.year, input.startDate, input.endDate, input.notes),
    db
      .prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'crear', 'temporada', last_insert_rowid(), ?)")
      .bind(c.get("user").id, `Creó la temporada ${input.name}`),
  ]);
  return c.json({ item: await getSeason(db, res!.results[0]!.id) }, 201);
});

seasonRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La temporada");
  const input = await parseBody(c, seasonSchema);
  const db = c.env.DB;
  const season = await getSeason(db, id);
  if (season.status === "cerrada") throw conflict("La temporada está cerrada. Reabrila para modificarla.");
  const outside = await db
    .prepare("SELECT COUNT(*) AS n FROM tournaments WHERE season_id = ? AND (start_date < ? OR end_date > ?)")
    .bind(id, input.startDate, input.endDate)
    .first<{ n: number }>();
  if ((outside?.n ?? 0) > 0) {
    throw badRequest("Hay torneos de esta temporada fuera del nuevo rango de fechas", { startDate: "Deja torneos afuera" });
  }
  await db.batch([
    db
      .prepare("UPDATE seasons SET name = ?, year = ?, start_date = ?, end_date = ?, notes = ?, updated_at = ? WHERE id = ?")
      .bind(input.name, input.year, input.startDate, input.endDate, input.notes, new Date().toISOString(), id),
    auditStmt(db, c.get("user").id, "editar", "temporada", id, `Editó la temporada ${input.name}`),
  ]);
  return c.json({ item: await getSeason(db, id) });
});

seasonRoutes.patch("/:id/status", async (c) => {
  const id = parseId(c.req.param("id"), "La temporada");
  const { status } = await parseBody(c, seasonStatusSchema);
  const db = c.env.DB;
  const season = await getSeason(db, id);
  if (season.status === status) return c.json({ item: season });
  // Reabrir una temporada cerrada habilita a modificar su historial: sólo un administrador.
  if (season.status === "cerrada" && c.get("user").role !== "admin") {
    throw new HttpError(403, "sin_permiso", "Sólo un administrador puede reabrir una temporada cerrada.");
  }
  if (status === "cerrada") {
    const open = await db
      .prepare("SELECT COUNT(*) AS n FROM tournaments WHERE season_id = ? AND status IN ('programado', 'en_curso')")
      .bind(id)
      .first<{ n: number }>();
    if ((open?.n ?? 0) > 0) {
      throw conflict(`No se puede cerrar: hay ${open!.n} torneo(s) programados o en curso. Finalizalos o cancelalos primero.`);
    }
  }
  if (status === "activa") {
    const other = await db.prepare("SELECT name FROM seasons WHERE status = 'activa' AND id <> ?").bind(id).first<{ name: string }>();
    if (other) throw conflict(`Ya está activa la temporada ${other.name}. Cerrala o pasala a planificada primero.`);
  }
  await db.batch([
    db.prepare("UPDATE seasons SET status = ?, updated_at = ? WHERE id = ?").bind(status, new Date().toISOString(), id),
    auditStmt(db, c.get("user").id, "estado", "temporada", id, `Temporada ${season.name}: ${SEASON_STATUS_LABEL[status]}`),
  ]);
  return c.json({ item: await getSeason(db, id) });
});

seasonRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La temporada");
  const db = c.env.DB;
  const season = await getSeason(db, id);
  const used = await db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE season_id = ?").bind(id).first<{ n: number }>();
  if ((used?.n ?? 0) > 0) throw conflict("La temporada tiene torneos cargados y no puede eliminarse");
  // Saldos importados o ajustes manuales también son historial: nunca se borran.
  const history = await db
    .prepare("SELECT (SELECT COUNT(*) FROM point_movements WHERE season_id = ?1) + (SELECT COUNT(*) FROM initial_balances WHERE season_id = ?1) AS n")
    .bind(id)
    .first<{ n: number }>();
  if ((history?.n ?? 0) > 0) throw conflict("La temporada tiene puntos registrados (saldos importados o ajustes) y no puede eliminarse.");
  await db.batch([
    db.prepare("UPDATE player_category_changes SET season_id = NULL WHERE season_id = ?").bind(id),
    db.prepare("DELETE FROM seasons WHERE id = ?").bind(id),
    auditStmt(db, c.get("user").id, "eliminar", "temporada", id, `Eliminó la temporada ${season.name}`),
  ]);
  return c.json({ ok: true });
});
