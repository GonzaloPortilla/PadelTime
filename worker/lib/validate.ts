import type { Context } from "hono";
import type { z } from "zod";
import { badRequest, HttpError, zodToFields } from "./errors";

const MAX_BODY_BYTES = 64 * 1024;
/** Límite para importaciones de rankings (hasta 3000 filas con jugadores nuevos). */
export const IMPORT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function parseBody<S extends z.ZodType>(c: Context, schema: S, maxBytes = MAX_BODY_BYTES): Promise<z.output<S>> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "tipo_no_soportado", "Se esperaba JSON");
  }
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > maxBytes) throw new HttpError(413, "demasiado_grande", "La solicitud es demasiado grande");
  let raw: unknown;
  try {
    const text = await c.req.text();
    if (text.length > maxBytes) throw new HttpError(413, "demasiado_grande", "La solicitud es demasiado grande");
    raw = JSON.parse(text);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw badRequest("JSON inválido");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest("Revisá los datos ingresados", zodToFields(result.error));
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.req.query())) if (v !== "") raw[k] = v;
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest("Parámetros inválidos", zodToFields(result.error));
  return result.data;
}

export function parseId(value: string | undefined, what = "El recurso"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, "no_encontrado", `${what} no existe`);
  return n;
}
