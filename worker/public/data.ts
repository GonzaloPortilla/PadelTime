import { parseTiebreakers } from "@shared/scoring";
import { searchTerms } from "@shared/text";
import type { Gender, SeasonStatus, Tiebreaker } from "@shared/constants";
import type { RankingRow } from "@shared/types";
import { computeRankings } from "../routes/rankings";

/**
 * Consultas de la vista pública. Sólo devuelven datos publicables: nombre, apodo, código interno,
 * categoría y puntos. Nunca documento, teléfono, email, fecha de nacimiento, notas ni motivos de ajustes.
 */

export interface PublicSeason { id: number; name: string; year: number; status: SeasonStatus; tiebreakers: Tiebreaker[] }
export interface PublicRankingRef {
  seasonId: number; categoryId: number; categoryName: string; gender: Gender; level: number;
  divisionId: number | null; divisionName: string | null; players: number;
}

const VISIBLE = "s.public_visible = 1 AND s.status <> 'planificada'";

export async function visibleSeasons(db: D1Database): Promise<PublicSeason[]> {
  const { results } = await db
    .prepare(`SELECT s.id, s.name, s.year, s.status, s.tiebreakers FROM seasons s WHERE ${VISIBLE} ORDER BY s.year DESC, s.start_date DESC`)
    .all<{ id: number; name: string; year: number; status: SeasonStatus; tiebreakers: string | null }>();
  return results.map((s) => ({ id: s.id, name: s.name, year: s.year, status: s.status, tiebreakers: parseTiebreakers(s.tiebreakers) }));
}

/** "actual" = temporada activa (o la más reciente visible). Permite un enlace que cambia solo de año. */
export function resolveSeason(seasons: PublicSeason[], param: string): PublicSeason | null {
  if (param === "actual") return seasons.find((s) => s.status === "activa") ?? seasons[0] ?? null;
  const id = Number(param);
  return Number.isInteger(id) ? seasons.find((s) => s.id === id) ?? null : null;
}

/** Rankings con puntos de una temporada: por categoría y, si hay, por división. */
/** Ramas visibles en la web (Damas está discontinuada: sus datos se conservan, pero no se publican). */
export const ALL_GENDERS: Gender[] = ["M", "F"];

export async function rankingRefs(db: D1Database, seasonId: number, genders: Gender[] = ALL_GENDERS): Promise<PublicRankingRef[]> {
  const { results } = await db
    .prepare(
      `SELECT x.category_id, c.name AS category_name, c.gender, c.level, x.division_id, d.name AS division_name, x.players
         FROM (SELECT category_id, NULL AS division_id, COUNT(*) AS players
                 FROM (SELECT category_id, player_id FROM point_movements WHERE season_id = ? GROUP BY category_id, player_id HAVING SUM(points) <> 0)
                GROUP BY category_id
               UNION ALL
               SELECT category_id, division_id, COUNT(*)
                 FROM (SELECT category_id, division_id, player_id FROM point_movements WHERE season_id = ? AND division_id IS NOT NULL
                        GROUP BY category_id, division_id, player_id HAVING SUM(points) <> 0)
                GROUP BY category_id, division_id) x
         JOIN categories c ON c.id = x.category_id LEFT JOIN divisions d ON d.id = x.division_id
        ORDER BY c.gender DESC, c.level, c.name, x.division_id IS NOT NULL, d.sort_order, d.name`,
    )
    .bind(seasonId, seasonId)
    .all<{ category_id: number; category_name: string; gender: Gender; level: number; division_id: number | null; division_name: string | null; players: number }>();
  return results.filter((r) => genders.includes(r.gender)).map((r) => ({
    seasonId, categoryId: r.category_id, categoryName: r.category_name, gender: r.gender, level: r.level,
    divisionId: r.division_id, divisionName: r.division_name, players: r.players,
  }));
}

export interface PublicRanking {
  season: PublicSeason;
  category: { id: number; name: string; gender: Gender };
  division: { id: number; name: string } | null;
  rows: RankingRow[];
  lastUpdate: string | null;
}

