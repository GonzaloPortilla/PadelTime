import { Hono } from "hono";
import { BACKUP_PAGE_SIZE, BACKUP_TABLES, type BackupPage, type BackupTable } from "@shared/backup";
import type { AppEnv } from "../types";
import { badRequest, HttpError } from "../lib/errors";
import { auditStmt } from "../lib/audit";

/**
 * Respaldo descargable (sólo administradores). Lectura pura: no modifica datos.
 * Los nombres de tabla salen de una lista fija, nunca de la entrada del usuario.
 */
export const backupRoutes = new Hono<AppEnv>();

backupRoutes.use("*", async (c, next) => {
  if (c.get("user").role !== "admin") throw new HttpError(403, "sin_permiso", "Sólo un administrador puede descargar respaldos.");
  await next();
});

/** Cantidad de filas por tabla (para mostrar el progreso). Registra la descarga en la auditoría. */
backupRoutes.post("/start", async (c) => {
  const db = c.env.DB;
  const counts = await db.batch(BACKUP_TABLES.map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`)));
  await auditStmt(db, c.get("user").id, "respaldar", "base", null, "Descargó un respaldo completo de la base").run();
  return c.json({
    tables: BACKUP_TABLES.map((t, i) => ({ table: t, count: (counts[i]!.results[0] as { n: number }).n })),
    pageSize: BACKUP_PAGE_SIZE,
    generatedAt: new Date().toISOString(),
  });
});

backupRoutes.get("/:table", async (c) => {
  const table = c.req.param("table") as BackupTable;
  if (!(BACKUP_TABLES as readonly string[]).includes(table)) throw badRequest("Tabla inexistente");
  const after = Number(c.req.query("after") ?? 0);
  if (!Number.isInteger(after) || after < 0) throw badRequest("Parámetro inválido");
  const { results } = await c.env.DB.prepare(`SELECT rowid AS __rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`)
    .bind(after, BACKUP_PAGE_SIZE)
    .all<Record<string, unknown>>();
  const columns = results.length ? Object.keys(results[0]!).filter((k) => k !== "__rowid") : [];
  const body: BackupPage = {
    table,
    columns,
    rows: results.map((r) => columns.map((k) => r[k])),
    next: results.length === BACKUP_PAGE_SIZE ? (results[results.length - 1]!.__rowid as number) : null,
  };
  return c.json(body);
});
