import { Hono } from "hono";
import { changePasswordSchema, loginSchema } from "@shared/schemas";
import type { SessionUser } from "@shared/types";
import type { AppEnv } from "../types";
import { HttpError } from "../lib/errors";
import { burnPasswordCheck, hashPassword, resolveIterations, verifyPassword } from "../lib/password";
import { clearFailures, lockedUntil, registerFailure } from "../lib/rate-limit";
import { createSession, destroySession, readSession } from "../lib/session";
import { parseBody } from "../lib/validate";
import { auditStmt } from "../lib/audit";

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: SessionUser["role"];
  password_hash: string;
}

const toSessionUser = (u: UserRow): SessionUser => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
});

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const { username, password } = await parseBody(c, loginSchema);
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const keys = [`u:${username.toLowerCase()}`, `ip:${ip}`];
  const db = c.env.DB;

  const locked = await lockedUntil(db, keys);
  if (locked) {
    const minutes = Math.max(1, Math.ceil((locked - Date.now()) / 60_000));
    throw new HttpError(429, "bloqueado", `Demasiados intentos fallidos. Probá de nuevo en ${minutes} min.`);
  }

  const iterations = resolveIterations(c.env.PBKDF2_ITERATIONS);
  const user = await db
    .prepare("SELECT id, username, display_name, role, password_hash FROM users WHERE username = ? AND active = 1")
    .bind(username)
    .first<UserRow>();

  let valid = false;
  let storedIterations = 0;
  if (user) {
    ({ valid, iterations: storedIterations } = await verifyPassword(password, user.password_hash));
  } else {
    await burnPasswordCheck(password, iterations);
  }

  if (!user || !valid) {
    await registerFailure(db, keys);
    throw new HttpError(401, "credenciales_invalidas", "Usuario o contraseña incorrectos");
  }

  const updates: D1PreparedStatement[] = [
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), user.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?").bind(user.id, new Date().toISOString()),
  ];
  // Si cambió la configuración a más iteraciones, se actualiza el hash en el próximo ingreso.
  if (storedIterations < iterations) {
    updates.push(
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password, iterations), user.id),
    );
  }
  await db.batch(updates);
  await clearFailures(db, keys);
  await createSession(c, user.id);
  return c.json({ user: toSessionUser(user) });
});

authRoutes.post("/logout", async (c) => {
  const session = await readSession(c);
  await destroySession(c, session?.sessionId);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  // Sin sesión responde 200 con user null: es el chequeo inicial de la app, no un error.
  const session = await readSession(c);
  return c.json({ user: session?.user ?? null });
});

authRoutes.post("/password", async (c) => {
  const session = await readSession(c);
  if (!session) throw new HttpError(401, "no_autenticado", "No hay una sesión activa");
  const { currentPassword, newPassword } = await parseBody(c, changePasswordSchema);
  const db = c.env.DB;
  const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?").bind(session.user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.password_hash)).valid) {
    throw new HttpError(400, "solicitud_invalida", "La contraseña actual no es correcta", {
      currentPassword: "Contraseña incorrecta",
    });
  }
  if (currentPassword === newPassword) {
    throw new HttpError(400, "solicitud_invalida", "La nueva contraseña debe ser distinta", {
      newPassword: "Debe ser distinta de la actual",
    });
  }
  const hash = await hashPassword(newPassword, resolveIterations(c.env.PBKDF2_ITERATIONS));
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(hash, new Date().toISOString(), session.user.id),
    // Cierra todas las demás sesiones del usuario.
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(session.user.id, session.sessionId),
    auditStmt(db, session.user.id, "editar", "usuario", session.user.id, "Cambió su contraseña"),
  ]);
  return c.json({ ok: true });
});
