import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  eventSchema, pageContentSchema, postContentSchema, saveContentSchema, slugify, sponsorSchema, versionOnlySchema,
  type ContentStatus, type PageContent, type PostContent,
} from "@shared/site";
import type { AppEnv } from "../types";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { renderPreview } from "../public/preview";

/**
 * Gestor de contenidos (Fase 8). Páginas fijas de la web y novedades comparten el mismo ciclo:
 *   borrador → (vista previa) → publicada → archivada (oculta) → publicada…
 * Cada guardado incrementa `version`: si alguien guardó mientras otro editaba, el segundo recibe 409
 * con el nombre y la hora del cambio anterior (nunca se pisa en silencio). Todo queda en site_revisions.
 * Los datos deportivos (torneos, resultados, rankings) NO se editan acá: siguen en sus módulos.
 */
export const cmsRoutes = new Hono<AppEnv>();

const MAX_BODY = 512 * 1024; // páginas largas (reglamento con muchos bloques)

type Entity = "pagina" | "novedad";
interface EntityCfg<T> {
  entity: Entity;
  table: "site_pages" | "site_posts";
  label: string;
  schema: z.ZodType<T>;
  /** Contenido publicado (columnas) → objeto editable. */
  published: (r: Record<string, unknown>) => T;
  /** Objeto editable → valores de columnas publicadas. */
  columns: (c: T) => Record<string, unknown>;
}

