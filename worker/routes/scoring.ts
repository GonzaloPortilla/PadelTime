import { Hono } from "hono";
import { applyTemplateSchema, scoringTemplateSchema, tournamentScoringSchema } from "@shared/schemas";
import type { ScoringTemplate } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { loadScoring, loadTeams, loadTournamentCtx, lockReason, mapStage } from "../lib/scoring-data";

interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  default_for_type: ScoringTemplate["defaultForType"];
  active: number;
  cumulative: number;
  participation_bonus: number;
  match_played_bonus: number;
  match_won_bonus: number;
  usage_count: number;
}

async function loadTemplates(db: D1Database, where = "", binds: unknown[] = []): Promise<ScoringTemplate[]> {
  const [tpl, stages] = await db.batch([
    db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM tournament_scoring ts WHERE ts.template_id = t.id) AS usage_count
           FROM scoring_templates t ${where} ORDER BY t.active DESC, t.name`,
      )
      .bind(...binds),
    db.prepare("SELECT id, template_id, label, rank, points, max_teams FROM scoring_template_stages ORDER BY rank"),
  ]);
  const byTemplate = new Map<number, ScoringTemplate["stages"]>();
  for (const s of stages!.results as { id: number; template_id: number; label: string; rank: number; points: number; max_teams: number | null }[]) {
    const list = byTemplate.get(s.template_id) ?? [];
    list.push(mapStage(s));
    byTemplate.set(s.template_id, list);
  }
  return (tpl!.results as TemplateRow[]).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    defaultForType: t.default_for_type,
    active: t.active === 1,
    cumulative: t.cumulative === 1,
    participationBonus: t.participation_bonus,
    matchPlayedBonus: t.match_played_bonus,
    matchWonBonus: t.match_won_bonus,
    stages: byTemplate.get(t.id) ?? [],
    usageCount: t.usage_count,
  }));
}

async function getTemplate(db: D1Database, id: number) {
  const [t] = await loadTemplates(db, "WHERE t.id = ?", [id]);
  if (!t) throw notFound("La plantilla");
  return t;
}

/** Instancias en orden (la primera es el campeón) → JSON para insertar en un solo statement. */
const stagesJson = (stages: { id?: number; label: string; points: number; maxTeams: number | null }[]) =>
  JSON.stringify(stages.map((s, i) => ({ id: s.id ?? null, label: s.label, rank: i + 1, points: s.points, maxTeams: s.maxTeams })));

// ───────────────────────────── Plantillas ─────────────────────────────
export const templateRoutes = new Hono<AppEnv>();

templateRoutes.get("/", async (c) => c.json({ items: await loadTemplates(c.env.DB) }));

templateRoutes.get("/:id", async (c) => c.json({ item: await getTemplate(c.env.DB, parseId(c.req.param("id"), "La plantilla")) }));

templateRoutes.post("/", async (c) => {
  const input = await parseBody(c, scoringTemplateSchema);
  const db = c.env.DB;
  const stmts: D1PreparedStatement[] = [];
  if (input.defaultForType) {
    stmts.push(db.prepare("UPDATE scoring_templates SET default_for_type = NULL WHERE default_for_type = ?").bind(input.defaultForType));
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO scoring_templates (name, description, default_for_type, active, cumulative, participation_bonus, match_played_bonus, match_won_bonus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.name, input.description, input.defaultForType, input.active ? 1 : 0, input.cumulative ? 1 : 0,
        input.participationBonus, input.matchPlayedBonus, input.matchWonBonus),
    db
      .prepare(
        `INSERT INTO scoring_template_stages (template_id, label, rank, points, max_teams)
         SELECT (SELECT MAX(id) FROM scoring_templates), json_extract(value, '$.label'), json_extract(value, '$.rank'),
                json_extract(value, '$.points'), json_extract(value, '$.maxTeams')
           FROM json_each(?)`,
      )
      .bind(stagesJson(input.stages)),
    db
      .prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'crear', 'plantilla', (SELECT MAX(id) FROM scoring_templates), ?)")
      .bind(c.get("user").id, `Creó la plantilla de puntuación ${input.name}`),
  );
  await db.batch(stmts);
  const created = await db.prepare("SELECT id FROM scoring_templates WHERE name = ?").bind(input.name).first<{ id: number }>();
  return c.json({ item: await getTemplate(db, created!.id) }, 201);
});

templateRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La plantilla");
  const input = await parseBody(c, scoringTemplateSchema);
  const db = c.env.DB;
  await getTemplate(db, id);
  const stmts: D1PreparedStatement[] = [];
  if (input.defaultForType) {
    stmts.push(db.prepare("UPDATE scoring_templates SET default_for_type = NULL WHERE default_for_type = ? AND id <> ?").bind(input.defaultForType, id));
  }
  stmts.push(
    db
      .prepare(
        `UPDATE scoring_templates SET name = ?, description = ?, default_for_type = ?, active = ?, cumulative = ?, participation_bonus = ?,
                match_played_bonus = ?, match_won_bonus = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(input.name, input.description, input.defaultForType, input.active ? 1 : 0, input.cumulative ? 1 : 0, input.participationBonus,
        input.matchPlayedBonus, input.matchWonBonus, new Date().toISOString(), id),
    // Las instancias de la plantilla no están referenciadas: se reemplazan completas.
    // (Los torneos tienen su propia copia y no se ven afectados.)
    db.prepare("DELETE FROM scoring_template_stages WHERE template_id = ?").bind(id),
    db
      .prepare(
        `INSERT INTO scoring_template_stages (template_id, label, rank, points, max_teams)
         SELECT ?, json_extract(value, '$.label'), json_extract(value, '$.rank'), json_extract(value, '$.points'), json_extract(value, '$.maxTeams')
           FROM json_each(?)`,
      )
      .bind(id, stagesJson(input.stages)),
    auditStmt(db, c.get("user").id, "editar", "plantilla", id, `Editó la plantilla de puntuación ${input.name}`),
  );
  await db.batch(stmts);
  return c.json({ item: await getTemplate(db, id) });
});

templateRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La plantilla");
  const db = c.env.DB;
  const t = await getTemplate(db, id);
  // Los torneos que la usaron conservan su copia (template_id pasa a NULL).
  await db.batch([
    db.prepare("DELETE FROM scoring_templates WHERE id = ?").bind(id),
    auditStmt(db, c.get("user").id, "eliminar", "plantilla", id, `Eliminó la plantilla de puntuación ${t.name}`),
  ]);
  return c.json({ ok: true });
});

// ─────────────────────── Puntuación de un torneo ───────────────────────
export const tournamentScoringRoutes = new Hono<AppEnv>();

tournamentScoringRoutes.get("/:id/scoring", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const t = await loadTournamentCtx(c.env.DB, id);
  return c.json({ item: await loadScoring(c.env.DB, id), locked: lockReason(t) });
});

/** Copia una plantilla al torneo. Las parejas conservan su instancia si existe una con el mismo orden. */
tournamentScoringRoutes.post("/:id/scoring/apply-template", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const { templateId } = await parseBody(c, applyTemplateSchema);
  const db = c.env.DB;
  const t = await loadTournamentCtx(db, id);
  const locked = lockReason(t);
  if (locked) throw conflict(locked);
  const template = await getTemplate(db, templateId);
  const [scoring, teams] = await Promise.all([loadScoring(db, id), loadTeams(db, id)]);
  const rankByStage = new Map((scoring?.stages ?? []).map((s) => [s.id, s.rank]));
  const mapping = JSON.stringify(
    teams.filter((tm) => tm.stageId !== null).map((tm) => ({ teamId: tm.id, rank: rankByStage.get(tm.stageId!) ?? null })),
  );
  const userId = c.get("user").id;
  await db.batch([
    db
      .prepare(
        `INSERT INTO tournament_scoring (tournament_id, template_id, template_name, cumulative, participation_bonus, match_played_bonus, match_won_bonus, rules_notes, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (tournament_id) DO UPDATE SET template_id = excluded.template_id, template_name = excluded.template_name,
           cumulative = excluded.cumulative, participation_bonus = excluded.participation_bonus, match_played_bonus = excluded.match_played_bonus,
           match_won_bonus = excluded.match_won_bonus, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(id, template.id, template.name, template.cumulative ? 1 : 0, template.participationBonus, template.matchPlayedBonus,
        template.matchWonBonus, new Date().toISOString(), userId),
    db.prepare("UPDATE tournament_teams SET stage_id = NULL WHERE tournament_id = ?").bind(id),
    db.prepare("DELETE FROM tournament_stages WHERE tournament_id = ?").bind(id),
    db
      .prepare(
        `INSERT INTO tournament_stages (tournament_id, label, rank, points, max_teams)
         SELECT ?, label, rank, points, max_teams FROM scoring_template_stages WHERE template_id = ?`,
      )
      .bind(id, template.id),
    db
      .prepare(
        `UPDATE tournament_teams
            SET stage_id = (SELECT ts.id FROM tournament_stages ts
                             WHERE ts.tournament_id = tournament_teams.tournament_id
                               AND ts.rank = (SELECT json_extract(m.value, '$.rank') FROM json_each(?1) m
                                               WHERE json_extract(m.value, '$.teamId') = tournament_teams.id))
          WHERE tournament_id = ?2`,
      )
      .bind(mapping, id),
    auditStmt(db, userId, "editar", "torneo", id, `${t.name}: aplicó la plantilla ${template.name}`),
  ]);
  return c.json({ item: await loadScoring(db, id) });
});

/** Edita la puntuación propia del torneo (sin afectar a la plantilla de origen). */
tournamentScoringRoutes.put("/:id/scoring", async (c) => {
  const id = parseId(c.req.param("id"), "El torneo");
  const input = await parseBody(c, tournamentScoringSchema);
  const db = c.env.DB;
  const t = await loadTournamentCtx(db, id);
  const locked = lockReason(t);
  if (locked) throw conflict(locked);
  const [current, teams] = await Promise.all([loadScoring(db, id), loadTeams(db, id)]);
  const currentIds = new Set((current?.stages ?? []).map((s) => s.id));
  for (const s of input.stages) {
    if (s.id !== undefined && !currentIds.has(s.id)) throw badRequest("Una de las instancias no pertenece al torneo");
  }
  const keep = new Set(input.stages.map((s) => s.id).filter((x): x is number => x !== undefined));
  const removed = (current?.stages ?? []).filter((s) => !keep.has(s.id));
  for (const s of removed) {
    const n = teams.filter((tm) => tm.stageId === s.id).length;
    if (n > 0) throw conflict(`No se puede quitar "${s.label}": tiene ${n} pareja${n === 1 ? "" : "s"} asignada${n === 1 ? "" : "s"}.`);
  }
  const json = stagesJson(input.stages);
  const userId = c.get("user").id;
  await db.batch([
    db
      .prepare(
        `INSERT INTO tournament_scoring (tournament_id, template_id, template_name, cumulative, participation_bonus, match_played_bonus, match_won_bonus, rules_notes, updated_at, updated_by)
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tournament_id) DO UPDATE SET cumulative = excluded.cumulative, participation_bonus = excluded.participation_bonus,
           match_played_bonus = excluded.match_played_bonus, match_won_bonus = excluded.match_won_bonus, rules_notes = excluded.rules_notes,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(id, input.cumulative ? 1 : 0, input.participationBonus, input.matchPlayedBonus, input.matchWonBonus, input.rulesNotes,
        new Date().toISOString(), userId),
    db.prepare(`DELETE FROM tournament_stages WHERE tournament_id = ? AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?) WHERE json_extract(value, '$.id') IS NOT NULL)`).bind(id, json),
    // Evita choques de unicidad (orden/nombre) mientras se reordenan instancias existentes.
    db.prepare("UPDATE tournament_stages SET rank = rank + 1000, label = label || ' #' || id WHERE tournament_id = ?").bind(id),
    db
      .prepare(
        `UPDATE tournament_stages
            SET label = (SELECT json_extract(value, '$.label') FROM json_each(?1) WHERE json_extract(value, '$.id') = tournament_stages.id),
                rank = (SELECT json_extract(value, '$.rank') FROM json_each(?1) WHERE json_extract(value, '$.id') = tournament_stages.id),
                points = (SELECT json_extract(value, '$.points') FROM json_each(?1) WHERE json_extract(value, '$.id') = tournament_stages.id),
                max_teams = (SELECT json_extract(value, '$.maxTeams') FROM json_each(?1) WHERE json_extract(value, '$.id') = tournament_stages.id)
          WHERE tournament_id = ?2`,
      )
      .bind(json, id),
    db
      .prepare(
        `INSERT INTO tournament_stages (tournament_id, label, rank, points, max_teams)
         SELECT ?, json_extract(value, '$.label'), json_extract(value, '$.rank'), json_extract(value, '$.points'), json_extract(value, '$.maxTeams')
           FROM json_each(?) WHERE json_extract(value, '$.id') IS NULL`,
      )
      .bind(id, json),
    auditStmt(db, userId, "editar", "torneo", id, `${t.name}: editó la puntuación`),
  ]);
  return c.json({ item: await loadScoring(db, id) });
});
