import { Hono } from "hono";
import { tournamentListQuerySchema, tournamentSchema, tournamentStatusSchema } from "@shared/schemas";
import {
  TOURNAMENT_STATUS_LABEL,
  TOURNAMENT_TRANSITIONS,
  type Gender,
  type SeasonStatus,
  type TournamentStatus,
  type TournamentType,
} from "@shared/constants";
import { searchTerms, normalizeText } from "@shared/text";
import type { Tournament } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId, parseQuery } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import type { z } from "zod";

interface Row {
  id: number;
  season_id: number;
  season_name: string;
  season_status: SeasonStatus;
  name: string;
  type: TournamentType;
  category_id: number;
  category_name: string;
  gender: Gender;
  division_id: number | null;
  division_name: string | null;
  start_date: string;
  end_date: string;
  status: TournamentStatus;
  venue: string | null;
  notes: string | null;
  team_count: number;
  credited_version: number | null;
  public_visible: number;
  featured: number;
  registration_open: number;
  series: Tournament["series"];
  public_description: string | null;
  prize_info: string | null;
  event_id: number | null;
  event_name: string | null;
}

export const TOURNAMENT_SELECT = `
  SELECT t.id, t.season_id, s.name AS season_name, s.status AS season_status, t.name, t.type, t.category_id,
         c.name AS category_name, c.gender, t.division_id, d.name AS division_name, t.start_date, t.end_date,
         t.status, t.venue, t.notes, t.public_visible, t.featured, t.registration_open, t.series, t.public_description, t.prize_info,
         t.event_id, (SELECT e.name FROM tournament_events e WHERE e.id = t.event_id) AS event_name,
         (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS team_count,
         (SELECT cr.version FROM tournament_credits cr WHERE cr.tournament_id = t.id AND cr.status = 'vigente') AS credited_version
    FROM tournaments t
    JOIN seasons s ON s.id = t.season_id
    JOIN categories c ON c.id = t.category_id
    LEFT JOIN divisions d ON d.id = t.division_id`;

export const mapTournament = (r: Row): Tournament => ({
  id: r.id,
  seasonId: r.season_id,
  seasonName: r.season_name,
  seasonStatus: r.season_status,
  name: r.name,
  type: r.type,
  categoryId: r.category_id,
  categoryName: r.category_name,
  gender: r.gender,
  divisionId: r.division_id,
  divisionName: r.division_name,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  venue: r.venue,
  notes: r.notes,
  teamCount: r.team_count,
  creditedVersion: r.credited_version,
  publicVisible: r.public_visible === 1,
  featured: r.featured === 1,
  registrationOpen: r.registration_open === 1,
  series: r.series,
  publicDescription: r.public_description,
  prizeInfo: r.prize_info,
  eventId: r.event_id,
  eventName: r.event_name,
});

async function getTournament(db: D1Database, id: number): Promise<Tournament> {
  const row = await db.prepare(`${TOURNAMENT_SELECT} WHERE t.id = ?`).bind(id).first<Row>();
  if (!row) throw notFound("El torneo");
  return mapTournament(row);
}

type TournamentData = z.output<typeof tournamentSchema>;

/** Reglas de negocio que dependen de otros registros. */
async function validateRelations(db: D1Database, t: TournamentData, current?: Tournament) {
  const [season, category, division] = await Promise.all([
    db.prepare("SELECT status, start_date, end_date FROM seasons WHERE id = ?").bind(t.seasonId)
      .first<{ status: SeasonStatus; start_date: string; end_date: string }>(),
    db.prepare("SELECT active FROM categories WHERE id = ?").bind(t.categoryId).first<{ active: number }>(),
    t.divisionId
      ? db.prepare("SELECT category_id, active FROM divisions WHERE id = ?").bind(t.divisionId).first<{ category_id: number; active: number }>()
      : Promise.resolve(null),
  ]);
  if (!season) throw badRequest("La temporada no existe", { seasonId: "Temporada inexistente" });
  if (season.status === "cerrada") throw badRequest("La temporada está cerrada", { seasonId: "Temporada cerrada" });
  if (t.startDate < season.start_date || t.endDate > season.end_date) {
    throw badRequest(`Las fechas deben estar dentro de la temporada (${season.start_date} a ${season.end_date})`, {
      startDate: "Fuera de la temporada",
    });
  }
  if (!category) throw badRequest("La categoría no existe", { categoryId: "Categoría inexistente" });
  if (t.eventId) {
    const ev = await db.prepare("SELECT season_id FROM tournament_events WHERE id = ?").bind(t.eventId).first<{ season_id: number }>();
    if (!ev) throw badRequest("El evento no existe", { eventId: "Evento inexistente" });
    if (ev.season_id !== t.seasonId) throw badRequest("El evento es de otra temporada", { eventId: "Otra temporada" });
  }
  const categoryChanged = !current || current.categoryId !== t.categoryId;
  if (categoryChanged && category.active !== 1) throw badRequest("La categoría está inactiva", { categoryId: "Categoría inactiva" });
  if (current && categoryChanged && current.teamCount > 0) {
    throw conflict("No se puede cambiar la categoría de un torneo con parejas inscriptas");
  }
  if (t.divisionId) {
    if (!division || division.category_id !== t.categoryId) {
      throw badRequest("La división no pertenece a la categoría elegida", { divisionId: "División inválida" });
    }
    if ((!current || current.divisionId !== t.divisionId) && division.active !== 1) {
      throw badRequest("La división está inactiva", { divisionId: "División inactiva" });
    }
  }
}

