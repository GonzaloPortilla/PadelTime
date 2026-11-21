import { Hono } from "hono";
import { tournamentEventSchema } from "@shared/schemas";
import type { Gender, SeasonStatus } from "@shared/constants";
import type { TournamentEvent } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { loadPublicSettings } from "../lib/settings";
import { insertTournamentStmts, mapTournament, TOURNAMENT_SELECT } from "./tournaments";

/**
 * Eventos generales con varias categorías (Fase 9). Ej.: "Qatar Major 2000" con C5, C6 y C7.
 * Cada categoría es un torneo largo propio (parejas, fixture, puntuación y acreditación), de modo que
 * el motor de puntos y los torneos ya registrados no cambian: el evento sólo los agrupa.
 */
export const eventRoutes = new Hono<AppEnv>();

interface EventRow {
  id: number; season_id: number; season_name: string; season_status: SeasonStatus; name: string; series: TournamentEvent["series"];
  start_date: string; end_date: string; venue: string | null; notes: string | null; created_at: string;
}

const EVENT_SELECT = `
  SELECT e.id, e.season_id, s.name AS season_name, s.status AS season_status, e.name, e.series, e.start_date, e.end_date,
         e.venue, e.notes, e.created_at
    FROM tournament_events e JOIN seasons s ON s.id = e.season_id`;

async function loadEvent(db: D1Database, id: number): Promise<TournamentEvent> {
  const [eRes, tRes] = await db.batch([
    db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).bind(id),
    db.prepare(`${TOURNAMENT_SELECT} WHERE t.event_id = ? ORDER BY c.gender, c.level, c.name`).bind(id),
  ]);
  const e = eRes!.results[0] as EventRow | undefined;
  if (!e) throw notFound("El evento");
  return mapEvent(e, (tRes!.results as Parameters<typeof mapTournament>[0][]).map(mapTournament));
}

const mapEvent = (e: EventRow, tournaments: TournamentEvent["tournaments"]): TournamentEvent => ({
  id: e.id, seasonId: e.season_id, seasonName: e.season_name, seasonStatus: e.season_status, name: e.name, series: e.series,
  startDate: e.start_date, endDate: e.end_date, venue: e.venue, notes: e.notes, createdAt: e.created_at, tournaments,
});

