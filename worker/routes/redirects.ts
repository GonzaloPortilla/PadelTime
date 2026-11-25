import { Hono } from "hono";
import { redirectSchema } from "@shared/schemas";
import type { SiteRedirect } from "@shared/types";
import type { AppEnv } from "../types";
import { HttpError, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";

/**
 * Redirecciones 301 desde las direcciones de la web anterior (Fase 11). Sólo administradores:
 * afectan el posicionamiento en buscadores. El destino siempre es una dirección de esta web.
 */
export const redirectRoutes = new Hono<AppEnv>();

interface Row { id: number; from_path: string; to_path: string; prefix: number; note: string | null; updated_at: string }
const map = (r: Row): SiteRedirect => ({ id: r.id, fromPath: r.from_path, toPath: r.to_path, prefix: r.prefix === 1, note: r.note, updatedAt: r.updated_at });

redirectRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM site_redirects ORDER BY from_path").all<Row>();
  return c.json({ items: results.map(map) });
});

redirectRoutes.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.get("user").role !== "admin") throw new HttpError(403, "sin_permiso", "Sólo un administrador puede modificar las redirecciones.");
  await next();
});

redirectRoutes.post("/", async (c) => {
  const input = await parseBody(c, redirectSchema);
  const db = c.env.DB;
  const [res] = await db.batch<{ id: number }>([
    db.prepare("INSERT INTO site_redirects (from_path, to_path, prefix, note, updated_by) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(input.fromPath, input.toPath, input.prefix ? 1 : 0, input.note, c.get("user").id),
    auditStmt(db, c.get("user").id, "crear", "redireccion", null, `Redirección ${input.fromPath} → ${input.toPath}`),
  ]);
  const row = await db.prepare("SELECT * FROM site_redirects WHERE id = ?").bind(res!.results[0]!.id).first<Row>();
  return c.json({ item: map(row!) }, 201);
});

redirectRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La redirección");
  const input = await parseBody(c, redirectSchema);
  const db = c.env.DB;
  const [upd] = await db.batch([
    db.prepare("UPDATE site_redirects SET from_path = ?, to_path = ?, prefix = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ?")
      .bind(input.fromPath, input.toPath, input.prefix ? 1 : 0, input.note, new Date().toISOString(), c.get("user").id, id),
    auditStmt(db, c.get("user").id, "editar", "redireccion", id, `Redirección ${input.fromPath} → ${input.toPath}`),
  ]);
  if (!upd!.meta.changes) throw notFound("La redirección");
  const row = await db.prepare("SELECT * FROM site_redirects WHERE id = ?").bind(id).first<Row>();
  return c.json({ item: map(row!) });
});

redirectRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La redirección");
  const db = c.env.DB;
  const [del] = await db.batch([
    db.prepare("DELETE FROM site_redirects WHERE id = ?").bind(id),
    auditStmt(db, c.get("user").id, "eliminar", "redireccion", id, "Eliminó una redirección"),
  ]);
  if (!del!.meta.changes) throw notFound("La redirección");
  return c.json({ ok: true });
});
