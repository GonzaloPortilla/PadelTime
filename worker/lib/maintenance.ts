/**
 * Mantenimiento: borra sólo datos temporales (sesiones vencidas e intentos de ingreso viejos).
 * Nunca toca jugadores, torneos, puntos ni auditoría.
 */
export async function cleanupExpired(db: D1Database, now = new Date()): Promise<{ sessions: number; attempts: number }> {
  const iso = now.toISOString();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const [sessions, attempts] = await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(iso),
    db.prepare("DELETE FROM login_attempts WHERE window_start < ? AND (locked_until IS NULL OR locked_until < ?)").bind(dayAgo, iso),
  ]);
  return { sessions: sessions!.meta.changes, attempts: attempts!.meta.changes };
}
