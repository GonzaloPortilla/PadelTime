import { Hono } from "hono";
import { tournamentEventSchema } from "@shared/schemas";
import { eventStatus, type Gender, type SeasonStatus, type TournamentType } from "@shared/constants";
import type { TournamentEvent } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { loadPublicSettings } from "../lib/settings";
import { insertTournamentStmts, mapTournament, TOURNAMENT_SELECT } from "./tournaments";
import type { z } from "zod";

/**
 * Torneos (eventos generales) con una o más categorías.
 *   Torneo      = tournament_events: nombre, tipo, fechas, sede e información pública, cargados una sola vez.
 *   Competencia = tournaments: una categoría (y división opcional) del torneo, con sus parejas, fixture,
 *                 puntuación, acreditación y movimientos. Cada categoría avanza y se acredita por su cuenta.
 * Los datos generales del torneo se copian a sus competencias: así la acreditación, los rankings, el
 * reconocimiento de cuadros y la web siguen leyendo lo mismo que antes.
 */
export const eventRoutes = new Hono<AppEnv>();

interface EventRow {
  id: number; season_id: number; season_name: string; season_status: SeasonStatus; name: string; type: TournamentType; series: TournamentEvent["series"];
  start_date: string; end_date: string; venue: string | null; notes: string | null; created_at: string;
  public_visible: number; featured: number; registration_open: number; public_description: string | null; prize_info: string | null;
}

const EVENT_SELECT = `
  SELECT e.id, e.season_id, s.name AS season_name, s.status AS season_status, e.name, e.type, e.series, e.start_date, e.end_date,
         e.venue, e.notes, e.created_at, e.public_visible, e.featured, e.registration_open, e.public_description, e.prize_info
    FROM tournament_events e JOIN seasons s ON s.id = e.season_id`;

const COMPETITION_ORDER = "ORDER BY c.gender, c.level, c.name, d.sort_order";

export async function loadEvent(db: D1Database, id: number): Promise<TournamentEvent> {
  const [eRes, tRes] = await db.batch([
    db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).bind(id),
    db.prepare(`${TOURNAMENT_SELECT} WHERE t.event_id = ? ${COMPETITION_ORDER}`).bind(id),
  ]);
  const e = eRes!.results[0] as EventRow | undefined;
  if (!e) throw notFound("El torneo");
  return mapEvent(e, (tRes!.results as Parameters<typeof mapTournament>[0][]).map(mapTournament));
}

const mapEvent = (e: EventRow, tournaments: TournamentEvent["tournaments"]): TournamentEvent => ({
  id: e.id, seasonId: e.season_id, seasonName: e.season_name, seasonStatus: e.season_status, name: e.name, type: e.type, series: e.series,
  startDate: e.start_date, endDate: e.end_date, venue: e.venue, notes: e.notes, createdAt: e.created_at,
  publicVisible: e.public_visible === 1, featured: e.featured === 1, registrationOpen: e.registration_open === 1,
  publicDescription: e.public_description, prizeInfo: e.prize_info,
  status: eventStatus(tournaments.map((t) => t.status)), tournaments,
});

type EventData = z.output<typeof tournamentEventSchema>;