const parseJson = (v: unknown) => {
  try {
    return typeof v === "string" ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};

const PAGE: EntityCfg<PageContent> = {
  entity: "pagina", table: "site_pages", label: "la página", schema: pageContentSchema,
  published: (r) => ({ title: r.title as string, summary: (r.summary as string) ?? null, seoTitle: (r.seo_title as string) ?? null, seoDescription: (r.seo_description as string) ?? null, blocks: parseJson(r.blocks) ?? [] }),
  columns: (c) => ({ title: c.title, summary: c.summary, seo_title: c.seoTitle, seo_description: c.seoDescription, blocks: JSON.stringify(c.blocks) }),
};
const POST: EntityCfg<PostContent> = {
  entity: "novedad", table: "site_posts", label: "la novedad", schema: postContentSchema,
  published: (r) => ({ title: r.title as string, excerpt: (r.excerpt as string) ?? null, coverMediaId: (r.cover_media_id as string) ?? null, pinned: r.pinned === 1, tournamentId: (r.tournament_id as number) ?? null, blocks: parseJson(r.blocks) ?? [] }),
  columns: (c) => ({ title: c.title, excerpt: c.excerpt, cover_media_id: c.coverMediaId, pinned: c.pinned ? 1 : 0, tournament_id: c.tournamentId, blocks: JSON.stringify(c.blocks) }),
};

/** Páginas que forman parte de la estructura de la web: no se pueden ocultar (las demás sí). */
const NOT_ARCHIVABLE = new Set(["inicio", "contacto", "torneos", "rankings", "calendario", "novedades"]);

async function loadRow(db: D1Database, cfg: EntityCfg<unknown>, id: number) {
  const r = await db
    .prepare(`SELECT x.*, u.display_name AS updated_by_name, pu.display_name AS published_by_name FROM ${cfg.table} x
                LEFT JOIN users u ON u.id = x.updated_by LEFT JOIN users pu ON pu.id = x.published_by WHERE x.id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!r) throw notFound(cfg.entity === "pagina" ? "La página" : "La novedad");
  return r;
}

function detail<T>(cfg: EntityCfg<T>, r: Record<string, unknown>) {
  const published = r.status === "borrador" && !r.published_at ? null : cfg.published(r);
  const draft = r.draft ? (parseJson(r.draft) as T) : null;
  return {
    id: r.id as number, slug: r.slug as string, systemKey: (r.system_key as string) ?? null, status: r.status as ContentStatus,
    version: r.version as number, published, draft, hasDraft: !!r.draft,
    archivable: cfg.entity === "novedad" || !NOT_ARCHIVABLE.has((r.system_key as string) ?? ""),
    updatedAt: r.updated_at as string, updatedByName: (r.updated_by_name as string) ?? null,
    publishedAt: (r.published_at as string) ?? null, publishedByName: (r.published_by_name as string) ?? null,
  };
}

/** Rechaza si la versión cambió: alguien guardó mientras este organizador editaba. */
function assertVersion(r: Record<string, unknown>, version: number) {
  if (r.version !== version) {
    const when = new Date(r.updated_at as string).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });
    throw new HttpError(409, "version_desactualizada",
      `${(r.updated_by_name as string) ?? "Otro organizador"} guardó cambios el ${when}. Recargá para ver la versión actual antes de seguir: tus cambios no se guardaron.`);
  }
}

/**
 * Historial y auditoría que acompañan a un UPDATE versionado: se insertan sólo si la sentencia anterior
 * del mismo lote modificó una fila (changes() > 0). Si otro organizador guardó antes, no queda nada falso.
 */
function revisionStmt(db: D1Database, entity: Entity, id: number, version: number, action: string, snapshot: unknown, userId: number, conditional = true) {
  return db.prepare(`INSERT INTO site_revisions (entity, entity_id, version, action, snapshot, created_by) SELECT ?, ?, ?, ?, ?, ?${conditional ? " WHERE changes() > 0" : ""}`)
    .bind(entity, id, version, action, JSON.stringify(snapshot), userId);
}

function auditIf(db: D1Database, userId: number, action: string, entity: string, id: number | null, summary: string) {
  return db.prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) SELECT ?, ?, ?, ?, ? WHERE changes() > 0")
    .bind(userId, action, entity, id, summary.slice(0, 300));
}

/** UPDATE condicionado a la versión: si dos guardan al mismo tiempo, sólo uno cambia la fila. */
async function updateVersioned(db: D1Database, table: string, id: number, version: number, set: Record<string, unknown>, extra: D1PreparedStatement[]) {
  const cols = Object.keys(set);
  const stmt = db.prepare(`UPDATE ${table} SET ${cols.map((k) => `${k} = ?`).join(", ")}, version = version + 1 WHERE id = ? AND version = ?`)
    .bind(...cols.map((k) => set[k]), id, version);
  const [res] = await db.batch([stmt, ...extra]);
  if (!res!.meta.changes) throw new HttpError(409, "version_desactualizada", "Otro organizador guardó cambios recién. Recargá para ver la versión actual: tus cambios no se guardaron.");
}

/** Registra las rutas de edición (borrador, publicar, ocultar, historial) para páginas o novedades. */
function contentRoutes<T>(base: string, cfg: EntityCfg<T>) {
  const now = () => new Date().toISOString();
  const read = async (c: Context<AppEnv>) => {
    const id = parseId(c.req.param("id"), cfg.entity === "pagina" ? "La página" : "La novedad");
    return { id, row: await loadRow(c.env.DB, cfg as EntityCfg<unknown>, id) };
  };

  cmsRoutes.get(`${base}/:id`, async (c) => {
    const { row } = await read(c);
    return c.json({ item: detail(cfg, row) });
  });

  cmsRoutes.put(`${base}/:id/draft`, async (c) => {
    const { id, row } = await read(c);
    const { version, content } = await parseBody(c, saveContentSchema(cfg.schema), MAX_BODY);
    assertVersion(row, version);
    const user = c.get("user");
    await updateVersioned(c.env.DB, cfg.table, id, version, { draft: JSON.stringify(content), updated_at: now(), updated_by: user.id }, [
      revisionStmt(c.env.DB, cfg.entity, id, version + 1, "borrador", content, user.id),
    ]);
    return c.json({ item: detail(cfg, await loadRow(c.env.DB, cfg as EntityCfg<unknown>, id)) });
  });

  cmsRoutes.post(`${base}/:id/publish`, async (c) => {
    const { id, row } = await read(c);
    const body = await parseBody(c, z.object({ version: z.number().int().min(1), content: cfg.schema.optional() }), MAX_BODY);
    assertVersion(row, body.version);
    const content = (body.content ?? (row.draft ? cfg.schema.parse(parseJson(row.draft)) : null)) as T | null;
    if (!content) throw badRequest("No hay cambios para publicar.");
    const user = c.get("user");
    const db = c.env.DB;
    await updateVersioned(db, cfg.table, id, body.version, {
      ...cfg.columns(content), draft: null, status: "publicada", published_at: now(), published_by: user.id, updated_at: now(), updated_by: user.id,
    }, [
      revisionStmt(db, cfg.entity, id, body.version + 1, "publicacion", content, user.id),
      auditIf(db, user.id, "publicar", cfg.entity === "pagina" ? "pagina" : "novedad", id, `Publicó ${cfg.label} "${(content as unknown as { title: string }).title}"`),
    ]);
    return c.json({ item: detail(cfg, await loadRow(db, cfg as EntityCfg<unknown>, id)) });
  });

  const setStatus = (path: string, action: "archivo" | "desarchivo") =>
    cmsRoutes.post(`${base}/:id/${path}`, async (c) => {
      const { id, row } = await read(c);
      const { version } = await parseBody(c, versionOnlySchema);
      assertVersion(row, version);
      if (action === "archivo" && cfg.entity === "pagina" && NOT_ARCHIVABLE.has((row.system_key as string) ?? "")) {
        throw conflict("Esta página es parte de la estructura de la web y no se puede ocultar. Podés editar su contenido.");
      }
      const status: ContentStatus = action === "archivo" ? "archivada" : row.published_at ? "publicada" : "borrador";
      const user = c.get("user");
      const db = c.env.DB;
      await updateVersioned(db, cfg.table, id, version, { status, updated_at: now(), updated_by: user.id }, [
        revisionStmt(db, cfg.entity, id, version + 1, action, cfg.published(row), user.id),
        auditIf(db, user.id, action === "archivo" ? "ocultar" : "mostrar", cfg.entity, id, `${action === "archivo" ? "Ocultó" : "Volvió a mostrar"} ${cfg.label} "${row.title as string}"`),
      ]);
      return c.json({ item: detail(cfg, await loadRow(db, cfg as EntityCfg<unknown>, id)) });
    });
  setStatus("archive", "archivo");
  setStatus("unarchive", "desarchivo");

  cmsRoutes.post(`${base}/:id/discard`, async (c) => {
    const { id, row } = await read(c);
    const { version } = await parseBody(c, versionOnlySchema);
    assertVersion(row, version);
    if (!row.draft) return c.json({ item: detail(cfg, row) });
    const user = c.get("user");
    await updateVersioned(c.env.DB, cfg.table, id, version, { draft: null, updated_at: now(), updated_by: user.id }, [
      revisionStmt(c.env.DB, cfg.entity, id, version + 1, "descarte", parseJson(row.draft), user.id),
    ]);
    return c.json({ item: detail(cfg, await loadRow(c.env.DB, cfg as EntityCfg<unknown>, id)) });
  });

  cmsRoutes.get(`${base}/:id/revisions`, async (c) => {
    const { id } = await read(c);
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.version, r.action, r.created_at, u.display_name AS by_name FROM site_revisions r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.entity = ? AND r.entity_id = ? ORDER BY r.id DESC LIMIT 100`,
    ).bind(cfg.entity, id).all<{ id: number; version: number; action: string; created_at: string; by_name: string | null }>();
    return c.json({ items: results.map((r) => ({ id: r.id, version: r.version, action: r.action, createdAt: r.created_at, byName: r.by_name })) });
  });

  cmsRoutes.get(`${base}/:id/revisions/:rid`, async (c) => {
    const { id } = await read(c);
    const rid = parseId(c.req.param("rid"), "La versión");
    const r = await c.env.DB.prepare("SELECT snapshot FROM site_revisions WHERE id = ? AND entity = ? AND entity_id = ?").bind(rid, cfg.entity, id).first<{ snapshot: string }>();
    if (!r) throw notFound("La versión");
    return c.json({ content: parseJson(r.snapshot) });
  });

  /** Recuperar una versión anterior: queda como borrador (hay que publicarla para que se vea). */
  cmsRoutes.post(`${base}/:id/restore`, async (c) => {
    const { id, row } = await read(c);
    const { version, revisionId } = await parseBody(c, z.object({ version: z.number().int().min(1), revisionId: z.number().int().positive() }));
    assertVersion(row, version);
    const rev = await c.env.DB.prepare("SELECT snapshot, version FROM site_revisions WHERE id = ? AND entity = ? AND entity_id = ?").bind(revisionId, cfg.entity, id).first<{ snapshot: string; version: number }>();
    if (!rev) throw notFound("La versión");
    const content = cfg.schema.safeParse(parseJson(rev.snapshot));
    if (!content.success) throw badRequest("Esa versión no es compatible con el formato actual y no se puede recuperar.");
    const user = c.get("user");
    await updateVersioned(c.env.DB, cfg.table, id, version, { draft: JSON.stringify(content.data), updated_at: now(), updated_by: user.id }, [
      revisionStmt(c.env.DB, cfg.entity, id, version + 1, "restauracion", content.data, user.id),
    ]);
    return c.json({ item: detail(cfg, await loadRow(c.env.DB, cfg as EntityCfg<unknown>, id)) });
  });

  /** Vista previa del borrador (o de lo publicado si no hay borrador), con el diseño real de la web. */
  cmsRoutes.get(`${base}/:id/preview`, async (c) => {
    const { row } = await read(c);
    const content = (row.draft ? parseJson(row.draft) : cfg.published(row)) as T;
    const html = await renderPreview(c.env, new URL(c.req.url).origin, cfg.entity, row, content);
    return c.body(html, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'; frame-src https://www.google.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Robots-Tag": "noindex",
    });
  });
}