export async function loadRanking(db: D1Database, season: PublicSeason, categoryId: number, divisionId: number | null, genders: Gender[] = ALL_GENDERS): Promise<PublicRanking | null> {
  const [catRes, divRes, lastRes] = await db.batch([
    db.prepare("SELECT id, name, gender FROM categories WHERE id = ?").bind(categoryId),
    db.prepare("SELECT id, name FROM divisions WHERE id = ? AND category_id = ?").bind(divisionId ?? 0, categoryId),
    db.prepare(
      `SELECT MAX(created_at) AS last FROM point_movements WHERE season_id = ? AND category_id = ?${divisionId !== null ? " AND division_id = ?" : ""}`,
    ).bind(...(divisionId !== null ? [season.id, categoryId, divisionId] : [season.id, categoryId])),
  ]);
  const category = catRes!.results[0] as { id: number; name: string; gender: Gender } | undefined;
  if (!category || !genders.includes(category.gender)) return null;
  const division = (divRes!.results[0] as { id: number; name: string } | undefined) ?? null;
  if (divisionId !== null && !division) return null;
  const rankings = await computeRankings(db, season.id, categoryId, divisionId, season.tiebreakers);
  return {
    season, category, division,
    rows: rankings.get(categoryId) ?? [],
    lastUpdate: (lastRes!.results[0] as { last: string | null } | undefined)?.last ?? null,
  };
}

export interface PublicPlayerHit { code: string; firstName: string; lastName: string; nickname: string | null; categoryName: string; gender: Gender }

/**
 * Búsqueda pública: sólo por nombre, apellido o apodo (se descartan términos con dígitos para que
 * no se pueda consultar un documento) y sólo jugadores con puntos en temporadas visibles.
 */
export async function searchPlayers(db: D1Database, query: string, genders: Gender[] = ALL_GENDERS): Promise<PublicPlayerHit[]> {
  const terms = searchTerms(query).filter((t) => !/\d/.test(t) && t.length >= 2).slice(0, 5);
  if (!terms.length) return [];
  const likes = terms.map(() => "p.search_text LIKE ? ESCAPE '\\'").join(" AND ");
  const { results } = await db
    .prepare(
      `SELECT p.code, p.first_name, p.last_name, p.nickname, c.name AS category_name, p.gender
         FROM players p JOIN categories c ON c.id = p.main_category_id
        WHERE ${likes}
          AND EXISTS (SELECT 1 FROM point_movements m JOIN seasons s ON s.id = m.season_id WHERE m.player_id = p.id AND ${VISIBLE})
        ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT 40`,
    )
    .bind(...terms.map((t) => `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`))
    .all<{ code: string; first_name: string; last_name: string; nickname: string | null; category_name: string; gender: Gender }>();
  return results.filter((r) => genders.includes(r.gender)).map((r) => ({ code: r.code, firstName: r.first_name, lastName: r.last_name, nickname: r.nickname, categoryName: r.category_name, gender: r.gender }));
}

export interface PublicHistoryEntry {
  seasonId: number; seasonName: string; categoryId: number; categoryName: string; divisionName: string | null;
  kind: "torneo" | "saldo" | "ajuste"; label: string; date: string | null; stage: string | null; partner: string | null; points: number;
}

export interface PublicPlayer {
  code: string; firstName: string; lastName: string; nickname: string | null; categoryName: string; gender: Gender;
  summary: { seasonId: number; seasonName: string; categoryId: number; categoryName: string; points: number; position: number | null; tied: boolean; total: number }[];
  history: PublicHistoryEntry[];
}