/** Temporada abierta y fechas dentro de ella; categorías y divisiones activas, de ramas activas y sin repetir. */
async function validateEvent(db: D1Database, input: EventData, existing: { categoryId: number; divisionId: number | null }[] = []) {
  const season = await db.prepare("SELECT status, start_date, end_date FROM seasons WHERE id = ?").bind(input.seasonId)
    .first<{ status: SeasonStatus; start_date: string; end_date: string }>();
  if (!season) throw badRequest("La temporada no existe", { seasonId: "Temporada inexistente" });
  if (season.status === "cerrada") throw badRequest("La temporada está cerrada", { seasonId: "Temporada cerrada" });
  if (input.startDate < season.start_date || input.endDate > season.end_date) {
    throw badRequest(`Las fechas deben estar dentro de la temporada (${season.start_date} a ${season.end_date})`, { startDate: "Fuera de la temporada" });
  }
  if (!input.competitions.length) return;
  const [cats, divs] = await db.batch([
    db.prepare("SELECT id, name, gender, active FROM categories WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(input.competitions.map((c) => c.categoryId))),
    db.prepare("SELECT id, category_id, name, active FROM divisions WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(input.competitions.map((c) => c.divisionId).filter(Boolean))),
  ]);
  const { site } = await loadPublicSettings(db);
  for (const comp of input.competitions) {
    const cat = (cats!.results as { id: number; name: string; gender: Gender; active: number }[]).find((r) => r.id === comp.categoryId);
    if (!cat) throw badRequest("Una de las categorías no existe", { competitions: "Categoría inexistente" });
    if (cat.active !== 1) throw badRequest(`La categoría ${cat.name} está inactiva`, { competitions: "Categoría inactiva" });
    // Ramas discontinuadas (Damas): no se ofrecen en altas nuevas.
    if (!site.activeGenders.includes(cat.gender)) throw badRequest(`La categoría ${cat.name} es de una rama discontinuada`, { competitions: "Rama discontinuada" });
    if (comp.divisionId) {
      const div = (divs!.results as { id: number; category_id: number; name: string; active: number }[]).find((d) => d.id === comp.divisionId);
      if (!div || div.category_id !== cat.id) throw badRequest("La división no pertenece a la categoría", { competitions: "División inválida" });
      if (div.active !== 1) throw badRequest(`La división ${div.name} está inactiva`, { competitions: "División inactiva" });
    }
    if (existing.some((x) => x.categoryId === comp.categoryId && (x.divisionId ?? null) === (comp.divisionId ?? null))) {
      throw conflict(`El torneo ya tiene la categoría ${cat.name}`);
    }
  }
}

/** Datos de una competencia nueva del torneo (los generales salen del torneo). */
export const competitionData = (e: EventData, comp: { categoryId: number; divisionId: number | null }, eventId: number | null) => ({
  seasonId: e.seasonId, name: e.name, type: e.type, categoryId: comp.categoryId, divisionId: comp.divisionId ?? null,
  startDate: e.startDate, endDate: e.endDate, venue: e.venue, notes: null, publicVisible: e.publicVisible, featured: e.featured,
  registrationOpen: e.registrationOpen, series: e.series, publicDescription: e.publicDescription, prizeInfo: e.prizeInfo, eventId,
});

eventRoutes.get("/", async (c) => {
  const seasonId = Number(c.req.query("seasonId")) || null;
  const db = c.env.DB;
  const [eRes, tRes] = await db.batch([
    db.prepare(`${EVENT_SELECT} ${seasonId ? "WHERE e.season_id = ?" : ""} ORDER BY e.start_date DESC, e.id DESC LIMIT 300`).bind(...(seasonId ? [seasonId] : [])),
    db.prepare(`${TOURNAMENT_SELECT} WHERE t.event_id IS NOT NULL ${seasonId ? "AND t.season_id = ?" : ""} ${COMPETITION_ORDER}`).bind(...(seasonId ? [seasonId] : [])),
  ]);
  const tournaments = (tRes!.results as Parameters<typeof mapTournament>[0][]).map(mapTournament);
  return c.json({ items: (eRes!.results as EventRow[]).map((e) => mapEvent(e, tournaments.filter((t) => t.eventId === e.id))) });
});

eventRoutes.get("/:id", async (c) => c.json({ item: await loadEvent(c.env.DB, parseId(c.req.param("id"), "El torneo")) }));

eventRoutes.post("/", async (c) => {
  const input = await parseBody(c, tournamentEventSchema);
  if (!input.competitions.length) throw badRequest("Elegí al menos una categoría", { competitions: "Elegí al menos una categoría" });
  const db = c.env.DB;
  await validateEvent(db, input);
  const userId = c.get("user").id;
  const [res] = await db.batch<{ id: number }>([
    db.prepare(
      `INSERT INTO tournament_events (season_id, name, type, series, start_date, end_date, venue, notes, created_by,
                                      public_visible, featured, registration_open, public_description, prize_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(input.seasonId, input.name, input.type, input.series, input.startDate, input.endDate, input.venue, input.notes, userId,
      input.publicVisible ? 1 : 0, input.featured ? 1 : 0, input.registrationOpen ? 1 : 0, input.publicDescription, input.prizeInfo),
    // Una competencia por categoría, enlazada al torneo recién creado.
    ...input.competitions.flatMap((comp) => insertTournamentStmts(db, competitionData(input, comp, null), userId, "(SELECT MAX(id) FROM tournament_events)")),
    db.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'crear', 'evento', (SELECT MAX(id) FROM tournament_events), ?)")
      .bind(userId, `Creó el torneo ${input.name} (${input.competitions.length} categoría${input.competitions.length === 1 ? "" : "s"})`),
  ]);
  return c.json({ item: await loadEvent(db, res!.results[0]!.id) }, 201);
});

/**
 * Edita los datos generales (se copian a todas las categorías) y agrega categorías nuevas.
 * El tipo de torneo no cambia si alguna categoría ya tiene parejas.
 */
eventRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const input = await parseBody(c, tournamentEventSchema);
  const db = c.env.DB;
  const current = await loadEvent(db, id);
  if (current.seasonStatus === "cerrada") throw conflict("El torneo pertenece a una temporada cerrada");
  if (input.seasonId !== current.seasonId && current.tournaments.length) throw conflict("No se puede cambiar la temporada de un torneo con categorías");
  if (input.type !== current.type && current.tournaments.some((t) => t.teamCount > 0)) throw conflict("No se puede cambiar el tipo de un torneo con parejas inscriptas");
  await validateEvent(db, input, current.tournaments.map((t) => ({ categoryId: t.categoryId, divisionId: t.divisionId })));
  const userId = c.get("user").id;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE tournament_events SET season_id = ?, name = ?, type = ?, series = ?, start_date = ?, end_date = ?, venue = ?, notes = ?,
              public_visible = ?, featured = ?, registration_open = ?, public_description = ?, prize_info = ?, updated_at = ? WHERE id = ?`,
    ).bind(input.seasonId, input.name, input.type, input.series, input.startDate, input.endDate, input.venue, input.notes,
      input.publicVisible ? 1 : 0, input.featured ? 1 : 0, input.registrationOpen ? 1 : 0, input.publicDescription, input.prizeInfo, now, id),
    // Datos generales → todas las categorías (la temporada, categoría y estado de cada una no cambian).
    db.prepare(
      `UPDATE tournaments SET name = ?, type = ?, series = ?, start_date = ?, end_date = ?, venue = ?, public_visible = ?, featured = ?,
              registration_open = ?, public_description = ?, prize_info = ?, updated_at = ? WHERE event_id = ?`,
    ).bind(input.name, input.type, input.series, input.startDate, input.endDate, input.venue, input.publicVisible ? 1 : 0, input.featured ? 1 : 0,
      input.registrationOpen ? 1 : 0, input.publicDescription, input.prizeInfo, now, id),
    ...input.competitions.flatMap((comp) => insertTournamentStmts(db, competitionData(input, comp, id), userId)),
    auditStmt(db, userId, "editar", "evento", id, `Editó el torneo ${input.name}${input.competitions.length ? ` y agregó ${input.competitions.length} categoría(s)` : ""}`),
  ]);
  return c.json({ item: await loadEvent(db, id) });
});

/**
 * Borra un torneo sólo si ninguna de sus categorías tiene historia (parejas o puntos):
 * se eliminan también esas competencias vacías. Si no, conviene cancelarlo.
 */
eventRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const db = c.env.DB;
  const current = await loadEvent(db, id);
  if (current.seasonStatus === "cerrada") throw conflict("El torneo pertenece a una temporada cerrada");
  if (current.tournaments.some((t) => t.teamCount > 0 || t.creditedVersion !== null || t.status === "en_curso" || t.status === "finalizado")) {
    throw conflict("El torneo tiene categorías con parejas, en juego o con puntos: no se puede eliminar. Cancelá esas categorías en su lugar.");
  }
  const credits = await db.prepare("SELECT COUNT(*) AS n FROM tournament_credits WHERE tournament_id IN (SELECT id FROM tournaments WHERE event_id = ?)").bind(id).first<{ n: number }>();
  if ((credits?.n ?? 0) > 0) throw conflict("El torneo tiene historial de puntos y no puede eliminarse.");
  await db.batch([
    db.prepare("DELETE FROM tournaments WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM tournament_events WHERE id = ?").bind(id),
    auditStmt(db, c.get("user").id, "eliminar", "evento", id, `Eliminó el torneo ${current.name}`),
  ]);
  return c.json({ ok: true });
});
