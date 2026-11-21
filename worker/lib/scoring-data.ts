import { computePreview, previewFingerprint, type Preview, type ScoringConfig, type StageConfig } from "@shared/scoring";
import type { Gender, SeasonStatus, TournamentStatus } from "@shared/constants";
import type { CreditSummary, Team, TournamentScoring } from "@shared/types";
import { sha256Hex } from "./encoding";
import { notFound } from "./errors";

export interface TournamentCtx {
  id: number;
  name: string;
  seasonId: number;
  seasonStatus: SeasonStatus;
  categoryId: number;
  divisionId: number | null;
  gender: Gender;
  status: TournamentStatus;
}

export async function loadTournamentCtx(db: D1Database, id: number): Promise<TournamentCtx> {
  const row = await db
    .prepare(
      `SELECT t.id, t.name, t.season_id, s.status AS season_status, t.category_id, t.division_id, c.gender, t.status
         FROM tournaments t JOIN seasons s ON s.id = t.season_id JOIN categories c ON c.id = t.category_id
        WHERE t.id = ?`,
    )
    .bind(id)
    .first<{ id: number; name: string; season_id: number; season_status: SeasonStatus; category_id: number; division_id: number | null; gender: Gender; status: TournamentStatus }>();
  if (!row) throw notFound("El torneo");
  return {
    id: row.id, name: row.name, seasonId: row.season_id, seasonStatus: row.season_status, categoryId: row.category_id,
    divisionId: row.division_id, gender: row.gender, status: row.status,
  };
}

/** Un torneo de una temporada cerrada o cancelado no admite cambios de parejas, resultados ni puntuación. */
export function lockReason(t: TournamentCtx): string | null {
  if (t.seasonStatus === "cerrada") return "La temporada está cerrada: el torneo es de sólo lectura.";
  if (t.status === "cancelado") return "El torneo está cancelado. Reprogramalo para modificarlo.";
  return null;
}

interface StageRow { id: number; label: string; rank: number; points: number; max_teams: number | null }
export const mapStage = (s: StageRow): StageConfig => ({ id: s.id, label: s.label, rank: s.rank, points: s.points, maxTeams: s.max_teams });

export async function loadScoring(db: D1Database, tournamentId: number): Promise<TournamentScoring | null> {
  const [cfg, stages] = await db.batch([
    db.prepare("SELECT * FROM tournament_scoring WHERE tournament_id = ?").bind(tournamentId),
    db.prepare("SELECT id, label, rank, points, max_teams FROM tournament_stages WHERE tournament_id = ? ORDER BY rank").bind(tournamentId),
  ]);
  const c = cfg!.results[0] as
    | { template_id: number | null; template_name: string | null; cumulative: number; participation_bonus: number; match_played_bonus: number; match_won_bonus: number; rules_notes: string | null; updated_at: string }
    | undefined;
  if (!c) return null;
  return {
    templateId: c.template_id,
    templateName: c.template_name,
    cumulative: c.cumulative === 1,
    participationBonus: c.participation_bonus,
    matchPlayedBonus: c.match_played_bonus,
    matchWonBonus: c.match_won_bonus,
    rulesNotes: c.rules_notes,
    updatedAt: c.updated_at,
    stages: (stages!.results as StageRow[]).map(mapStage),
  };
}

export async function loadTeams(db: D1Database, tournamentId: number): Promise<Team[]> {
  const { results } = await db
    .prepare(
      `SELECT tt.id, tt.seed, tt.stage_id, tt.matches_played, tt.matches_won, tt.withdrawn_at, tt.withdrawn_reason,
              p.id AS pid, p.code, p.first_name, p.last_name, p.gender, p.main_category_id, c.name AS category_name, p.active
         FROM tournament_teams tt
         LEFT JOIN tournament_team_players ttp ON ttp.team_id = tt.id
         LEFT JOIN players p ON p.id = ttp.player_id
         LEFT JOIN categories c ON c.id = p.main_category_id
        WHERE tt.tournament_id = ?
        ORDER BY tt.seed IS NULL, tt.seed, tt.id, ttp.rowid`,
    )
    .bind(tournamentId)
    .all<{
      id: number; seed: number | null; stage_id: number | null; matches_played: number; matches_won: number; withdrawn_at: string | null; withdrawn_reason: string | null;
      pid: number | null; code: string; first_name: string; last_name: string; gender: Gender; main_category_id: number; category_name: string; active: number;
    }>();
  const teams = new Map<number, Team>();
  for (const r of results) {
    let team = teams.get(r.id);
    if (!team) {
      team = { id: r.id, seed: r.seed, stageId: r.stage_id, matchesPlayed: r.matches_played, matchesWon: r.matches_won, withdrawnAt: r.withdrawn_at, withdrawnReason: r.withdrawn_reason, players: [] };
      teams.set(r.id, team);
    }
    if (r.pid !== null) {
      team.players.push({
        id: r.pid, code: r.code, firstName: r.first_name, lastName: r.last_name, gender: r.gender,
        mainCategoryId: r.main_category_id, mainCategoryName: r.category_name, active: r.active === 1,
      });
    }
  }
  return [...teams.values()];
}

interface CreditRow {
  id: number; version: number; status: CreditSummary["status"]; total_points: number; player_count: number; team_count: number;
  reason: string | null; created_at: string; created_by_name: string | null; closed_at: string | null; closed_by_name: string | null;
  close_reason: string | null; preview_hash: string;
}

