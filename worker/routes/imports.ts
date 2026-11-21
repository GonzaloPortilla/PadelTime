import { Hono } from "hono";
import { importSchema } from "@shared/schemas";
import { GENDER_LABEL, GENDERS, type Gender } from "@shared/constants";
import type { BracketImportRecord, DirectoryEntry } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { loadScoring, loadTeams, loadTournamentCtx, lockReason, fixtureLockReason } from "../lib/scoring-data";

export const directoryRoutes = new Hono<AppEnv>();

/** Directorio compacto de jugadores de una rama, para vincular nombres leídos por OCR. */
directoryRoutes.get("/directory", async (c) => {
  const gender = c.req.query("gender");
  if (!gender || !(GENDERS as readonly string[]).includes(gender)) throw badRequest("Indicá la rama");
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.code, p.first_name, p.last_name, p.nickname, p.gender, p.main_category_id, c.name AS category_name, p.active
       FROM players p JOIN categories c ON c.id = p.main_category_id
      WHERE p.gender = ? ORDER BY p.last_name, p.first_name LIMIT 5000`,
  )
    .bind(gender)
    .all<{ id: number; code: string; first_name: string; last_name: string; nickname: string | null; gender: Gender; main_category_id: number; category_name: string; active: number }>();
  const items: DirectoryEntry[] = results.map((r) => ({
    id: r.id, code: r.code, firstName: r.first_name, lastName: r.last_name, nickname: r.nickname, gender: r.gender,
    mainCategoryId: r.main_category_id, mainCategoryName: r.category_name, active: r.active === 1,
  }));
  return c.json({ items });
});

export const importRoutes = new Hono<AppEnv>();

importRoutes.get("/:id/imports", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const { results } = await c.env.DB.prepare(
    `SELECT bi.*, u.display_name AS created_by_name FROM bracket_imports bi LEFT JOIN users u ON u.id = bi.created_by
      WHERE bi.tournament_id = ? ORDER BY bi.id DESC LIMIT 50`,
  )
    .bind(id)
    .all<{ id: number; file_name: string | null; recognition_mode: BracketImportRecord["recognitionMode"]; import_mode: BracketImportRecord["importMode"]; team_count: number; created_players: number; corrected_fields: number; elapsed_ms: number | null; warnings: string; created_at: string; created_by_name: string | null }>();
  const items: BracketImportRecord[] = results.map((r) => ({
    id: r.id, fileName: r.file_name, recognitionMode: r.recognition_mode, importMode: r.import_mode, teamCount: r.team_count,
    createdPlayers: r.created_players, correctedFields: r.corrected_fields, elapsedMs: r.elapsed_ms,
    warnings: safeJson(r.warnings), createdAt: r.created_at, createdByName: r.created_by_name,
  }));
  return c.json({ items });
});

function safeJson(v: string): string[] {
  try {
    const x: unknown = JSON.parse(v);
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Guarda el resultado de un cuadro revisado por el organizador: parejas, instancias y partidos.
 * NO acredita puntos: después hay que previsualizar y confirmar en "Acreditación".
 *  - reemplazar: borra las parejas actuales del torneo y carga las del cuadro;
 *  - agregar: suma las parejas nuevas y actualiza los resultados de las que ya estaban (misma dupla).
 */
importRoutes.post("/:id/import", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const input = await parseBody(c, importSchema);
  const db = c.env.DB;
  const t = await loadTournamentCtx(db, id);
  const locked = lockReason(t) ?? (await fixtureLockReason(db, id));
  if (locked) throw conflict(locked);
  const [scoring, existing] = await Promise.all([loadScoring(db, id), loadTeams(db, id)]);

  // Validaciones de las parejas recibidas.
  const stageIds = new Set((scoring?.stages ?? []).map((s) => s.id));
  const seen = new Set<number>();
  for (const team of input.teams) {
    if (team.stageId !== null && !stageIds.has(team.stageId)) throw badRequest("Una instancia no pertenece a la puntuación del torneo");
    for (const pid of [team.player1Id, team.player2Id]) {
      if (seen.has(pid)) throw badRequest("Un jugador figura en más de una pareja del cuadro");
      seen.add(pid);
    }
  }
  const ids = [...seen];
  const { results: players } = await db
    .prepare(`SELECT p.id, p.first_name, p.last_name, p.gender, p.active FROM players p WHERE p.id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<{ id: number; first_name: string; last_name: string; gender: Gender; active: number }>();
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const pid of ids) {
    const p = byId.get(pid);
    if (!p) throw badRequest("Uno de los jugadores no existe");
    if (p.active !== 1) throw badRequest(`${p.first_name} ${p.last_name} está inactivo: reactivalo o elegí otro jugador`);
    if (p.gender !== t.gender) throw badRequest(`${p.first_name} ${p.last_name} no es de la rama ${GENDER_LABEL[t.gender]}`);
  }

  // En modo "agregar": la misma dupla se actualiza; un jugador ya inscripto con otra pareja es un conflicto.
  const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const existingByPair = new Map(existing.filter((e) => e.players.length === 2).map((e) => [pairKey(e.players[0]!.id, e.players[1]!.id), e]));
  const updates: { teamId: number; stageId: number | null; matchesPlayed: number; matchesWon: number }[] = [];
  const inserts: typeof input.teams = [];
  if (input.mode === "agregar") {
    const registered = new Map(existing.flatMap((e) => e.players.map((p) => [p.id, e.id] as const)));
    for (const team of input.teams) {
      const same = existingByPair.get(pairKey(team.player1Id, team.player2Id));
      if (same) {
        updates.push({ teamId: same.id, stageId: team.stageId, matchesPlayed: team.matchesPlayed, matchesWon: team.matchesWon });
        continue;
      }
      for (const pid of [team.player1Id, team.player2Id]) {
        if (registered.has(pid)) {
          const p = byId.get(pid)!;
          throw conflict(`${p.first_name} ${p.last_name} ya está inscripto en el torneo con otra pareja. Usá "Reemplazar" o corregí la pareja.`);
        }
      }
      inserts.push(team);
    }
  } else {
    inserts.push(...input.teams);
  }

  const userId = c.get("user").id;
  const now = new Date().toISOString();
  const marker = `ocr-import-${crypto.randomUUID()}`;
  const insertJson = JSON.stringify(inserts.map((tm, i) => ({ ...tm, key: `${marker}:${i}` })));
  const stmts: D1PreparedStatement[] = [];
  if (input.mode === "reemplazar") {
    stmts.push(db.prepare("DELETE FROM tournament_teams WHERE tournament_id = ?").bind(id));
  }
  if (inserts.length) {
    // Las parejas nuevas se insertan con una marca temporal en "notes" para poder vincular
    // a sus integrantes dentro del mismo batch; al final la marca se borra.
    stmts.push(
      db
        .prepare(
          `INSERT INTO tournament_teams (tournament_id, stage_id, matches_played, matches_won, notes, updated_at)
           SELECT ?1, json_extract(value, '$.stageId'), json_extract(value, '$.matchesPlayed'), json_extract(value, '$.matchesWon'), json_extract(value, '$.key'), ?2
             FROM json_each(?3)`,
        )
        .bind(id, now, insertJson),
      db
        .prepare(
          `INSERT INTO tournament_team_players (team_id, tournament_id, player_id, ranking_category_id)
           SELECT tt.id, ?1, p.id, p.main_category_id
             FROM json_each(?2) j
             JOIN tournament_teams tt ON tt.tournament_id = ?1 AND tt.notes = json_extract(j.value, '$.key')
             JOIN players p ON p.id IN (json_extract(j.value, '$.player1Id'), json_extract(j.value, '$.player2Id'))`,
        )
        .bind(id, insertJson),
      db.prepare("UPDATE tournament_teams SET notes = NULL WHERE tournament_id = ? AND notes LIKE ?").bind(id, `${marker}:%`),
    );
  }
  if (updates.length) {
    const json = JSON.stringify(updates);
    stmts.push(
      db
        .prepare(
          `UPDATE tournament_teams
              SET stage_id = (SELECT json_extract(value, '$.stageId') FROM json_each(?1) WHERE json_extract(value, '$.teamId') = tournament_teams.id),
                  matches_played = (SELECT json_extract(value, '$.matchesPlayed') FROM json_each(?1) WHERE json_extract(value, '$.teamId') = tournament_teams.id),
                  matches_won = (SELECT json_extract(value, '$.matchesWon') FROM json_each(?1) WHERE json_extract(value, '$.teamId') = tournament_teams.id),
                  updated_at = ?3
            WHERE tournament_id = ?2 AND id IN (SELECT json_extract(value, '$.teamId') FROM json_each(?1))`,
        )
        .bind(json, id, now),
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO bracket_imports (tournament_id, file_name, recognition_mode, import_mode, team_count, created_players, corrected_fields, elapsed_ms, warnings, summary, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.source.fileName, input.source.recognitionMode, input.mode, input.teams.length, input.source.createdPlayers,
        input.source.correctedFields, input.source.elapsedMs, JSON.stringify(input.source.warnings), JSON.stringify(input.source.summary), userId),
    auditStmt(db, userId, "importar", "torneo", id,
      `${t.name}: importó un cuadro (${input.teams.length} parejas, ${input.mode === "reemplazar" ? "reemplazando" : "agregando"}${input.source.createdPlayers ? `, ${input.source.createdPlayers} jugadores nuevos` : ""})`),
  );
  await db.batch(stmts);
  return c.json({ items: await loadTeams(db, id), inserted: inserts.length, updated: updates.length }, 201);
});
