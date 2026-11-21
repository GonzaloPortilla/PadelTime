import { Hono } from "hono";
import { resultsSchema, teamSchema } from "@shared/schemas";
import { GENDER_LABEL, type Gender } from "@shared/constants";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { loadScoring, loadTeams, loadTournamentCtx, lockReason, type TournamentCtx } from "../lib/scoring-data";

/** Fase 9: una pareja que ya está en el fixture queda fija (no se cambian sus jugadores ni se borra). */
async function inFixture(db: D1Database, teamId: number): Promise<boolean> {
  const r = await db.prepare(
    `SELECT EXISTS (SELECT 1 FROM fixture_group_teams WHERE team_id = ?1)
         OR EXISTS (SELECT 1 FROM fixture_matches WHERE team1_id = ?1 OR team2_id = ?1) AS used`,
  ).bind(teamId).first<{ used: number }>();
  return r?.used === 1;
}

/** Cupo de parejas configurado en el fixture (null = sin límite). */
async function teamCap(db: D1Database, tournamentId: number): Promise<number | null> {
  const r = await db.prepare("SELECT json_extract(config, '$.maxTeams') AS cap FROM tournament_fixtures WHERE tournament_id = ?").bind(tournamentId).first<{ cap: number | null }>();
  return r?.cap ?? null;
}

async function assertEditable(db: D1Database, tournamentId: number): Promise<TournamentCtx> {
  const t = await loadTournamentCtx(db, tournamentId);
  const locked = lockReason(t);
  if (locked) throw conflict(locked);
  return t;
}

