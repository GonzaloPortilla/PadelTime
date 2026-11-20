import { Hono } from "hono";
import { rankingQuerySchema, tiebreakersSchema } from "@shared/schemas";
import { parseTiebreakers, rankPlayers, type RankingStats } from "@shared/scoring";
import type { Gender, SeasonStatus, Tiebreaker } from "@shared/constants";
import type { RankingResponse, RankingRow } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId, parseQuery } from "../lib/validate";
import { auditStmt } from "../lib/audit";

interface Totals { player_id: number; category_id: number; points: number; adjustments: number; initial_balance: number }
interface Stats { player_id: number; category_id: number; tournaments: number; titles: number; finals: number; semifinals: number; best: number; matches_won: number }
interface PlayerInfo { id: number; code: string; first_name: string; last_name: string; nickname: string | null; active: number }

/**
 * Calcula rankings a partir del registro de movimientos (única fuente de verdad):
 *  - puntos = suma de TODOS los movimientos (acreditaciones, contraasientos y ajustes);
 *  - estadísticas de desempate = sólo acreditaciones vigentes.
 * Con categoryId = null devuelve todas las categorías de la temporada.
 */
export async function computeRankings(
  db: D1Database,
  seasonId: number,
  categoryId: number | null,
  divisionId: number | null,
  tiebreakers: Tiebreaker[],
): Promise<Map<number, RankingRow[]>> {
  // D1 exige que la cantidad de parámetros coincida exactamente con los usados.
  const filters = ["m.season_id = ?"];
  const binds: number[] = [seasonId];
  if (categoryId !== null) { filters.push("m.category_id = ?"); binds.push(categoryId); }
  if (divisionId !== null) { filters.push("m.division_id = ?"); binds.push(divisionId); }
  const where = filters.join(" AND ");

  const [totals, stats, players] = await db.batch([
    db
      .prepare(
        `SELECT m.player_id, m.category_id, SUM(m.points) AS points,
                SUM(CASE WHEN m.kind IN ('ajuste', 'anulacion_ajuste') AND m.balance_import_id IS NULL THEN m.points ELSE 0 END) AS adjustments,
                SUM(CASE WHEN m.balance_import_id IS NOT NULL THEN m.points ELSE 0 END) AS initial_balance
           FROM point_movements m WHERE ${where} GROUP BY m.category_id, m.player_id`,
      )
      .bind(...binds),
    db
      .prepare(
        `SELECT m.player_id, m.category_id, COUNT(*) AS tournaments,
                SUM(m.stage_rank = 1) AS titles, SUM(m.stage_rank <= 2) AS finals, SUM(m.stage_rank <= 3) AS semifinals,
                MAX(m.points) AS best, SUM(m.matches_won) AS matches_won
           FROM point_movements m JOIN tournament_credits cr ON cr.id = m.credit_id AND cr.status = 'vigente'
          WHERE ${where} AND m.kind = 'acreditacion'
          GROUP BY m.category_id, m.player_id`,
      )
      .bind(...binds),
    db
      .prepare(
        `SELECT DISTINCT p.id, p.code, p.first_name, p.last_name, p.nickname, p.active
           FROM players p JOIN point_movements m ON m.player_id = p.id WHERE ${where}`,
      )
      .bind(...binds),
  ]);

  const playerMap = new Map((players!.results as PlayerInfo[]).map((p) => [p.id, p]));
  const statMap = new Map((stats!.results as Stats[]).map((s) => [`${s.category_id}:${s.player_id}`, s]));
  const byCategory = new Map<number, (RankingStats & Omit<RankingRow, "position" | "tied">)[]>();

  for (const t of totals!.results as Totals[]) {
    const s = statMap.get(`${t.category_id}:${t.player_id}`);
    const p = playerMap.get(t.player_id)!;
    // Quien quedó en 0 sin torneos vigentes (p. ej. todo revertido) no figura en el ranking.
    if (t.points === 0 && !s) continue;
    const list = byCategory.get(t.category_id) ?? [];
    list.push({
      playerId: p.id,
      code: p.code,
      firstName: p.first_name,
      lastName: p.last_name,
      nickname: p.nickname,
      active: p.active === 1,
      points: t.points,
      adjustments: t.adjustments,
      initialBalance: t.initial_balance,
      tournaments: s?.tournaments ?? 0,
      titles: s?.titles ?? 0,
      finals: s?.finals ?? 0,
      semifinals: s?.semifinals ?? 0,
      bestTournament: s?.best ?? 0,
      matchesWon: s?.matches_won ?? 0,
    });
    byCategory.set(t.category_id, list);
  }

  const result = new Map<number, RankingRow[]>();
  for (const [cat, list] of byCategory) {
    result.set(cat, rankPlayers(list, tiebreakers).map((r) => ({ ...r.entry, position: r.position, tied: r.tied })));
  }
  return result;
}