// ─────────────────────────── Páginas ───────────────────────────
cmsRoutes.get("/pages", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.system_key, p.title, p.status, p.draft IS NOT NULL AS has_draft, p.version, p.updated_at, u.display_name AS updated_by_name, p.published_at
       FROM site_pages p LEFT JOIN users u ON u.id = p.updated_by ORDER BY p.sort_order, p.id`,
  ).all<{ id: number; slug: string; system_key: string | null; title: string; status: ContentStatus; has_draft: number; version: number; updated_at: string; updated_by_name: string | null; published_at: string | null }>();
  return c.json({ items: results.map((r) => ({ id: r.id, slug: r.slug, systemKey: r.system_key, title: r.title, status: r.status, hasDraft: r.has_draft === 1, version: r.version, updatedAt: r.updated_at, updatedByName: r.updated_by_name, publishedAt: r.published_at, archivable: !NOT_ARCHIVABLE.has(r.system_key ?? "") })) });
});
contentRoutes("/pages", PAGE);

// ─────────────────────────── Novedades ───────────────────────────
cmsRoutes.get("/posts", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.title, p.status, p.draft IS NOT NULL AS has_draft, p.version, p.pinned, p.published_at, p.updated_at, u.display_name AS updated_by_name
       FROM site_posts p LEFT JOIN users u ON u.id = p.updated_by ORDER BY p.status = 'archivada', p.updated_at DESC LIMIT 500`,
  ).all<{ id: number; slug: string; title: string; status: ContentStatus; has_draft: number; version: number; pinned: number; published_at: string | null; updated_at: string; updated_by_name: string | null }>();
  return c.json({ items: results.map((r) => ({ id: r.id, slug: r.slug, title: r.title, status: r.status, hasDraft: r.has_draft === 1, version: r.version, pinned: r.pinned === 1, publishedAt: r.published_at, updatedAt: r.updated_at, updatedByName: r.updated_by_name })) });
});

