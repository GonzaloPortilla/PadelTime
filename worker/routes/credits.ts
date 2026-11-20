import { Hono } from "hono";
import { confirmCreditSchema, revertCreditSchema } from "@shared/schemas";
import { diffCredit } from "@shared/scoring";
import type { TournamentPreviewResponse } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, HttpError } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { buildPreview, loadActiveCredit, loadCreditedRows, loadCredits, lockReason, mapCredit } from "../lib/scoring-data";

/**
 * Contraasiento: inserta, en UNA sentencia, un movimiento negativo por cada movimiento de la
 * acreditación indicada. `reverses_movement_id` es UNIQUE: un movimiento nunca se revierte dos veces.
 */
const REVERSAL_SQL = `
  INSERT INTO point_movements (season_id, player_id, category_id, division_id, kind, points, stage_points, bonus_points,
                               tournament_id, credit_id, team_id, partner_name, stage_label, stage_rank, matches_played,
                               matches_won, reverses_movement_id, reason, created_by)
  SELECT season_id, player_id, category_id, division_id, 'reversion', -points, -stage_points, -bonus_points,
         tournament_id, credit_id, team_id, partner_name, stage_label, stage_rank, matches_played,
         matches_won, id, ?2, ?3
    FROM point_movements
   WHERE credit_id = ?1 AND kind = 'acreditacion'`;

export const creditRoutes = new Hono<AppEnv>();

creditRoutes.get("/:id/preview", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const db = c.env.DB;
  const { tournament, preview, hash } = await buildPreview(db, id);
  const active = await loadActiveCredit(db, id);
  const body: TournamentPreviewResponse = {
    ...preview,
    previewHash: hash,
    activeCredit: active ? mapCredit(active) : null,
    upToDate: active?.preview_hash === hash,
    diff: active ? diffCredit(await loadCreditedRows(db, active.id), preview.rows) : null,
    locked: lockReason(tournament) !== null,
  };
  return c.json(body);
});

creditRoutes.get("/:id/credits", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  return c.json({ items: (await loadCredits(c.env.DB, id)).map(mapCredit) });
});

/**
 * Confirma la acreditación (o una corrección, si ya hay una vigente).
 * El cliente envía la huella de la previsualización que vio el organizador: si los datos
 * cambiaron desde entonces, se rechaza para que vuelva a revisar.
 */