/** Los dos jugadores deben existir, estar activos y ser de la rama del torneo. */
async function assertPlayers(db: D1Database, t: TournamentCtx, ids: number[]) {
  const { results } = await db
    .prepare(`SELECT id, first_name, last_name, gender, active FROM players WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: number; first_name: string; last_name: string; gender: Gender; active: number }>();
  for (const [i, pid] of ids.entries()) {
    const field = i === 0 ? "player1Id" : "player2Id";
    const p = results.find((r) => r.id === pid);
    if (!p) throw badRequest("El jugador no existe", { [field]: "Jugador inexistente" });
    if (p.active !== 1) throw badRequest(`${p.first_name} ${p.last_name} está inactivo`, { [field]: "Jugador inactivo" });
    if (p.gender !== t.gender) {
      throw badRequest(`${p.first_name} ${p.last_name} no es de la rama ${GENDER_LABEL[t.gender]}`, { [field]: "Rama distinta a la del torneo" });
    }
  }
  return results;
}

const insertPlayersSql = (teamExpr: string) => `
  INSERT INTO tournament_team_players (team_id, tournament_id, player_id, ranking_category_id)
  SELECT ${teamExpr}, ?1, p.id, p.main_category_id FROM players p WHERE p.id = ?2
  UNION ALL
  SELECT ${teamExpr}, ?1, p.id, p.main_category_id FROM players p WHERE p.id = ?3`;

export const tournamentTeamRoutes = new Hono<AppEnv>();

tournamentTeamRoutes.get("/:id/teams", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const t = await loadTournamentCtx(c.env.DB, id);
  return c.json({ items: await loadTeams(c.env.DB, id), locked: lockReason(t) });
});

tournamentTeamRoutes.post("/:id/teams", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const input = await parseBody(c, teamSchema);
  const db = c.env.DB;
  const t = await assertEditable(db, id);
  const players = await assertPlayers(db, t, [input.player1Id, input.player2Id]);
  const cap = await teamCap(db, id);
  if (cap !== null) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?").bind(id).first<{ n: number }>();
    if ((n?.n ?? 0) >= cap) throw conflict(`Se alcanzó el cupo de ${cap} parejas configurado en el fixture`);
  }
  const names = players.map((p) => p.last_name).join(" / ");
  const teamExpr = "(SELECT MAX(id) FROM tournament_teams WHERE tournament_id = ?1)";
  await db.batch([
    db.prepare("INSERT INTO tournament_teams (tournament_id, seed, updated_at) VALUES (?, ?, ?)").bind(id, input.seed, new Date().toISOString()),
    db.prepare(insertPlayersSql(teamExpr)).bind(id, input.player1Id, input.player2Id),
    auditStmt(db, c.get("user").id, "crear", "pareja", id, `${t.name}: inscribió la pareja ${names}`),
  ]);
  return c.json({ items: await loadTeams(db, id) }, 201);
});

/** Carga masiva de resultados: instancia alcanzada y partidos de cada pareja, en un solo paso. */
tournamentTeamRoutes.put("/:id/results", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const { results } = await parseBody(c, resultsSchema);
  const db = c.env.DB;
  const t = await assertEditable(db, id);
  const [scoring, teams] = await Promise.all([loadScoring(db, id), loadTeams(db, id)]);
  const teamIds = new Set(teams.map((tm) => tm.id));
  const stageIds = new Set((scoring?.stages ?? []).map((s) => s.id));
  for (const r of results) {
    if (!teamIds.has(r.teamId)) throw badRequest("Una de las parejas no pertenece al torneo");
    if (r.stageId !== null && !stageIds.has(r.stageId)) throw badRequest("Una de las instancias no pertenece al torneo");
  }
  if (new Set(results.map((r) => r.teamId)).size !== results.length) throw badRequest("Hay parejas repetidas en la carga");
  if (results.length === 0) return c.json({ items: teams });
  const json = JSON.stringify(results);
  await db.batch([
    db
      .prepare(
        `UPDATE tournament_teams
            SET stage_id = (SELECT json_extract(value, '$.stageId') FROM json_each(?1) WHERE json_extract(value, '$.teamId') = tournament_teams.id),
                matches_played = (SELECT json_extract(value, '$.matchesPlayed') FROM json_each(?1) WHERE json_extract(value, '$.teamId') = tournament_teams.id),
                matches_won = (SELECT json_extract(value, '$.matchesWon') FROM json_each(?1) WHERE json_extract(value, '$.teamId') = tournament_teams.id),
                updated_at = ?3
          WHERE tournament_id = ?2 AND id IN (SELECT json_extract(value, '$.teamId') FROM json_each(?1))`,
      )
      .bind(json, id, new Date().toISOString()),
    auditStmt(db, c.get("user").id, "editar", "resultados", id, `${t.name}: cargó resultados de ${results.length} pareja${results.length === 1 ? "" : "s"}`),
  ]);
  return c.json({ items: await loadTeams(db, id) });
});

export const teamRoutes = new Hono<AppEnv>();

async function teamTournament(db: D1Database, teamId: number) {
  const row = await db.prepare("SELECT tournament_id FROM tournament_teams WHERE id = ?").bind(teamId).first<{ tournament_id: number }>();
  if (!row) throw notFound("La pareja");
  return row.tournament_id;
}

teamRoutes.put("/:id", async (c) => {
  const teamId = parseId(c.req.param("id"), "La pareja");
  const input = await parseBody(c, teamSchema);
  const db = c.env.DB;
  const tournamentId = await teamTournament(db, teamId);
  const t = await assertEditable(db, tournamentId);
  const players = await assertPlayers(db, t, [input.player1Id, input.player2Id]);
  if (await inFixture(db, teamId)) {
    const current = await db.prepare("SELECT player_id FROM tournament_team_players WHERE team_id = ? ORDER BY player_id").bind(teamId).all<{ player_id: number }>();
    const same = current.results.map((r) => r.player_id).join(",") === [input.player1Id, input.player2Id].sort((a, b) => a - b).join(",");
    if (!same) throw conflict("La pareja ya está en el fixture: sus jugadores quedan fijos durante la competencia. Si no puede seguir, registrá su retiro.");
  }
  await db.batch([
    db.prepare("UPDATE tournament_teams SET seed = ?, updated_at = ? WHERE id = ?").bind(input.seed, new Date().toISOString(), teamId),
    db.prepare("DELETE FROM tournament_team_players WHERE team_id = ?").bind(teamId),
    db.prepare(insertPlayersSql(String(teamId))).bind(tournamentId, input.player1Id, input.player2Id),
    auditStmt(db, c.get("user").id, "editar", "pareja", tournamentId, `${t.name}: editó la pareja ${players.map((p) => p.last_name).join(" / ")}`),
  ]);
  return c.json({ items: await loadTeams(db, tournamentId) });
});

teamRoutes.delete("/:id", async (c) => {
  const teamId = parseId(c.req.param("id"), "La pareja");
  const db = c.env.DB;
  const tournamentId = await teamTournament(db, teamId);
  const t = await assertEditable(db, tournamentId);
  if (await inFixture(db, teamId)) throw conflict("La pareja ya está en el fixture (grupos o partidos). Registrá su retiro desde la pestaña Fixture.");
  await db.batch([
    db.prepare("DELETE FROM tournament_teams WHERE id = ?").bind(teamId),
    auditStmt(db, c.get("user").id, "eliminar", "pareja", tournamentId, `${t.name}: quitó una pareja`),
  ]);
  return c.json({ items: await loadTeams(db, tournamentId) });
});