export const tournamentRoutes = new Hono<AppEnv>();

tournamentRoutes.get("/", async (c) => {
  const q = parseQuery(c, tournamentListQuerySchema);
  const conditions: string[] = [];
  const binds: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    conditions.push(sql);
    binds.push(value);
  };
  if (q.seasonId) add("t.season_id = ?", q.seasonId);
  if (q.categoryId) add("t.category_id = ?", q.categoryId);
  if (q.gender) add("c.gender = ?", q.gender);
  if (q.type) add("t.type = ?", q.type);
  if (q.status) add("t.status = ?", q.status);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { results } = await c.env.DB.prepare(`${TOURNAMENT_SELECT} ${where} ORDER BY t.start_date DESC, t.id DESC LIMIT 500`)
    .bind(...binds)
    .all<Row>();
  let items = results.map(mapTournament);
  // El filtro por texto se hace en memoria (volúmenes chicos) para ignorar acentos.
  if (q.q) {
    const terms = searchTerms(q.q);
    items = items.filter((t) => {
      const text = normalizeText(`${t.name} ${t.venue ?? ""} ${t.categoryName}`);
      return terms.every((term) => text.includes(term));
    });
  }
  return c.json({ items });
});

tournamentRoutes.get("/:id", async (c) => {
  return c.json({ item: await getTournament(c.env.DB, parseId(c.req.param("id"), "El torneo")) });
});

/**
 * Sentencias para crear un torneo con la puntuación predeterminada de su tipo. Usan MAX(id): dentro de
 * un mismo lote se pueden encadenar varias (un evento con varias categorías).
 */
export function insertTournamentStmts(db: D1Database, input: TournamentData, userId: number, eventExpr?: string): D1PreparedStatement[] {
  // eventExpr: subconsulta del torneo (evento) recién creado en el mismo lote.
  const eventSql = eventExpr ?? "?";
  return [
    db
      .prepare(
        `INSERT INTO tournaments (season_id, name, type, category_id, division_id, start_date, end_date, venue, notes, created_by,
                                  public_visible, featured, registration_open, series, public_description, prize_info, event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${eventSql}) RETURNING id`,
      )
      .bind(input.seasonId, input.name, input.type, input.categoryId, input.divisionId, input.startDate, input.endDate,
        input.venue, input.notes, userId, input.publicVisible ? 1 : 0, input.featured ? 1 : 0, input.registrationOpen ? 1 : 0,
        input.series, input.publicDescription, input.prizeInfo, ...(eventExpr ? [] : [input.eventId ?? null])),
    // Se copia la plantilla predeterminada del tipo de torneo (queda editable para este torneo).
    db
      .prepare(
        `INSERT INTO tournament_scoring (tournament_id, template_id, template_name, cumulative, participation_bonus, match_played_bonus, match_won_bonus, updated_by)
         SELECT (SELECT MAX(id) FROM tournaments), id, name, cumulative, participation_bonus, match_played_bonus, match_won_bonus, ?
           FROM scoring_templates WHERE default_for_type = ? AND active = 1`,
      )
      .bind(userId, input.type),
    db
      .prepare(
        `INSERT INTO tournament_stages (tournament_id, label, rank, points, max_teams)
         SELECT (SELECT MAX(id) FROM tournaments), s.label, s.rank, s.points, s.max_teams
           FROM scoring_template_stages s JOIN scoring_templates t ON t.id = s.template_id
          WHERE t.default_for_type = ? AND t.active = 1`,
      )
      .bind(input.type),
    db
      .prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'crear', 'torneo', (SELECT MAX(id) FROM tournaments), ?)")
      .bind(userId, `Creó el torneo ${input.name}`),
  ];
}

export { validateRelations };