export async function loadPlayer(db: D1Database, code: string, seasons: PublicSeason[], genders: Gender[] = ALL_GENDERS): Promise<PublicPlayer | null> {
  const p = await db
    .prepare(
      `SELECT p.id, p.code, p.first_name, p.last_name, p.nickname, p.gender, c.name AS category_name
         FROM players p JOIN categories c ON c.id = p.main_category_id WHERE p.code = ?`,
    )
    .bind(code.toUpperCase())
    .first<{ id: number; code: string; first_name: string; last_name: string; nickname: string | null; gender: Gender; category_name: string }>();
  if (!p || !genders.includes(p.gender)) return null;
  const { results } = await db
    .prepare(
      `SELECT m.kind, m.points, m.season_id, s.name AS season_name, m.category_id, c.name AS category_name, d.name AS division_name,
              t.name AS tournament_name, t.start_date, cr.status AS credit_status, m.stage_label, m.partner_name, m.balance_import_id,
              m.created_at, EXISTS (SELECT 1 FROM point_movements r WHERE r.reverses_movement_id = m.id) AS reversed
         FROM point_movements m
         JOIN seasons s ON s.id = m.season_id JOIN categories c ON c.id = m.category_id
         LEFT JOIN divisions d ON d.id = m.division_id LEFT JOIN tournaments t ON t.id = m.tournament_id
         LEFT JOIN tournament_credits cr ON cr.id = m.credit_id
        WHERE m.player_id = ? AND ${VISIBLE} AND m.kind IN ('acreditacion', 'ajuste')
        ORDER BY s.year DESC, COALESCE(t.start_date, substr(m.created_at, 1, 10)) DESC, m.id DESC`,
    )
    .bind(p.id)
    .all<{
      kind: "acreditacion" | "ajuste"; points: number; season_id: number; season_name: string; category_id: number; category_name: string;
      division_name: string | null; tournament_name: string | null; start_date: string | null; credit_status: string | null;
      stage_label: string | null; partner_name: string | null; balance_import_id: number | null; created_at: string; reversed: number;
    }>();

  // Sólo lo vigente: acreditaciones de la versión vigente y ajustes no anulados. Lo corregido o
  // revertido se compensa en el libro y no aporta puntos, así que no se muestra.
  const history: PublicHistoryEntry[] = [];
  for (const m of results) {
    if (m.kind === "acreditacion" && m.credit_status !== "vigente") continue;
    if (m.kind === "ajuste" && m.reversed) continue;
    const base = { seasonId: m.season_id, seasonName: m.season_name, categoryId: m.category_id, categoryName: m.category_name, divisionName: m.division_name, points: m.points };
    if (m.kind === "acreditacion") {
      history.push({ ...base, kind: "torneo", label: m.tournament_name ?? "Torneo", date: m.start_date, stage: m.stage_label, partner: m.partner_name });
    } else if (m.balance_import_id !== null) {
      history.push({ ...base, kind: "saldo", label: "Saldo inicial importado", date: null, stage: null, partner: null });
    } else {
      // El motivo de un ajuste es interno: en la web sólo se informa que hubo un ajuste.
      history.push({ ...base, kind: "ajuste", label: "Ajuste de puntos", date: m.created_at.slice(0, 10), stage: null, partner: null });
    }
  }
  if (!history.length) return null;

  // Totales por temporada y categoría, con la posición en ese ranking.
  const totals = new Map<string, { seasonId: number; seasonName: string; categoryId: number; categoryName: string; points: number }>();
  for (const e of history) {
    const k = `${e.seasonId}:${e.categoryId}`;
    const t = totals.get(k) ?? { seasonId: e.seasonId, seasonName: e.seasonName, categoryId: e.categoryId, categoryName: e.categoryName, points: 0 };
    t.points += e.points;
    totals.set(k, t);
  }
  const summary: PublicPlayer["summary"] = [];
  for (const t of [...totals.values()].slice(0, 8)) {
    const season = seasons.find((s) => s.id === t.seasonId);
    let position: number | null = null;
    let tied = false;
    let total = 0;
    if (season) {
      const rows = (await computeRankings(db, season.id, t.categoryId, null, season.tiebreakers)).get(t.categoryId) ?? [];
      const row = rows.find((r) => r.playerId === p.id);
      position = row?.position ?? null;
      tied = row?.tied ?? false;
      total = rows.length;
    }
    summary.push({ ...t, position, tied, total });
  }
  return { code: p.code, firstName: p.first_name, lastName: p.last_name, nickname: p.nickname, categoryName: p.category_name, gender: p.gender, summary, history };
}
