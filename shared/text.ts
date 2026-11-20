/** Minúsculas, sin acentos ni signos, espacios simples. Se usa para búsquedas. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ@.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Divide un texto de búsqueda en términos normalizados (máx. 6). */
export function searchTerms(query: string): string[] {
  return normalizeText(query).split(" ").filter(Boolean).slice(0, 6);
}

/** Fecha de hoy (YYYY-MM-DD) en una zona horaria dada. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Valida una fecha de calendario real en formato YYYY-MM-DD. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
