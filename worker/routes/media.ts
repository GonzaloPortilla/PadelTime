import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { ALLOWED, mediaStore, safeFilename } from "../lib/media";

/**
 * Biblioteca de medios (imágenes y PDF).
 *  - Cualquier organizador sube y edita títulos o textos alternativos.
 *  - Sólo un administrador borra, y sólo si el archivo no se usa en ningún contenido.
 * Las imágenes llegan ya optimizadas por el navegador (WebP, máx. 1920 px, sin metadatos EXIF).
 */
export const mediaRoutes = new Hono<AppEnv>();

export interface MediaRow {
  id: string; kind: "imagen" | "documento"; mime: string; bytes: number; width: number | null; height: number | null;
  filename: string; title: string; alt: string | null; sha256: string | null; created_at: string; created_by_name: string | null;
}

const SELECT = `SELECT m.id, m.kind, m.mime, m.bytes, m.width, m.height, m.filename, m.title, m.alt, m.sha256, m.created_at, u.display_name AS created_by_name
  FROM media m LEFT JOIN users u ON u.id = m.created_by`;

export const mapMedia = (r: MediaRow) => ({
  id: r.id, kind: r.kind, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height, filename: r.filename,
  title: r.title, alt: r.alt, createdAt: r.created_at, createdByName: r.created_by_name,
  url: `/media/${r.id}/${r.filename}`,
});

/** Dónde se usa cada archivo (páginas, novedades, patrocinadores, foto de la sede), incluso en borradores. */
export async function mediaUsage(db: D1Database): Promise<Map<string, string[]>> {
  const [pages, posts, sponsors, settings, media] = await db.batch([
    db.prepare("SELECT title, blocks, COALESCE(draft, '') AS draft FROM site_pages"),
    db.prepare("SELECT title, blocks, COALESCE(draft, '') AS draft, COALESCE(cover_media_id, '') AS cover FROM site_posts"),
    db.prepare("SELECT name, media_id FROM site_sponsors"),
    db.prepare("SELECT value FROM app_settings WHERE key = 'site_venue_media_id'"),
    db.prepare("SELECT id FROM media"),
  ]);
  const usage = new Map<string, string[]>();
  const texts: { label: string; text: string }[] = [
    ...(pages!.results as { title: string; blocks: string; draft: string }[]).map((p) => ({ label: `Página: ${p.title}`, text: p.blocks + p.draft })),
    ...(posts!.results as { title: string; blocks: string; draft: string; cover: string }[]).map((p) => ({ label: `Novedad: ${p.title}`, text: p.blocks + p.draft + p.cover })),
    ...(sponsors!.results as { name: string; media_id: string }[]).map((s) => ({ label: `Patrocinador: ${s.name}`, text: s.media_id })),
    ...(settings!.results as { value: string }[]).map((s) => ({ label: "Datos de la web: foto de la sede", text: s.value })),
  ];
  for (const { id } of media!.results as { id: string }[]) {
    const where = texts.filter((t) => t.text.includes(id)).map((t) => t.label);
    if (where.length) usage.set(id, [...new Set(where)]);
  }
  return usage;
}

mediaRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const [{ results }, usage] = await Promise.all([db.prepare(`${SELECT} ORDER BY m.created_at DESC LIMIT 1000`).all<MediaRow>(), mediaUsage(db)]);
  return c.json({ items: results.map((r) => ({ ...mapMedia(r), usedIn: usage.get(r.id) ?? [] })) });
});

/** ¿Ya existe este archivo? (huella SHA-256 calculada en el navegador antes de subir). */
mediaRoutes.get("/check", async (c) => {
  const sha = c.req.query("sha256") ?? "";
  if (!/^[0-9a-f]{64}$/.test(sha)) throw badRequest("Huella inválida");
  const r = await c.env.DB.prepare(`${SELECT} WHERE m.sha256 = ?`).bind(sha).first<MediaRow>();
  return c.json({ item: r ? mapMedia(r) : null });
});