/** Crea una novedad como borrador (no se ve en la web hasta publicarla). */
cmsRoutes.post("/posts", async (c) => {
  const { content } = await parseBody(c, z.object({ content: postContentSchema }), MAX_BODY);
  const db = c.env.DB;
  const base = slugify(content.title) || "novedad";
  const taken = new Set((await db.prepare("SELECT slug FROM site_posts WHERE slug = ? OR slug LIKE ?").bind(base, `${base}-%`).all<{ slug: string }>()).results.map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  const user = c.get("user");
  const [ins] = await db.batch<{ id: number }>([
    db.prepare(`INSERT INTO site_posts (slug, title, excerpt, cover_media_id, pinned, tournament_id, blocks, status, draft, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, ?) RETURNING id`)
      .bind(slug, content.title, content.excerpt, content.coverMediaId, content.pinned ? 1 : 0, content.tournamentId, JSON.stringify(content.blocks), JSON.stringify(content), user.id, user.id),
  ]);
  const id = ins!.results[0]!.id;
  await db.batch([
    revisionStmt(db, "novedad", id, 1, "creacion", content, user.id, false),
    auditStmt(db, user.id, "crear", "novedad", id, `Creó la novedad "${content.title}" (borrador)`),
  ]);
  return c.json({ item: detail(POST, await loadRow(db, POST as EntityCfg<unknown>, id)) }, 201);
});
contentRoutes("/posts", POST);

/** Borrar una novedad definitivamente es sensible: sólo administradores (los demás pueden ocultarla). */
cmsRoutes.delete("/posts/:id", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") throw new HttpError(403, "sin_permiso", "Sólo un administrador puede borrar novedades. Podés ocultarla.");
  const id = parseId(c.req.param("id"), "La novedad");
  const db = c.env.DB;
  const row = await loadRow(db, POST as EntityCfg<unknown>, id);
  await db.batch([
    db.prepare("DELETE FROM site_posts WHERE id = ?").bind(id),
    db.prepare("DELETE FROM site_revisions WHERE entity = 'novedad' AND entity_id = ?").bind(id),
    auditStmt(db, user.id, "eliminar", "novedad", id, `Eliminó la novedad "${row.title as string}"`),
  ]);
  return c.json({ ok: true });
});

