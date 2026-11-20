import { Hono } from "hono";
import { userCreateSchema, userUpdateSchema } from "@shared/schemas";
import type { User } from "@shared/types";
import type { AppEnv } from "../types";
import { badRequest, HttpError, notFound } from "../lib/errors";
import { hashPassword, resolveIterations } from "../lib/password";
import { parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";

interface Row {
  id: number;
  username: string;
  display_name: string;
  role: User["role"];
  active: number;
  created_at: string;
  last_login_at: string | null;
}

const map = (r: Row): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  active: r.active === 1,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

const COLUMNS = "id, username, display_name, role, active, created_at, last_login_at";

export const userRoutes = new Hono<AppEnv>();

// Gestión de organizadores: sólo administradores.
userRoutes.use("*", async (c, next) => {
  if (c.get("user").role !== "admin") throw new HttpError(403, "sin_permiso", "Sólo un administrador puede gestionar usuarios");
  await next();
});

userRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM users ORDER BY active DESC, display_name`).all<Row>();
  return c.json({ items: results.map(map) });
});

userRoutes.post("/", async (c) => {
  const input = await parseBody(c, userCreateSchema);
  const db = c.env.DB;
  const hash = await hashPassword(input.password, resolveIterations(c.env.PBKDF2_ITERATIONS));
  const [inserted] = await db.batch<Row>([
    db
      .prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?) RETURNING ${COLUMNS}`)
      .bind(input.username.toLowerCase(), input.displayName, hash, input.role),
    db
      .prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'crear', 'usuario', last_insert_rowid(), ?)")
      .bind(c.get("user").id, `Creó el usuario ${input.username.toLowerCase()}`),
  ]);
  return c.json({ item: map(inserted!.results[0]!) }, 201);
});

userRoutes.put("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "El usuario");
  const input = await parseBody(c, userUpdateSchema);
  const db = c.env.DB;
  const me = c.get("user");
  const current = await db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).bind(id).first<Row>();
  if (!current) throw notFound("El usuario");

  if (id === me.id && (!input.active || input.role !== "admin")) {
    throw badRequest("No podés desactivarte ni quitarte el rol de administrador a vos mismo");
  }
  if (current.role === "admin" && current.active === 1 && (input.role !== "admin" || !input.active)) {
    const admins = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").first<{ n: number }>();
    if ((admins?.n ?? 0) <= 1) throw badRequest("Debe quedar al menos un administrador activo");
  }

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE users SET display_name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?")
      .bind(input.displayName, input.role, input.active ? 1 : 0, now, id),
  ];
  if (input.password) {
    const hash = await hashPassword(input.password, resolveIterations(c.env.PBKDF2_ITERATIONS));
    stmts.push(db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(hash, id));
  }
  if (input.password || !input.active) {
    // Al desactivar o resetear contraseña, se cierran sus sesiones.
    stmts.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  }
  stmts.push(auditStmt(db, me.id, "editar", "usuario", id, `Editó el usuario ${current.username}${input.password ? " (nueva contraseña)" : ""}`));
  await db.batch(stmts);
  const updated = await db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).bind(id).first<Row>();
  return c.json({ item: map(updated!) });
});
