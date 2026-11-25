import type { Context } from "hono";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@shared/types";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, "solicitud_invalida", message, fields);
export const notFound = (what = "El recurso") => new HttpError(404, "no_encontrado", `${what} no existe`);
export const conflict = (message: string, fields?: Record<string, string>) =>
  new HttpError(409, "conflicto", message, fields);

export function zodToFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Traduce errores de restricciones de SQLite/D1 a mensajes comprensibles. */
function fromSqlite(err: Error): HttpError | null {
  const msg = err.message ?? "";
  if (msg.includes("UNIQUE constraint failed")) {
    if (msg.includes("players.document_number")) return conflict("Ya existe un jugador con ese documento", { documentNumber: "Documento ya registrado" });
    if (msg.includes("categories.")) return conflict("Ya existe una categoría con ese nombre en la rama", { name: "Nombre repetido" });
    if (msg.includes("divisions.")) return conflict("Ya existe una división con ese nombre en la categoría", { name: "Nombre repetido" });
    if (msg.includes("seasons.status")) return conflict("Ya hay otra temporada activa. Cerrala o pasala a planificada primero.");
    if (msg.includes("seasons.name")) return conflict("Ya existe una temporada con ese nombre", { name: "Nombre repetido" });
    if (msg.includes("users.username")) return conflict("Ese nombre de usuario ya está en uso", { username: "Usuario repetido" });
    if (msg.includes("initial_balances.")) return conflict("Uno de los jugadores ya tiene un saldo inicial vigente en ese ranking. Revertí la importación anterior o quitá la fila.");
    if (msg.includes("ranking_imports.file_hash")) return conflict("Ese archivo ya fue importado. Si querés reemplazarlo, revertí primero la importación anterior.");
    if (msg.includes("ranking_imports.content_hash")) return conflict("Ese contenido ya fue importado (aunque el archivo sea otro). Revertí primero la importación anterior.");
    if (msg.includes("idx_tournaments_event_category") || msg.includes("tournaments.event_id")) return conflict("Esa categoría ya forma parte del torneo", { categoryId: "Categoría repetida" });
    if (msg.includes("tournament_team_players")) return conflict("Uno de los jugadores ya está inscripto en otra pareja de este torneo");
    if (msg.includes("tournament_credits.tournament_id")) return conflict("El torneo ya tiene una acreditación vigente. Recargá la página.");
    if (msg.includes("point_movements.reverses_movement_id")) return conflict("Ese movimiento ya fue revertido o anulado. Recargá la página.");
    if (msg.includes("scoring_templates.name")) return conflict("Ya existe una plantilla con ese nombre", { name: "Nombre repetido" });
    if (msg.includes("tournament_stages") || msg.includes("scoring_template_stages")) return conflict("Hay instancias repetidas");
    return conflict("El registro ya existe");
  }
  if (msg.includes("inmutables")) return conflict("Los movimientos de puntos no se pueden modificar: usá una corrección o reversión.");
  if (msg.includes("FOREIGN KEY constraint failed")) {
    return conflict("La operación no es posible porque hay datos relacionados");
  }
  if (msg.includes("CHECK constraint failed")) {
    return badRequest("Los datos no cumplen las reglas de validación");
  }
  return null;
}

/** La base no tiene aplicadas las migraciones que el código necesita (faltan tablas o columnas). */
export const isSchemaOutdated = (err: unknown) => /no such (table|column)|has no column named/i.test(err instanceof Error ? err.message : String(err));
export const SCHEMA_OUTDATED_MESSAGE =
  "La base de datos no está actualizada: faltan aplicar migraciones. En la compu, ejecutá «npm run db:migrate:local»; en producción se aplican solas con «npm run deploy».";

export function handleError(err: Error, c: Context): Response {
  let httpError: HttpError;
  if (err instanceof HttpError) httpError = err;
  else if (err instanceof ZodError) httpError = badRequest("Revisá los datos ingresados", zodToFields(err));
  else {
    const mapped = fromSqlite(err);
    if (mapped) httpError = mapped;
    else if (isSchemaOutdated(err)) {
      console.error("Base sin migrar", err);
      httpError = new HttpError(500, "base_desactualizada", SCHEMA_OUTDATED_MESSAGE);
    } else {
      console.error("Error no controlado", err);
      httpError = new HttpError(500, "error_interno", "Ocurrió un error inesperado. Intentá nuevamente.");
    }
  }
  const body: ApiErrorBody = {
    error: { code: httpError.code, message: httpError.message, ...(httpError.fields ? { fields: httpError.fields } : {}) },
  };
  return c.json(body, httpError.status);
}