// ─────────────────────────── Patrocinadores ───────────────────────────
interface SponsorRow { id: number; name: string; media_id: string; url: string | null; sort_order: number; active: number; version: number; filename: string | null }
const mapSponsor = (r: SponsorRow) => ({ id: r.id, name: r.name, mediaId: r.media_id, url: r.url, sortOrder: r.sort_order, active: r.active === 1, version: r.version, logoUrl: r.filename ? `/media/${r.media_id}/${r.filename}` : null });
const SPONSOR_SELECT = "SELECT s.*, m.filename FROM site_sponsors s LEFT JOIN media m ON m.id = s.media_id";

async function assertImage(db: D1Database, mediaId: string) {
  const m = await db.prepare("SELECT kind FROM media WHERE id = ?").bind(mediaId).first<{ kind: string }>();
  if (!m || m.kind !== "imagen") throw badRequest("Elegí una imagen de la biblioteca", { mediaId: "Imagen inválida" });
}

cmsRoutes.get("/sponsors", async (c) => {
  const { results } = await c.env.DB.prepare(`${SPONSOR_SELECT} ORDER BY s.sort_order, s.id`).all<SponsorRow>();
  return c.json({ items: results.map(mapSponsor) });
});

cmsRoutes.post("/sponsors", async (c) => {
  const input = await parseBody(c, sponsorSchema);
  const db = c.env.DB;
  await assertImage(db, input.mediaId);
  const user = c.get("user");
  await db.batch([
    db.prepare("INSERT INTO site_sponsors (name, media_id, url, active, sort_order, updated_by) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM site_sponsors), ?)")
      .bind(input.name, input.mediaId, input.url, input.active ? 1 : 0, user.id),
    auditStmt(db, user.id, "crear", "patrocinador", null, `Agregó el patrocinador ${input.name}`),
  ]);
  return c.json({ ok: true }, 201);
});

cmsRoutes.put("/sponsors/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El patrocinador");
  const input = await parseBody(c, sponsorSchema);
  if (!input.version) throw badRequest("Falta la versión");
  const db = c.env.DB;
  await assertImage(db, input.mediaId);
  const r = await db.prepare("UPDATE site_sponsors SET name = ?, media_id = ?, url = ?, active = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?")
    .bind(input.name, input.mediaId, input.url, input.active ? 1 : 0, new Date().toISOString(), c.get("user").id, id, input.version).run();
  if (!r.meta.changes) throw new HttpError(409, "version_desactualizada", "Otro organizador modificó este patrocinador. Recargá la lista.");
  return c.json({ ok: true });
});

