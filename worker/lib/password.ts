import { fromBase64, toBase64 } from "./encoding";

/**
 * Hash de contraseñas con PBKDF2-SHA256 (WebCrypto nativo de Workers).
 * Formato: pbkdf2-sha256$<iteraciones>$<salt base64>$<hash base64>
 * Las iteraciones quedan guardadas en cada hash: se pueden subir sin invalidar los existentes.
 */
const ALGORITHM = "pbkdf2-sha256";
const KEY_BITS = 256;
export const MAX_ITERATIONS = 100_000; // límite de la implementación de Workers
export const DEFAULT_ITERATIONS = 30_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export function resolveIterations(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1000) return DEFAULT_ITERATIONS;
  return Math.min(n, MAX_ITERATIONS);
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `${ALGORITHM}$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export function parseHash(stored: string): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return null;
  try {
    return { iterations, salt: fromBase64(parts[2]!), hash: fromBase64(parts[3]!) };
  } catch {
    return null;
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function verifyPassword(password: string, stored: string): Promise<{ valid: boolean; iterations: number }> {
  const parsed = parseHash(stored);
  if (!parsed) return { valid: false, iterations: 0 };
  const candidate = await derive(password, parsed.salt, parsed.iterations);
  return { valid: timingSafeEqual(candidate, parsed.hash), iterations: parsed.iterations };
}

/**
 * Se usa cuando el usuario no existe, para que la respuesta tarde lo mismo
 * y no se pueda deducir qué usuarios existen midiendo tiempos.
 */
export async function burnPasswordCheck(password: string, iterations: number): Promise<void> {
  await derive(password, new Uint8Array(16), iterations);
}