const CREDIT_SELECT = `
  SELECT cr.id, cr.version, cr.status, cr.total_points, cr.player_count, cr.team_count, cr.reason, cr.created_at,
         uc.display_name AS created_by_name, cr.closed_at, ux.display_name AS closed_by_name, cr.close_reason, cr.preview_hash
    FROM tournament_credits cr
    LEFT JOIN users uc ON uc.id = cr.created_by
    LEFT JOIN users ux ON ux.id = cr.closed_by`;

export const mapCredit = (r: CreditRow): CreditSummary => ({
  id: r.id, version: r.version, status: r.status, totalPoints: r.total_points, playerCount: r.player_count, teamCount: r.team_count,
  reason: r.reason, createdAt: r.created_at, createdByName: r.created_by_name, closedAt: r.closed_at, closedByName: r.closed_by_name,
  closeReason: r.close_reason,
});

export async function loadCredits(db: D1Database, tournamentId: number) {
  const { results } = await db.prepare(`${CREDIT_SELECT} WHERE cr.tournament_id = ? ORDER BY cr.version DESC`).bind(tournamentId).all<CreditRow>();
  return results;
}

export async function loadActiveCredit(db: D1Database, tournamentId: number) {
  return db.prepare(`${CREDIT_SELECT} WHERE cr.tournament_id = ? AND cr.status = 'vigente'`).bind(tournamentId).first<CreditRow>();
}

/** Puntos acreditados (vigentes) por jugador, para comparar con una corrección. */
export async function loadCreditedRows(db: D1Database, creditId: number) {
  const { results } = await db
    .prepare(
      `SELECT m.player_id, p.first_name || ' ' || p.last_name AS name, p.code, c.name AS category_name, m.points, m.stage_label
         FROM point_movements m JOIN players p ON p.id = m.player_id JOIN categories c ON c.id = m.category_id
        WHERE m.credit_id = ? AND m.kind = 'acreditacion'`,
    )
    .bind(creditId)
    .all<{ player_id: number; name: string; code: string; category_name: string; points: number; stage_label: string | null }>();
  return results.map((r) => ({ playerId: r.player_id, name: r.name, code: r.code, categoryName: r.category_name, points: r.points, stageLabel: r.stage_label }));
}

/** Categoría en la que cada jugador recibió los puntos de la acreditación vigente del torneo. */
async function loadCreditedCategories(db: D1Database, tournamentId: number) {
  const { results } = await db
    .prepare(
      `SELECT m.player_id, m.category_id, c.name AS category_name
         FROM point_movements m
         JOIN tournament_credits cr ON cr.id = m.credit_id AND cr.status = 'vigente'
         JOIN categories c ON c.id = m.category_id
        WHERE m.tournament_id = ? AND m.kind = 'acreditacion'`,
    )
    .bind(tournamentId)
    .all<{ player_id: number; category_id: number; category_name: string }>();
  return new Map(results.map((r) => [r.player_id, { categoryId: r.category_id, categoryName: r.category_name }]));
}

export interface ComputedPreview {
  tournament: TournamentCtx;
  scoring: ScoringConfig | null;
  preview: Preview;
  hash: string;
}

/** Calcula la previsualización con los datos actuales de la base. */
export async function buildPreview(db: D1Database, tournamentId: number, override?: (teams: Team[]) => Team[]): Promise<ComputedPreview> {
  const tournament = await loadTournamentCtx(db, tournamentId);
  const [scoring, loaded, credited] = await Promise.all([
    loadScoring(db, tournamentId),
    loadTeams(db, tournamentId),
    loadCreditedCategories(db, tournamentId),
  ]);
  // Fase 10: el fixture puede pedir la previsualización con las instancias que propone (sin guardarlas).
  const teams = override ? override(loaded) : loaded;
  // Quien ya recibió puntos de este torneo los conserva en la categoría donde se acreditaron,
  // aunque después haya cambiado de categoría principal (ascenso/descenso): una corrección
  // del torneo no debe mudar puntos históricos a otro ranking.
  const moved: string[] = [];
  for (const team of teams) {
    for (const p of team.players) {
      const prev = credited.get(p.id);
      if (prev && prev.categoryId !== p.mainCategoryId) {
        moved.push(`${p.firstName} ${p.lastName} (acreditado en ${prev.categoryName}, hoy en ${p.mainCategoryName})`);
        p.mainCategoryId = prev.categoryId;
        p.mainCategoryName = prev.categoryName;
      }
    }
  }
  const preview = computePreview(scoring, teams, tournament);
  if (moved.length) {
    preview.issues.push({
      level: "warning",
      code: "categoria_acreditada",
      message: `Cambiaron de categoría principal después de la acreditación: ${moved.join(", ")}. Sus puntos de este torneo se mantienen en la categoría donde se acreditaron.`,
    });
  }
  const hash = await sha256Hex(`${tournamentId}|${tournament.seasonId}|${previewFingerprint(preview.rows)}`);
  return { tournament, scoring, preview, hash };
}

/**
 * Fase 10: un torneo largo con partidos en el fixture toma las instancias de sus parejas del fixture
 * (Fixture → Puntos). Así no hay dos fuentes de verdad: se bloquea la carga manual y la importación de cuadro.
 */
export async function fixtureLockReason(db: D1Database, tournamentId: number): Promise<string | null> {
  const r = await db.prepare("SELECT EXISTS (SELECT 1 FROM fixture_matches WHERE tournament_id = ?) AS has").bind(tournamentId).first<{ has: number }>();
  return r?.has === 1 ? "Este torneo tiene fixture: las instancias de las parejas se completan desde Fixture → Puntos." : null;
}