mediaRoutes.post("/", async (c) => {
  const mime = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const rule = ALLOWED[mime];
  if (!rule) throw new HttpError(415, "tipo_no_soportado", "Formato no permitido. Subí imágenes JPG, PNG o WebP, o documentos PDF.");
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > rule.max) throw new HttpError(413, "demasiado_grande", `El archivo supera el máximo de ${rule.max / 1024 / 1024} MB.`);
  const data = await c.req.arrayBuffer();
  if (data.byteLength === 0) throw badRequest("El archivo está vacío.");
  if (data.byteLength > rule.max) throw new HttpError(413, "demasiado_grande", `El archivo supera el máximo de ${rule.max / 1024 / 1024} MB.`);
  // El contenido tiene que coincidir con el formato declarado (no alcanza con la extensión).
  if (!rule.magic(new Uint8Array(data, 0, Math.min(16, data.byteLength)))) {
    throw new HttpError(415, "tipo_no_soportado", "El contenido del archivo no corresponde a su formato.");
  }
  const rawName = decodeURIComponent(c.req.header("x-file-name") ?? "archivo").slice(0, 200);
  const sha = (c.req.header("x-sha256") ?? "").toLowerCase();
  const sha256 = /^[0-9a-f]{64}$/.test(sha) ? sha : null;
  const dim = (h: string) => {
    const n = Number(c.req.header(h));
    return rule.kind === "imagen" && Number.isInteger(n) && n > 0 && n < 20000 ? n : null;
  };
  const db = c.env.DB;
  if (sha256) {
    const dup = await db.prepare(`${SELECT} WHERE m.sha256 = ?`).bind(sha256).first<MediaRow>();
    if (dup) return c.json({ item: mapMedia(dup), duplicate: true });
  }
  const id = crypto.randomUUID();
  const filename = safeFilename(rawName, rule.ext);
  const title = rawName.replace(/\.[^.]*$/, "").trim().slice(0, 120) || filename;
  const store = mediaStore(c.env);
  await store.put(id, data, { mime, filename });
  const user = c.get("user");
  try {
    await db.batch([
      db.prepare("INSERT INTO media (id, kind, mime, bytes, width, height, filename, title, sha256, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, rule.kind, mime, data.byteLength, dim("x-width"), dim("x-height"), filename, title, sha256, user.id, user.id),
      auditStmt(db, user.id, "subir", "multimedia", null, `Subió ${rule.kind === "imagen" ? "la imagen" : "el documento"} ${filename}`),
    ]);
  } catch (e) {
    await store.delete(id); // sin ficha no puede quedar un archivo huérfano
    throw e;
  }
  const row = await db.prepare(`${SELECT} WHERE m.id = ?`).bind(id).first<MediaRow>();
  return c.json({ item: mapMedia(row!), duplicate: false }, 201);
});

const updateSchema = z.object({ title: z.string().trim().min(1).max(120), alt: z.string().trim().max(200).nullish().transform((v) => v || null) });

mediaRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const input = await parseBody(c, updateSchema);
  const db = c.env.DB;
  const r = await db.prepare("UPDATE media SET title = ?, alt = ?, updated_at = ?, updated_by = ? WHERE id = ?")
    .bind(input.title, input.alt, new Date().toISOString(), c.get("user").id, id).run();
  if (!r.meta.changes) throw notFound("El archivo");
  const row = await db.prepare(`${SELECT} WHERE m.id = ?`).bind(id).first<MediaRow>();
  return c.json({ item: mapMedia(row!) });
});

/** Borrado seguro: sólo administradores y sólo si ningún contenido (publicado o en borrador) lo usa. */
mediaRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") throw new HttpError(403, "sin_permiso", "Sólo un administrador puede borrar archivos.");
  const id = c.req.param("id");
  const db = c.env.DB;
  const row = await db.prepare(`${SELECT} WHERE m.id = ?`).bind(id).first<MediaRow>();
  if (!row) throw notFound("El archivo");
  const used = (await mediaUsage(db)).get(id);
  if (used?.length) throw conflict(`No se puede borrar: se usa en ${used.join(", ")}. Quitalo de esos contenidos primero.`);
  await db.batch([
    db.prepare("DELETE FROM media WHERE id = ?").bind(id),
    auditStmt(db, user.id, "eliminar", "multimedia", null, `Eliminó el archivo ${row.filename}`),
  ]);
  await mediaStore(c.env).delete(id);
  return c.json({ ok: true });
});
