import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionUser } from "@shared/types";
import type { AppEnv } from "../types";
import { sha256Hex, toBase64Url } from "./encoding";

const DAY_MS = 86_400_000;
/** Sólo se refresca la sesión en la base si pasaron más de 12 h (ahorra escrituras en D1). */
const TOUCH_INTERVAL_MS = DAY_MS / 2;

function isSecure(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

/** En HTTPS se usa el prefijo __Host- (cookie atada al dominio exacto, Secure y Path=/). */
export function cookieName(c: Context<AppEnv>): string {
  return isSecure(c) ? "__Host-pt_session" : "pt_session";
}

export function ttlDays(env: Env): number {
  const n = Number(env.SESSION_TTL_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : 30;
}

export async function createSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await sha256Hex(token);
  const days = ttlDays(c.env);
  const expires = new Date(Date.now() + days * DAY_MS);
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)")
    .bind(id, userId, expires.toISOString(), (c.req.header("user-agent") ?? "").slice(0, 200))
    .run();
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Strict",
    path: "/",
    maxAge: days * 86_400,
  });
}

interface SessionRow {
  session_id: string;
  expires_at: string;
  last_seen_at: string;
  id: number;
  username: string;
  display_name: string;
  role: SessionUser["role"];
}

export async function readSession(c: Context<AppEnv>): Promise<{ user: SessionUser; sessionId: string } | null> {
  const token = getCookie(c, cookieName(c));
  if (!token || token.length > 100) return null;
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.id, u.username, u.display_name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND u.active = 1`,
  )
    .bind(id)
    .first<SessionRow>();
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
    // Vencimiento deslizante: cada uso renueva la validez.
    const expires = new Date(now + ttlDays(c.env) * DAY_MS).toISOString();
    await c.env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .bind(new Date(now).toISOString(), expires, id)
      .run();
    setCookie(c, cookieName(c), token, {
      httpOnly: true,
      secure: isSecure(c),
      sameSite: "Strict",
      path: "/",
      maxAge: ttlDays(c.env) * 86_400,
    });
  }
  return {
    sessionId: id,
    user: { id: row.id, username: row.username, displayName: row.display_name, role: row.role },
  };
}

export async function destroySession(c: Context<AppEnv>, sessionId: string | undefined): Promise<void> {
  if (sessionId) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  deleteCookie(c, cookieName(c), { path: "/", secure: isSecure(c) });
}
