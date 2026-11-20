import { Hono } from "hono";
import { activeToggleSchema, categorySchema, divisionSchema } from "@shared/schemas";
import { GENDER_LABEL, GENDERS, type Gender } from "@shared/constants";
import type { Category, Division } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";

interface CategoryRow {
  id: number;
  name: string;
  gender: Gender;
  level: number;
  description: string | null;
  active: number;
  player_count: number;
  tournament_count: number;
}
interface DivisionRow {
  id: number;
  category_id: number;
  name: string;
  sort_order: number;
  active: number;
}

const mapDivision = (r: DivisionRow): Division => ({
  id: r.id,
  categoryId: r.category_id,
  name: r.name,
  sortOrder: r.sort_order,
  active: r.active === 1,
});

const CATEGORY_SELECT = `
  SELECT c.id, c.name, c.gender, c.level, c.description, c.active,
         (SELECT COUNT(*) FROM players p WHERE p.main_category_id = c.id AND p.active = 1) AS player_count,
         (SELECT COUNT(*) FROM tournaments t WHERE t.category_id = c.id) AS tournament_count
    FROM categories c`;

async function loadCategories(db: D1Database, where = "", binds: unknown[] = []): Promise<Category[]> {
  const [cats, divs] = await db.batch([
    db.prepare(`${CATEGORY_SELECT} ${where} ORDER BY c.gender DESC, c.level, c.name`).bind(...binds),
    db.prepare("SELECT id, category_id, name, sort_order, active FROM divisions ORDER BY sort_order, name"),
  ]);
  const byCategory = new Map<number, Division[]>();
  for (const d of divs!.results as DivisionRow[]) {
    const list = byCategory.get(d.category_id) ?? [];
    list.push(mapDivision(d));
    byCategory.set(d.category_id, list);
  }
  return (cats!.results as CategoryRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    gender: r.gender,
    level: r.level,
    description: r.description,
    active: r.active === 1,
    playerCount: r.player_count,
    tournamentCount: r.tournament_count,
    divisions: byCategory.get(r.id) ?? [],
  }));
}

async function getCategory(db: D1Database, id: number): Promise<Category> {
  const [cat] = await loadCategories(db, "WHERE c.id = ?", [id]);
  if (!cat) throw notFound("La categoría");
  return cat;
}

export const categoryRoutes = new Hono<AppEnv>();

categoryRoutes.get("/", async (c) => {
  const gender = c.req.query("gender");
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (gender && (GENDERS as readonly string[]).includes(gender)) {
    conditions.push("c.gender = ?");
    binds.push(gender);
  }
  if (c.req.query("active") === "1") conditions.push("c.active = 1");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return c.json({ items: await loadCategories(c.env.DB, where, binds) });
});

categoryRoutes.get("/:id", async (c) => {
  return c.json({ item: await getCategory(c.env.DB, parseId(c.req.param("id"), "La categoría")) });
});

categoryRoutes.post("/", async (c) => {
  const input = await parseBody(c, categorySchema);
  const db = c.env.DB;
  const [res] = await db.batch<{ id: number }>([
    db
      .prepare("INSERT INTO categories (name, gender, level, description, active) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(input.name, input.gender, input.level, input.description, input.active ? 1 : 0),
    db
      .prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'crear', 'categoria', last_insert_rowid(), ?)")
      .bind(c.get("user").id, `Creó la categoría ${input.name} (${GENDER_LABEL[input.gender]})`),
  ]);
  return c.json({ item: await getCategory(db, res!.results[0]!.id) }, 201);
});

categoryRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La categoría");
  const input = await parseBody(c, categorySchema);
  const db = c.env.DB;
  const current = await getCategory(db, id);
  if (current.gender !== input.gender) {
    const used = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM players WHERE main_category_id = ?1) +
                (SELECT COUNT(*) FROM tournaments WHERE category_id = ?1) AS n`,
      )
      .bind(id)
      .first<{ n: number }>();
    if ((used?.n ?? 0) > 0) throw conflict("No se puede cambiar la rama de una categoría con jugadores o torneos");
  }
  if (current.active && !input.active) await assertCanDeactivate(db, id);
  await db.batch([
    db
      .prepare("UPDATE categories SET name = ?, gender = ?, level = ?, description = ?, active = ?, updated_at = ? WHERE id = ?")
      .bind(input.name, input.gender, input.level, input.description, input.active ? 1 : 0, new Date().toISOString(), id),
    auditStmt(db, c.get("user").id, "editar", "categoria", id, `Editó la categoría ${input.name}`),
  ]);
  return c.json({ item: await getCategory(db, id) });
});

async function assertCanDeactivate(db: D1Database, id: number) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM players WHERE main_category_id = ? AND active = 1")
    .bind(id)
    .first<{ n: number }>();
  const n = row?.n ?? 0;
  if (n > 0) {
    throw conflict(
      `No se puede desactivar: ${n} jugador${n === 1 ? " activo la tiene" : "es activos la tienen"} como categoría principal. Cambiales la categoría primero.`,
    );
  }
}

categoryRoutes.patch("/:id/active", async (c) => {
  const id = parseId(c.req.param("id"), "La categoría");
  const { active } = await parseBody(c, activeToggleSchema);
  const db = c.env.DB;
  const current = await getCategory(db, id);
  if (!active) await assertCanDeactivate(db, id);
  await db.batch([
    db.prepare("UPDATE categories SET active = ?, updated_at = ? WHERE id = ?").bind(active ? 1 : 0, new Date().toISOString(), id),
    auditStmt(db, c.get("user").id, active ? "reactivar" : "desactivar", "categoria", id, `${active ? "Reactivó" : "Desactivó"} la categoría ${current.name}`),
  ]);
  return c.json({ item: await getCategory(db, id) });
});

/** Borrado definitivo sólo si la categoría nunca se usó (para corregir errores de carga). */
categoryRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La categoría");
  const db = c.env.DB;
  const current = await getCategory(db, id);
  const used = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM players WHERE main_category_id = ?1)
            + (SELECT COUNT(*) FROM tournaments WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM player_category_changes WHERE from_category_id = ?1 OR to_category_id = ?1)
            + (SELECT COUNT(*) FROM point_movements WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM initial_balances WHERE category_id = ?1) AS n`,
    )
    .bind(id)
    .first<{ n: number }>();
  if ((used?.n ?? 0) > 0) throw conflict("La categoría tiene jugadores, torneos o historial asociados. Desactivala en lugar de eliminarla.");
  await db.batch([
    db.prepare("DELETE FROM divisions WHERE category_id = ?").bind(id),
    db.prepare("DELETE FROM categories WHERE id = ?").bind(id),
    auditStmt(db, c.get("user").id, "eliminar", "categoria", id, `Eliminó la categoría ${current.name}`),
  ]);
  return c.json({ ok: true });
});

categoryRoutes.post("/:id/divisions", async (c) => {
  const categoryId = parseId(c.req.param("id"), "La categoría");
  const input = await parseBody(c, divisionSchema);
  const db = c.env.DB;
  const category = await getCategory(db, categoryId);
  await db.batch([
    db
      .prepare("INSERT INTO divisions (category_id, name, sort_order, active) VALUES (?, ?, ?, ?)")
      .bind(categoryId, input.name, input.sortOrder, input.active ? 1 : 0),
    db
      .prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'crear', 'division', last_insert_rowid(), ?)")
      .bind(c.get("user").id, `Creó la división ${input.name} en ${category.name}`),
  ]);
  return c.json({ item: await getCategory(db, categoryId) }, 201);
});

export const divisionRoutes = new Hono<AppEnv>();

async function getDivision(db: D1Database, id: number): Promise<DivisionRow> {
  const row = await db.prepare("SELECT id, category_id, name, sort_order, active FROM divisions WHERE id = ?").bind(id).first<DivisionRow>();
  if (!row) throw notFound("La división");
  return row;
}

divisionRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La división");
  const input = await parseBody(c, divisionSchema);
  const db = c.env.DB;
  const division = await getDivision(db, id);
  await db.batch([
    db
      .prepare("UPDATE divisions SET name = ?, sort_order = ?, active = ?, updated_at = ? WHERE id = ?")
      .bind(input.name, input.sortOrder, input.active ? 1 : 0, new Date().toISOString(), id),
    auditStmt(db, c.get("user").id, "editar", "division", id, `Editó la división ${input.name}`),
  ]);
  return c.json({ item: await getCategory(db, division.category_id) });
});

divisionRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La división");
  const db = c.env.DB;
  const division = await getDivision(db, id);
  const used = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM tournaments WHERE division_id = ?1)
            + (SELECT COUNT(*) FROM point_movements WHERE division_id = ?1)
            + (SELECT COUNT(*) FROM initial_balances WHERE division_id = ?1) AS n`,
    )
    .bind(id)
    .first<{ n: number }>();
  if ((used?.n ?? 0) > 0) throw badRequest("La división tiene torneos o puntos asociados. Desactivala en lugar de eliminarla.");
  await db.batch([
    db.prepare("DELETE FROM divisions WHERE id = ?").bind(id),
    auditStmt(db, c.get("user").id, "eliminar", "division", id, `Eliminó la división ${division.name}`),
  ]);
  return c.json({ item: await getCategory(db, division.category_id) });
});