tournamentRoutes.post("/", async (c) => {
  const input = await parseBody(c, tournamentSchema);
  const db = c.env.DB;
  await validateRelations(db, input);
  const userId = c.get("user").id;
  // Toda competencia pertenece a un torneo: si no se indica uno, se crea el torneo con esta única categoría.
  const stmts = input.eventId
    ? insertTournamentStmts(db, input, userId)
    : [
      db.prepare(
        `INSERT INTO tournament_events (season_id, name, type, series, start_date, end_date, venue, created_by,
                                        public_visible, featured, registration_open, public_description, prize_info)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(input.seasonId, input.name, input.type, input.series, input.startDate, input.endDate, input.venue, userId,
        input.publicVisible ? 1 : 0, input.featured ? 1 : 0, input.registrationOpen ? 1 : 0, input.publicDescription, input.prizeInfo),
      ...insertTournamentStmts(db, input, userId, "(SELECT MAX(id) FROM tournament_events)"),
    ];
  const res = await db.batch<{ id: number }>(stmts);
  return c.json({ item: await getTournament(db, res[input.eventId ? 0 : 1]!.results[0]!.id) }, 201);
});

tournamentRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const input = await parseBody(c, tournamentSchema);
  const db = c.env.DB;
  const current = await getTournament(db, id);
  if (current.seasonStatus === "cerrada") throw conflict("El torneo pertenece a una temporada cerrada");
  if (current.creditedVersion !== null && (current.seasonId !== input.seasonId || current.categoryId !== input.categoryId || current.divisionId !== input.divisionId)) {
    throw conflict("El torneo tiene puntos acreditados: para cambiar temporada, categoría o división primero revertí la acreditación.");
  }
  await validateRelations(db, input, current);
  await db.batch([
    db
      .prepare(
        `UPDATE tournaments SET season_id = ?, name = ?, type = ?, category_id = ?, division_id = ?, start_date = ?, end_date = ?,
                venue = ?, notes = ?, public_visible = ?, featured = ?, registration_open = ?, series = ?, public_description = ?,
                prize_info = ?, event_id = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(input.seasonId, input.name, input.type, input.categoryId, input.divisionId, input.startDate, input.endDate,
        input.venue, input.notes, input.publicVisible ? 1 : 0, input.featured ? 1 : 0, input.registrationOpen ? 1 : 0, input.series,
        input.publicDescription, input.prizeInfo, input.eventId ?? null, new Date().toISOString(), id),
    // Torneo de una sola categoría: sus datos generales son los de la competencia.
    db.prepare(
      `UPDATE tournament_events SET name = ?, type = ?, series = ?, start_date = ?, end_date = ?, venue = ?, public_visible = ?, featured = ?,
              registration_open = ?, public_description = ?, prize_info = ?, updated_at = ?
        WHERE id = (SELECT event_id FROM tournaments WHERE id = ?) AND (SELECT COUNT(*) FROM tournaments WHERE event_id = tournament_events.id) = 1`,
    ).bind(input.name, input.type, input.series, input.startDate, input.endDate, input.venue, input.publicVisible ? 1 : 0, input.featured ? 1 : 0,
      input.registrationOpen ? 1 : 0, input.publicDescription, input.prizeInfo, new Date().toISOString(), id),
    auditStmt(db, c.get("user").id, "editar", "torneo", id, `Editó el torneo ${input.name}`),
  ]);
  return c.json({ item: await getTournament(db, id) });
});

tournamentRoutes.patch("/:id/status", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const { status } = await parseBody(c, tournamentStatusSchema);
  const db = c.env.DB;
  const current = await getTournament(db, id);
  if (current.status === status) return c.json({ item: current });
  if (current.seasonStatus === "cerrada") throw conflict("El torneo pertenece a una temporada cerrada");
  if (current.creditedVersion !== null) {
    throw conflict("El torneo tiene puntos acreditados: para cambiar su estado primero revertí la acreditación.");
  }
  if (!TOURNAMENT_TRANSITIONS[current.status].includes(status)) {
    throw badRequest(
      `No se puede pasar de "${TOURNAMENT_STATUS_LABEL[current.status]}" a "${TOURNAMENT_STATUS_LABEL[status]}"`,
    );
  }
  await db.batch([
    db.prepare("UPDATE tournaments SET status = ?, updated_at = ? WHERE id = ?").bind(status, new Date().toISOString(), id),
    auditStmt(db, c.get("user").id, "estado", "torneo", id, `${current.name}: ${TOURNAMENT_STATUS_LABEL[status]}`),
  ]);
  return c.json({ item: await getTournament(db, id) });
});

tournamentRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const db = c.env.DB;
  const current = await getTournament(db, id);
  if (current.status === "en_curso" || current.status === "finalizado") {
    throw conflict("Sólo se pueden eliminar torneos programados o cancelados");
  }
  if (current.teamCount > 0) throw conflict("El torneo tiene parejas inscriptas y no puede eliminarse. Cancelalo en su lugar.");
  const credits = await db.prepare("SELECT COUNT(*) AS n FROM tournament_credits WHERE tournament_id = ?").bind(id).first<{ n: number }>();
  if ((credits?.n ?? 0) > 0) throw conflict("El torneo tiene historial de puntos y no puede eliminarse. Cancelalo en su lugar.");
  if (current.seasonStatus === "cerrada") throw conflict("El torneo pertenece a una temporada cerrada");
  await db.batch([
    db.prepare("DELETE FROM tournaments WHERE id = ?").bind(id),
    // Si era la última categoría, el torneo general queda vacío y también se elimina.
    db.prepare("DELETE FROM tournament_events WHERE id = ? AND NOT EXISTS (SELECT 1 FROM tournaments WHERE event_id = ?)").bind(current.eventId, current.eventId),
    auditStmt(db, c.get("user").id, "eliminar", "torneo", id, `Eliminó la categoría ${current.categoryName} del torneo ${current.name}`),
  ]);
  return c.json({ ok: true });
});