async function getSeason(db: D1Database, id: number) {
  const s = await db.prepare("SELECT id, name, status, tiebreakers FROM seasons WHERE id = ?").bind(id)
    .first<{ id: number; name: string; status: SeasonStatus; tiebreakers: string | null }>();
  if (!s) throw notFound("La temporada");
  return s;
}

export const rankingRoutes = new Hono<AppEnv>();

rankingRoutes.get("/", async (c) => {
  const q = parseQuery(c, rankingQuerySchema);
  const db = c.env.DB;
  const season = await getSeason(db, q.seasonId);
  const category = await db.prepare("SELECT id, name, gender FROM categories WHERE id = ?").bind(q.categoryId)
    .first<{ id: number; name: string; gender: Gender }>();
  if (!category) throw notFound("La categoría");
  let division: { id: number; name: string } | null = null;
  if (q.divisionId) {
    division = await db.prepare("SELECT id, name FROM divisions WHERE id = ? AND category_id = ?").bind(q.divisionId, q.categoryId)
      .first<{ id: number; name: string }>();
    if (!division) throw badRequest("La división no pertenece a la categoría");
  }
  const tiebreakers = parseTiebreakers(season.tiebreakers);
  const rankings = await computeRankings(db, season.id, category.id, division?.id ?? null, tiebreakers);
  const body: RankingResponse = {
    season: { id: season.id, name: season.name, status: season.status },
    category,
    division,
    tiebreakers,
    rows: rankings.get(category.id) ?? [],
    generatedAt: new Date().toISOString(),
  };
  return c.json(body);
});

/** Todas las categorías de una temporada (para exportar el libro completo). */
rankingRoutes.get("/season/:id", async (c) => {
  const db = c.env.DB;
  const season = await getSeason(db, parseId(c.req.param("id"), "La temporada"));
  const tiebreakers = parseTiebreakers(season.tiebreakers);
  const [rankings, cats] = await Promise.all([
    computeRankings(db, season.id, null, null, tiebreakers),
    db.prepare("SELECT id, name, gender, level FROM categories ORDER BY gender DESC, level, name").all<{ id: number; name: string; gender: Gender }>(),
  ]);
  const categories = cats.results
    .filter((cat) => rankings.has(cat.id))
    .map((cat) => ({ category: { id: cat.id, name: cat.name, gender: cat.gender }, rows: rankings.get(cat.id)! }));
  return c.json({ season: { id: season.id, name: season.name, status: season.status }, tiebreakers, categories, generatedAt: new Date().toISOString() });
});

rankingRoutes.get("/tiebreakers/:seasonId", async (c) => {
  const season = await getSeason(c.env.DB, parseId(c.req.param("seasonId"), "La temporada"));
  return c.json({ tiebreakers: parseTiebreakers(season.tiebreakers), custom: season.tiebreakers !== null });
});

rankingRoutes.put("/tiebreakers/:seasonId", async (c) => {
  const db = c.env.DB;
  const season = await getSeason(db, parseId(c.req.param("seasonId"), "La temporada"));
  if (season.status === "cerrada") throw conflict("La temporada está cerrada: sus reglas de desempate no se pueden modificar.");
  const { tiebreakers } = await parseBody(c, tiebreakersSchema);
  await db.batch([
    db.prepare("UPDATE seasons SET tiebreakers = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(tiebreakers), new Date().toISOString(), season.id),
    auditStmt(db, c.get("user").id, "editar", "temporada", season.id, `${season.name}: cambió las reglas de desempate`),
  ]);
  return c.json({ tiebreakers });
});