creditRoutes.post("/:id/credits", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const input = await parseBody(c, confirmCreditSchema);
  const db = c.env.DB;
  const userId = c.get("user").id;
  const { tournament, preview, hash } = await buildPreview(db, id);

  const locked = lockReason(tournament);
  if (locked) throw conflict(locked);
  if (tournament.status === "programado") {
    throw conflict("El torneo figura como programado. Iniciá el torneo antes de acreditar sus puntos.");
  }
  if (!preview.canConfirm) {
    throw badRequest("Hay errores en los resultados que impiden acreditar: " + preview.issues.filter((i) => i.level === "error").map((i) => i.message).join(" "));
  }
  if (input.previewHash !== hash) {
    throw new HttpError(409, "previsualizacion_desactualizada", "Los resultados cambiaron desde que se generó la previsualización. Revisala de nuevo antes de confirmar.");
  }

  const active = await loadActiveCredit(db, id);
  if (active && active.preview_hash === hash) {
    throw conflict(`El torneo ya está acreditado (versión ${active.version}) con estos mismos resultados. No se acredita dos veces.`);
  }
  if (active && !input.reason) {
    throw badRequest("Indicá el motivo de la corrección", { reason: "El motivo es obligatorio en una corrección" });
  }

  const rowsJson = JSON.stringify(preview.rows);
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];

  if (active) {
    // Corrección: la acreditación anterior queda "reemplazada" y se contraasientan todos sus movimientos.
    stmts.push(
      db
        .prepare("UPDATE tournament_credits SET status = 'reemplazada', closed_at = ?, closed_by = ?, close_reason = ? WHERE id = ? AND status = 'vigente'")
        .bind(now, userId, input.reason, active.id),
      db.prepare(REVERSAL_SQL).bind(active.id, `Corrección: ${input.reason}`, userId),
    );
  }

  stmts.push(
    // Si otra persona acreditó al mismo tiempo, el índice único de "vigente" hace fallar este INSERT
    // y D1 deshace todo el batch: nunca quedan dos acreditaciones vigentes.
    db
      .prepare(
        `INSERT INTO tournament_credits (tournament_id, season_id, version, status, preview_hash, total_points, player_count, team_count, reason, replaces_credit_id, created_by)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(version), 0) + 1 FROM tournament_credits WHERE tournament_id = ?1), 'vigente', ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(id, tournament.seasonId, hash, preview.totals.points, preview.totals.players, preview.totals.teams, input.reason, active?.id ?? null, userId),
    db
      .prepare(
        `INSERT INTO point_movements (season_id, player_id, category_id, division_id, kind, points, stage_points, bonus_points,
                                      tournament_id, credit_id, team_id, partner_name, stage_label, stage_rank, matches_played, matches_won, created_by)
         SELECT ?1, json_extract(value, '$.playerId'), json_extract(value, '$.categoryId'), json_extract(value, '$.divisionId'), 'acreditacion',
                json_extract(value, '$.points'), json_extract(value, '$.stagePoints'), json_extract(value, '$.bonusPoints'),
                ?2, (SELECT id FROM tournament_credits WHERE tournament_id = ?2 AND status = 'vigente'),
                json_extract(value, '$.teamId'), json_extract(value, '$.partnerName'), json_extract(value, '$.stageLabel'),
                json_extract(value, '$.stageRank'), json_extract(value, '$.matchesPlayed'), json_extract(value, '$.matchesWon'), ?3
           FROM json_each(?4)`,
      )
      .bind(tournament.seasonId, id, userId, rowsJson),
    // Deja registrada en la inscripción la categoría que efectivamente recibió los puntos.
    db
      .prepare(
        `UPDATE tournament_team_players
            SET ranking_category_id = (SELECT json_extract(value, '$.categoryId') FROM json_each(?1) WHERE json_extract(value, '$.playerId') = tournament_team_players.player_id)
          WHERE tournament_id = ?2`,
      )
      .bind(rowsJson, id),
    db.prepare("UPDATE tournaments SET status = 'finalizado', updated_at = ? WHERE id = ?").bind(now, id),
    auditStmt(
      db, userId, active ? "corregir" : "acreditar", "torneo", id,
      active
        ? `${tournament.name}: corrigió la acreditación (v${active.version} → v${active.version + 1}). Motivo: ${input.reason}`
        : `${tournament.name}: acreditó ${preview.totals.points} puntos a ${preview.totals.players} jugadores`,
    ),
  );

  await db.batch(stmts);
  const credit = await loadActiveCredit(db, id);
  return c.json({ item: mapCredit(credit!) }, 201);
});

/**
 * Revierte la acreditación vigente: los puntos vuelven a cero mediante contraasientos y el
 * torneo queda listo para volver a acreditarse. Opcionalmente se anula (cancela) el torneo.
 */
creditRoutes.post("/:id/credits/revert", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const { reason, cancelTournament } = await parseBody(c, revertCreditSchema);
  const db = c.env.DB;
  const userId = c.get("user").id;
  const { tournament } = await buildPreview(db, id);
  if (tournament.seasonStatus === "cerrada") throw conflict("La temporada está cerrada: no se pueden revertir puntos.");
  const active = await loadActiveCredit(db, id);
  if (!active) throw conflict("El torneo no tiene una acreditación vigente para revertir.");
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare("UPDATE tournament_credits SET status = 'revertida', closed_at = ?, closed_by = ?, close_reason = ? WHERE id = ? AND status = 'vigente'")
      .bind(now, userId, reason, active.id),
    db.prepare(REVERSAL_SQL).bind(active.id, `${cancelTournament ? "Anulación" : "Reversión"}: ${reason}`, userId),
  ];
  if (cancelTournament) {
    stmts.push(db.prepare("UPDATE tournaments SET status = 'cancelado', updated_at = ? WHERE id = ?").bind(now, id));
  }
  stmts.push(
    auditStmt(db, userId, cancelTournament ? "anular" : "revertir", "torneo", id,
      `${tournament.name}: ${cancelTournament ? "anuló el torneo y revirtió" : "revirtió"} la acreditación v${active.version}. Motivo: ${reason}`),
  );
  await db.batch(stmts);
  return c.json({ ok: true });
});