/** Temporada abierta y fechas dentro de ella; categorías activas, de ramas activas y sin repetir en el evento. */
async function validateEvent(db: D1Database, input: { seasonId: number; startDate: string; endDate: string; categoryIds: number[] }, existingCategoryIds: number[] = []) {
  const season = await db.prepare("SELECT status, start_date, end_date FROM seasons WHERE id = ?").bind(input.seasonId)
    .first<{ status: SeasonStatus; start_date: string; end_date: string }>();
  if (!season) throw badRequest("La temporada no existe", { seasonId: "Temporada inexistente" });
  if (season.status === "cerrada") throw badRequest("La temporada está cerrada", { seasonId: "Temporada cerrada" });
  if (input.startDate < season.start_date || input.endDate > season.end_date) {
    throw badRequest(`Las fechas deben estar dentro de la temporada (${season.start_date} a ${season.end_date})`, { startDate: "Fuera de la temporada" });
  }
  if (!input.categoryIds.length) return;
  const { results } = await db.prepare("SELECT id, name, gender, active FROM categories WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(input.categoryIds)).all<{ id: number; name: string; gender: Gender; active: number }>();
  const { site } = await loadPublicSettings(db);
  for (const cid of input.categoryIds) {
    const cat = results.find((r) => r.id === cid);
    if (!cat) throw badRequest("Una de las categorías no existe", { categoryIds: "Categoría inexistente" });
    if (cat.active !== 1) throw badRequest(`La categoría ${cat.name} está inactiva`, { categoryIds: "Categoría inactiva" });
    // Ramas discontinuadas (Damas): no se ofrecen en altas nuevas.
    if (!site.activeGenders.includes(cat.gender)) throw badRequest(`La categoría ${cat.name} es de una rama discontinuada`, { categoryIds: "Rama discontinuada" });
    if (existingCategoryIds.includes(cid)) throw conflict(`El evento ya tiene la categoría ${cat.name}`);
  }
}

eventRoutes.get("/", async (c) => {
  const seasonId = Number(c.req.query("seasonId")) || null;
  const db = c.env.DB;
  const [eRes, tRes] = await db.batch([
    db.prepare(`${EVENT_SELECT} ${seasonId ? "WHERE e.season_id = ?" : ""} ORDER BY e.start_date DESC, e.id DESC LIMIT 200`).bind(...(seasonId ? [seasonId] : [])),
    db.prepare(`${TOURNAMENT_SELECT} WHERE t.event_id IS NOT NULL ORDER BY c.gender, c.level, c.name`),
  ]);
  const tournaments = (tRes!.results as Parameters<typeof mapTournament>[0][]).map(mapTournament);
  return c.json({ items: (eRes!.results as EventRow[]).map((e) => mapEvent(e, tournaments.filter((t) => t.eventId === e.id))) });
});

eventRoutes.get("/:id", async (c) => c.json({ item: await loadEvent(c.env.DB, parseId(c.req.param("id"), "El evento")) }));

const tournamentData = (e: { seasonId: number; name: string; series: TournamentEvent["series"]; startDate: string; endDate: string; venue: string | null; publicVisible: boolean }, categoryId: number, eventId: number | null) => ({
  seasonId: e.seasonId, name: e.name, type: "largo" as const, categoryId, divisionId: null, startDate: e.startDate, endDate: e.endDate,
  venue: e.venue, notes: null, publicVisible: e.publicVisible, featured: false, registrationOpen: false, series: e.series,
  publicDescription: null, prizeInfo: null, eventId,
});

eventRoutes.post("/", async (c) => {
  const input = await parseBody(c, tournamentEventSchema);
  const db = c.env.DB;
  await validateEvent(db, input);
  const userId = c.get("user").id;
  const [res] = await db.batch<{ id: number }>([
    db.prepare("INSERT INTO tournament_events (season_id, name, series, start_date, end_date, venue, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(input.seasonId, input.name, input.series, input.startDate, input.endDate, input.venue, input.notes, userId),
    // Una competencia (torneo largo) por categoría, enlazada al evento recién creado.
    ...input.categoryIds.flatMap((cid) => [
      ...insertTournamentStmts(db, tournamentData(input, cid, null), userId),
      db.prepare("UPDATE tournaments SET event_id = (SELECT MAX(id) FROM tournament_events) WHERE id = (SELECT MAX(id) FROM tournaments)"),
    ]),
    db.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'crear', 'evento', (SELECT MAX(id) FROM tournament_events), ?)")
      .bind(userId, `Creó el evento ${input.name} (${input.categoryIds.length} categoría${input.categoryIds.length === 1 ? "" : "s"})`),
  ]);
  return c.json({ item: await loadEvent(db, res!.results[0]!.id) }, 201);
});

eventRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El evento");
  const input = await parseBody(c, tournamentEventSchema);
  const db = c.env.DB;
  const current = await loadEvent(db, id);
  if (current.seasonStatus === "cerrada") throw conflict("El evento pertenece a una temporada cerrada");
  if (input.seasonId !== current.seasonId && current.tournaments.length) throw conflict("No se puede cambiar la temporada de un evento con categorías");
  await validateEvent(db, input, current.tournaments.map((t) => t.categoryId));
  const userId = c.get("user").id;
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE tournament_events SET season_id = ?, name = ?, series = ?, start_date = ?, end_date = ?, venue = ?, notes = ?, updated_at = ? WHERE id = ?")
      .bind(input.seasonId, input.name, input.series, input.startDate, input.endDate, input.venue, input.notes, now, id),
  ];
  if (input.applyToCategories) {
    // Sólo categorías sin puntos acreditados: lo acreditado no se toca.
    stmts.push(db.prepare(
      `UPDATE tournaments SET name = ?, series = ?, start_date = ?, end_date = ?, venue = ?, updated_at = ?
        WHERE event_id = ? AND NOT EXISTS (SELECT 1 FROM tournament_credits cr WHERE cr.tournament_id = tournaments.id AND cr.status = 'vigente')`,
    ).bind(input.name, input.series, input.startDate, input.endDate, input.venue, now, id));
  }
  for (const cid of input.categoryIds) {
    stmts.push(...insertTournamentStmts(db, tournamentData(input, cid, id), userId));
  }
  stmts.push(auditStmt(db, userId, "editar", "evento", id, `Editó el evento ${input.name}${input.categoryIds.length ? ` y agregó ${input.categoryIds.length} categoría(s)` : ""}`));
  await db.batch(stmts);
  return c.json({ item: await loadEvent(db, id) });
});

/** Borra el evento. Las categorías NO se borran: quedan como torneos sueltos (con sus parejas y puntos). */
eventRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El evento");
  const db = c.env.DB;
  const current = await loadEvent(db, id);
  if (current.seasonStatus === "cerrada") throw conflict("El evento pertenece a una temporada cerrada");
  await db.batch([
    db.prepare("UPDATE tournaments SET event_id = NULL WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM tournament_events WHERE id = ?").bind(id),
    auditStmt(db, c.get("user").id, "eliminar", "evento", id, `Eliminó el evento ${current.name} (las categorías se conservan)`),
  ]);
  return c.json({ ok: true });
});
