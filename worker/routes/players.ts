import { Hono } from "hono";
import { activeToggleSchema, playerListQuerySchema, playerSchema } from "@shared/schemas";
import { APP_TIMEZONE, type CategoryChangeType, type Gender } from "@shared/constants";
import { normalizeText, searchTerms, todayIn } from "@shared/text";
import type { CategoryChange, DuplicateCandidate, Paginated, Player, PlayerDetail } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { parseBody, parseId, parseQuery } from "../lib/validate";
import { auditStmt } from "../lib/audit";

interface PlayerRow {
  id: number;
  code: string;
  first_name: string;
  last_name: string;
  nickname: string | null;
  gender: Gender;
  main_category_id: number;
  main_category_name: string;
  document_number: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  city: string | null;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT p.id, p.code, p.first_name, p.last_name, p.nickname, p.gender, p.main_category_id,
         c.name AS main_category_name, p.document_number, p.phone, p.email, p.birth_date, p.city,
         p.notes, p.active, p.created_at, p.updated_at
    FROM players p JOIN categories c ON c.id = p.main_category_id`;

const map = (r: PlayerRow): Player => ({
  id: r.id,
  code: r.code,
  firstName: r.first_name,
  lastName: r.last_name,
  nickname: r.nickname,
  gender: r.gender,
  mainCategoryId: r.main_category_id,
  mainCategoryName: r.main_category_name,
  documentNumber: r.document_number,
  phone: r.phone,
  email: r.email,
  birthDate: r.birth_date,
  city: r.city,
  notes: r.notes,
  active: r.active === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function buildSearchText(p: { firstName: string; lastName: string; nickname: string | null; documentNumber: string | null }) {
  return normalizeText([p.firstName, p.lastName, p.nickname ?? "", p.documentNumber ?? ""].join(" "));
}

/** Escapa comodines de LIKE. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

async function getPlayer(db: D1Database, id: number): Promise<Player> {
  const row = await db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<PlayerRow>();
  if (!row) throw notFound("El jugador");
  return map(row);
}

async function assertCategory(db: D1Database, categoryId: number, gender: Gender, requireActive: boolean) {
  const cat = await db.prepare("SELECT gender, active FROM categories WHERE id = ?").bind(categoryId).first<{ gender: Gender; active: number }>();
  if (!cat) throw badRequest("La categoría elegida no existe", { mainCategoryId: "Categoría inexistente" });
  if (cat.gender !== gender) {
    throw badRequest("La categoría principal debe ser de la misma rama que el jugador", { mainCategoryId: "No corresponde a la rama" });
  }
  if (requireActive && cat.active !== 1) {
    throw badRequest("La categoría elegida está inactiva", { mainCategoryId: "Categoría inactiva" });
  }
}

async function activeSeasonId(db: D1Database): Promise<number | null> {
  const row = await db.prepare("SELECT id FROM seasons WHERE status = 'activa'").first<{ id: number }>();
  return row?.id ?? null;
}

export const playerRoutes = new Hono<AppEnv>();

playerRoutes.get("/", async (c) => {
  const q = parseQuery(c, playerListQuerySchema);
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (q.status === "activos") conditions.push("p.active = 1");
  else if (q.status === "inactivos") conditions.push("p.active = 0");
  if (q.gender) {
    conditions.push("p.gender = ?");
    binds.push(q.gender);
  }
  if (q.categoryId) {
    conditions.push("p.main_category_id = ?");
    binds.push(q.categoryId);
  }
  if (q.q) {
    const code = q.q.trim().match(/^j-?0*(\d+)$/i);
    if (code) {
      conditions.push("p.id = ?");
      binds.push(Number(code[1]));
    } else {
      for (const term of searchTerms(q.q)) {
        conditions.push("p.search_text LIKE ? ESCAPE '\\'");
        binds.push(`%${likeEscape(term)}%`);
      }
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (q.page - 1) * q.pageSize;
  const [rows, count] = await c.env.DB.batch([
    c.env.DB
      .prepare(`${SELECT} ${where} ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`)
      .bind(...binds, q.pageSize, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM players p ${where}`).bind(...binds),
  ]);
  const body: Paginated<Player> = {
    items: (rows!.results as PlayerRow[]).map(map),
    total: (count!.results[0] as { n: number }).n,
    page: q.page,
    pageSize: q.pageSize,
  };
  return c.json(body);
});

/** Jugadores con el mismo nombre y apellido (normalizados), para advertir posibles duplicados. */
playerRoutes.get("/duplicates", async (c) => {
  const first = normalizeText(c.req.query("firstName") ?? "");
  const last = normalizeText(c.req.query("lastName") ?? "");
  const exclude = Number(c.req.query("excludeId") ?? 0) || 0;
  if (!first || !last) return c.json({ items: [] });
  const { results } = await c.env.DB.prepare(
    `${SELECT} WHERE p.search_text LIKE ? ESCAPE '\\' AND p.id <> ? ORDER BY p.id LIMIT 20`,
  )
    .bind(`${likeEscape(first)} ${likeEscape(last)}%`, exclude)
    .all<PlayerRow>();
  const items: DuplicateCandidate[] = results
    .filter((r) => normalizeText(r.first_name) === first && normalizeText(r.last_name) === last)
    .map((r) => ({
      id: r.id,
      code: r.code,
      firstName: r.first_name,
      lastName: r.last_name,
      mainCategoryName: r.main_category_name,
      active: r.active === 1,
    }));
  return c.json({ items });
});

