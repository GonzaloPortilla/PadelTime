/**
 * Respaldo completo de la base en formato SQL, restaurable con
 *   npx wrangler d1 execute <base> --remote --file=respaldo.sql
 * sobre una base NUEVA con las migraciones ya aplicadas (ver docs/RESPALDO.md).
 *
 * El Worker sólo entrega filas por páginas; el archivo se arma en el navegador para no
 * exceder el límite de CPU por solicitud del plan gratuito.
 */

/** Tablas con datos permanentes, en orden compatible con las claves foráneas (padres primero). */
export const BACKUP_TABLES = [
  "users",
  "categories",
  "divisions",
  "seasons",
  "players",
  "player_category_changes",
  "tournament_events",
  "tournaments",
  "scoring_templates",
  "scoring_template_stages",
  "tournament_scoring",
  "tournament_stages",
  "tournament_teams",
  "tournament_team_players",
  "tournament_fixtures",
  "fixture_groups",
  "fixture_group_teams",
  "fixture_matches",
  "fixture_match_history",
  "fixture_publications",
  "tournament_credits",
  "ranking_imports",
  "point_movements",
  "initial_balances",
  "bracket_imports",
  "audit_log",
  "media",
  "site_pages",
  "site_posts",
  "site_sponsors",
  "site_events",
  "site_revisions",
  "site_redirects",
  "app_settings",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Tablas que las migraciones siembran con datos iniciales: se vacían antes de restaurar. */
const SEEDED_TABLES: BackupTable[] = ["scoring_template_stages", "scoring_templates", "site_pages", "site_redirects", "app_settings"];

export const BACKUP_PAGE_SIZE = 1000;

export interface BackupPage {
  table: BackupTable;
  columns: string[];
  rows: unknown[][];
  /** rowid desde el cual pedir la página siguiente, o null si no hay más. */
  next: number | null;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  // Los saltos de línea se codifican con char(): cada sentencia ocupa exactamente una línea del archivo.
  const quoted = `'${String(v).replace(/'/g, "''")}'`;
  return /[\r\n]/.test(quoted) ? quoted.replace(/\r/g, "' || char(13) || '").replace(/\n/g, "' || char(10) || '") : quoted;
}

export function dumpHeader(meta: { generatedAt: string; counts: Record<string, number> }): string {
  const lines = [
    "-- Respaldo de Padel Time",
    `-- Generado: ${meta.generatedAt}`,
    "-- CONFIDENCIAL: contiene datos personales de jugadores y los hashes de contraseña de los organizadores.",
    "-- Restaurar sólo sobre una base nueva con las migraciones aplicadas (docs/RESPALDO.md).",
    `-- Filas: ${Object.entries(meta.counts).map(([t, n]) => `${t}=${n}`).join(", ")}`,
    "PRAGMA defer_foreign_keys = ON;",
    ...SEEDED_TABLES.map((t) => `DELETE FROM ${ident(t)};`),
  ];
  return lines.join("\n") + "\n";
}

/** Convierte una página de filas en sentencias INSERT (una por fila, para que D1 las procese sin límites de tamaño). */
export function dumpPage(page: Pick<BackupPage, "table" | "columns" | "rows">): string {
  if (page.rows.length === 0) return "";
  const head = `INSERT INTO ${ident(page.table)} (${page.columns.map(ident).join(", ")}) VALUES `;
  return page.rows.map((r) => `${head}(${r.map(sqlLiteral).join(", ")});`).join("\n") + "\n";
}