cmsRoutes.put("/sponsors-order", async (c) => {
  const { ids } = await parseBody(c, z.object({ ids: z.array(z.number().int().positive()).max(200) }));
  const db = c.env.DB;
  await db.batch(ids.map((id, i) => db.prepare("UPDATE site_sponsors SET sort_order = ? WHERE id = ?").bind(i + 1, id)));
  return c.json({ ok: true });
});

cmsRoutes.delete("/sponsors/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El patrocinador");
  const db = c.env.DB;
  const r = await db.prepare(`${SPONSOR_SELECT} WHERE s.id = ?`).bind(id).first<SponsorRow>();
  if (!r) throw notFound("El patrocinador");
  await db.batch([db.prepare("DELETE FROM site_sponsors WHERE id = ?").bind(id), auditStmt(db, c.get("user").id, "eliminar", "patrocinador", null, `Quitó el patrocinador ${r.name}`)]);
  return c.json({ ok: true });
});

// ─────────────────────────── Eventos del calendario ───────────────────────────
interface EventRow { id: number; title: string; kind: string; starts_on: string; ends_on: string | null; start_time: string | null; location: string | null; description: string | null; public: number; version: number }
const mapEvent = (r: EventRow) => ({ id: r.id, title: r.title, kind: r.kind, startsOn: r.starts_on, endsOn: r.ends_on, startTime: r.start_time, location: r.location, description: r.description, public: r.public === 1, version: r.version });

cmsRoutes.get("/events", async (c) => {
  const from = c.req.query("desde") ?? "0000-01-01";
  const { results } = await c.env.DB.prepare("SELECT * FROM site_events WHERE COALESCE(ends_on, starts_on) >= ? ORDER BY starts_on, start_time, id LIMIT 500").bind(from).all<EventRow>();
  return c.json({ items: results.map(mapEvent) });
});

cmsRoutes.post("/events", async (c) => {
  const e = await parseBody(c, eventSchema);
  const db = c.env.DB;
  const user = c.get("user");
  await db.batch([
    db.prepare("INSERT INTO site_events (title, kind, starts_on, ends_on, start_time, location, description, public, created_by, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(e.title, e.kind, e.startsOn, e.endsOn, e.startTime, e.location, e.description, e.public ? 1 : 0, user.id, user.id, new Date().toISOString()),
    auditStmt(db, user.id, "crear", "evento", null, `Agregó al calendario "${e.title}" (${e.startsOn})`),
  ]);
  return c.json({ ok: true }, 201);
});

cmsRoutes.put("/events/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El evento");
  const e = await parseBody(c, eventSchema);
  if (!e.version) throw badRequest("Falta la versión");
  const r = await c.env.DB.prepare(
    "UPDATE site_events SET title = ?, kind = ?, starts_on = ?, ends_on = ?, start_time = ?, location = ?, description = ?, public = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?",
  ).bind(e.title, e.kind, e.startsOn, e.endsOn, e.startTime, e.location, e.description, e.public ? 1 : 0, new Date().toISOString(), c.get("user").id, id, e.version).run();
  if (!r.meta.changes) throw new HttpError(409, "version_desactualizada", "Otro organizador modificó este evento. Recargá la lista.");
  return c.json({ ok: true });
});

cmsRoutes.delete("/events/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El evento");
  const db = c.env.DB;
  const r = await db.prepare("SELECT title FROM site_events WHERE id = ?").bind(id).first<{ title: string }>();
  if (!r) throw notFound("El evento");
  await db.batch([db.prepare("DELETE FROM site_events WHERE id = ?").bind(id), auditStmt(db, c.get("user").id, "eliminar", "evento", null, `Quitó del calendario "${r.title}"`)]);
  return c.json({ ok: true });
});

// Torneos publicados (para elegir el "próximo torneo destacado" del inicio): sólo lectura, viven en su módulo.
cmsRoutes.get("/tournament-options", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT t.id, t.name, t.start_date, t.status FROM tournaments t WHERE t.public_visible = 1 AND t.status IN ('programado', 'en_curso') ORDER BY t.start_date LIMIT 200",
  ).all<{ id: number; name: string; start_date: string; status: string }>();
  return c.json({ items: results.map((r) => ({ id: r.id, name: r.name, startDate: r.start_date, status: r.status })) });
});
