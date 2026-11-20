import { beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Orden compatible con las claves foráneas.
const TABLES = [
  "initial_balances", "point_movements", "ranking_imports", "tournament_credits", "tournament_team_players", "tournament_teams",
  "tournament_stages", "tournament_scoring", "bracket_imports", "tournaments", "player_category_changes", "players",
  "divisions", "categories", "seasons", "audit_log", "sessions", "login_attempts", "users",
];

// Los triggers que hacen inmutable el registro de puntos se quitan sólo durante la limpieza
// entre tests y se vuelven a crear con su SQL original.
const triggers = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'point_movements'")
  .all<{ name: string; sql: string }>();

// Plantillas sembradas por la migración: se restauran tal cual en cada test.
const templates = await env.DB.prepare("SELECT * FROM scoring_templates").all();
const templateStages = await env.DB.prepare("SELECT * FROM scoring_template_stages").all();
const settings = await env.DB.prepare("SELECT * FROM app_settings").all();

function restoreStmt(table: string, rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const cols = Object.keys(r);
    return env.DB.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((k) => r[k]));
  });
}

let versionSeed = Date.now();

beforeEach(async () => {
  await env.DB.batch([
    ...triggers.results.map((t) => env.DB.prepare(`DROP TRIGGER IF EXISTS ${t.name}`)),
    // Las autorreferencias (contraasientos y correcciones) son RESTRICT: se sueltan antes de borrar.
    env.DB.prepare("DELETE FROM point_movements WHERE reverses_movement_id IS NOT NULL"),
    env.DB.prepare("UPDATE tournament_credits SET replaces_credit_id = NULL"),
    ...TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    env.DB.prepare("DELETE FROM scoring_template_stages"),
    env.DB.prepare("DELETE FROM scoring_templates"),
    env.DB.prepare("DELETE FROM app_settings"),
    env.DB.prepare("DELETE FROM sqlite_sequence"),
    ...triggers.results.map((t) => env.DB.prepare(t.sql)),
    ...restoreStmt("scoring_templates", templates.results as Record<string, unknown>[]),
    ...restoreStmt("scoring_template_stages", templateStages.results as Record<string, unknown>[]),
    ...restoreStmt("app_settings", settings.results as Record<string, unknown>[]),
    // La vista pública guarda páginas en memoria según la versión: cada test arranca con una versión nueva
    // (en producción la versión sólo crece, así que nunca se repite).
    env.DB.prepare("UPDATE app_settings SET value = ? WHERE key = 'public_version'").bind(String(++versionSeed)),
  ]);
});