playerRoutes.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El jugador");
  const player = await getPlayer(c.env.DB, id);
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, cf.name AS from_name, ct.name AS to_name, h.change_type, h.reason, h.effective_date, u.display_name AS user_name
       FROM player_category_changes h
       LEFT JOIN categories cf ON cf.id = h.from_category_id
       JOIN categories ct ON ct.id = h.to_category_id
       LEFT JOIN users u ON u.id = h.created_by
      WHERE h.player_id = ?
      ORDER BY h.effective_date DESC, h.id DESC`,
  )
    .bind(id)
    .all<{ id: number; from_name: string | null; to_name: string; change_type: CategoryChangeType; reason: string | null; effective_date: string; user_name: string | null }>();
  const categoryHistory: CategoryChange[] = results.map((h) => ({
    id: h.id,
    fromCategoryName: h.from_name,
    toCategoryName: h.to_name,
    changeType: h.change_type,
    reason: h.reason,
    effectiveDate: h.effective_date,
    createdByName: h.user_name,
  }));
  const detail: PlayerDetail = { ...player, categoryHistory };
  return c.json({ item: detail });
});

playerRoutes.post("/", async (c) => {
  const input = await parseBody(c, playerSchema);
  const db = c.env.DB;
  const userId = c.get("user").id;
  await assertCategory(db, input.mainCategoryId, input.gender, true);
  const seasonId = await activeSeasonId(db);
  const today = todayIn(APP_TIMEZONE);
  // Todo en un batch (transacción): jugador + alta en historial + auditoría.
  const [inserted] = await db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO players (first_name, last_name, nickname, gender, main_category_id, document_number, phone, email,
                              birth_date, city, notes, search_text, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        input.firstName, input.lastName, input.nickname, input.gender, input.mainCategoryId, input.documentNumber,
        input.phone, input.email, input.birthDate, input.city, input.notes, buildSearchText(input), userId,
      ),
    db
      .prepare(
        `INSERT INTO player_category_changes (player_id, from_category_id, to_category_id, season_id, change_type, effective_date, created_by)
         VALUES (last_insert_rowid(), NULL, ?, ?, 'alta', ?, ?)`,
      )
      .bind(input.mainCategoryId, seasonId, today, userId),
    db
      .prepare(
        `INSERT INTO audit_log (user_id, action, entity, entity_id, summary)
         VALUES (?, 'crear', 'jugador', (SELECT player_id FROM player_category_changes WHERE id = last_insert_rowid()), ?)`,
      )
      .bind(userId, `Dio de alta a ${input.firstName} ${input.lastName}`),
  ]);
  const player = await getPlayer(db, inserted!.results[0]!.id);
  return c.json({ item: player }, 201);
});

playerRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El jugador");
  const input = await parseBody(c, playerSchema);
  const db = c.env.DB;
  const userId = c.get("user").id;
  const current = await getPlayer(db, id);
  const categoryChanged = current.mainCategoryId !== input.mainCategoryId;
  if (current.gender !== input.gender) {
    // Cambiar la rama de alguien con torneos o puntos dejaría su historial en rankings de la otra rama.
    const history = await db
      .prepare("SELECT (SELECT COUNT(*) FROM tournament_team_players WHERE player_id = ?1) + (SELECT COUNT(*) FROM point_movements WHERE player_id = ?1) AS n")
      .bind(id)
      .first<{ n: number }>();
    if ((history?.n ?? 0) > 0) {
      throw conflict("El jugador ya tiene torneos o puntos registrados: no se puede cambiar su rama. Si fue un error de carga, dalo de alta nuevamente con la rama correcta.", { gender: "Tiene historial" });
    }
  }
  // Sólo se exige categoría activa si se está cambiando.
  await assertCategory(db, input.mainCategoryId, input.gender, categoryChanged);

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE players SET first_name = ?, last_name = ?, nickname = ?, gender = ?, main_category_id = ?, document_number = ?,
                phone = ?, email = ?, birth_date = ?, city = ?, notes = ?, search_text = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        input.firstName, input.lastName, input.nickname, input.gender, input.mainCategoryId, input.documentNumber,
        input.phone, input.email, input.birthDate, input.city, input.notes, buildSearchText(input),
        new Date().toISOString(), id,
      ),
  ];
  if (categoryChanged) {
    const type = input.categoryChangeType && input.categoryChangeType !== "alta" ? input.categoryChangeType : "manual";
    stmts.push(
      db
        .prepare(
          `INSERT INTO player_category_changes (player_id, from_category_id, to_category_id, season_id, change_type, reason, effective_date, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, current.mainCategoryId, input.mainCategoryId, await activeSeasonId(db), type, input.categoryChangeReason, todayIn(APP_TIMEZONE), userId),
    );
  }
  stmts.push(
    auditStmt(db, userId, "editar", "jugador", id, `Editó a ${input.firstName} ${input.lastName}${categoryChanged ? " (cambio de categoría)" : ""}`),
  );
  await db.batch(stmts);
  return c.json({ item: await getPlayer(db, id) });
});

playerRoutes.patch("/:id/active", async (c) => {
  const id = parseId(c.req.param("id"), "El jugador");
  const { active } = await parseBody(c, activeToggleSchema);
  const db = c.env.DB;
  const player = await getPlayer(db, id);
  if (active) {
    const cat = await db.prepare("SELECT active FROM categories WHERE id = ?").bind(player.mainCategoryId).first<{ active: number }>();
    if (cat?.active !== 1) throw badRequest("Su categoría principal está inactiva. Editá al jugador y asignale otra categoría.");
  }
  await db.batch([
    db.prepare("UPDATE players SET active = ?, updated_at = ? WHERE id = ?").bind(active ? 1 : 0, new Date().toISOString(), id),
    auditStmt(db, c.get("user").id, active ? "reactivar" : "desactivar", "jugador", id, `${active ? "Reactivó" : "Desactivó"} a ${player.firstName} ${player.lastName}`),
  ]);
  return c.json({ item: await getPlayer(db, id) });
});
