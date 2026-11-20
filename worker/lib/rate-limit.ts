/**
 * Bloqueo progresivo de intentos de ingreso, persistido en D1.
 * Se controla por usuario y por IP: 5 fallos en 15 minutos bloquean 15 minutos.
 */
export const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

interface AttemptRow {
  key: string;
  failures: number;
  window_start: string;
  locked_until: string | null;
}

export async function lockedUntil(db: D1Database, keys: string[]): Promise<number | null> {
  const placeholders = keys.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT key, failures, window_start, locked_until FROM login_attempts WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<AttemptRow>();
  const now = Date.now();
  let max: number | null = null;
  for (const row of results) {
    if (row.locked_until) {
      const until = Date.parse(row.locked_until);
      if (until > now && (max === null || until > max)) max = until;
    }
  }
  return max;
}

export async function registerFailure(db: D1Database, keys: string[]): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS).toISOString();
  const lockUntil = new Date(now.getTime() + LOCK_MS).toISOString();
  // Upsert atómico: reinicia la ventana si venció y bloquea al llegar al máximo.
  const stmt = db.prepare(
    `INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES (?1, 1, ?2, NULL)
     ON CONFLICT (key) DO UPDATE SET
       failures = CASE WHEN window_start < ?3 THEN 1 ELSE failures + 1 END,
       window_start = CASE WHEN window_start < ?3 THEN ?2 ELSE window_start END,
       locked_until = CASE
         WHEN (CASE WHEN window_start < ?3 THEN 1 ELSE failures + 1 END) >= ${MAX_FAILURES} THEN ?4
         ELSE locked_until END`,
  );
  await db.batch(keys.map((k) => stmt.bind(k, now.toISOString(), windowStart, lockUntil)));
}

export async function clearFailures(db: D1Database, keys: string[]): Promise<void> {
  const stmt = db.prepare("DELETE FROM login_attempts WHERE key = ?");
  await db.batch(keys.map((k) => stmt.bind(k)));
}
