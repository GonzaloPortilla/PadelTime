import type { Gender } from "@shared/constants";
import { matchPlayer, nameSimilarity, normalizeName, type DirectoryPlayer, type PlayerMatch } from "@shared/names";
import type { CellValue, SheetData, Workbook } from "./parse";

/**
 * Lógica pura del asistente de importación de rankings: detección de encabezados, sugerencia de
 * mapeo, extracción y normalización de filas, interpretación de categorías/temporadas y
 * agrupación de jugadores con detección de duplicados. Sin acceso a red: testeable.
 */

export const FIELDS = ["name", "firstName", "lastName", "points", "category", "division", "season", "position", "gender"] as const;
export type FieldKey = (typeof FIELDS)[number];
export const FIELD_LABEL: Record<FieldKey, string> = {
  name: "Jugador (nombre completo)",
  firstName: "Nombre",
  lastName: "Apellido",
  points: "Puntos",
  category: "Categoría",
  division: "División",
  season: "Temporada",
  position: "Posición (referencia)",
  gender: "Rama (Caballeros/Damas)",
};

export type Source = "columna" | "fija" | "hoja" | "ninguna";
export type NameOrder = "auto" | "nombre_apellido" | "apellido_nombre";

export interface Mapping {
  sheets: string[];
  headerRow: number; // índice (base 0) de la fila de encabezados; -1 = la planilla no tiene títulos
  columns: Partial<Record<FieldKey, number>>;
  categorySource: Exclude<Source, "ninguna">;
  categoryFixed: number | null;
  divisionSource: Source;
  divisionFixed: number | null;
  seasonSource: Exclude<Source, "ninguna">;
  seasonFixed: number | null;
  nameOrder: NameOrder;
  /** Rama a usar si el texto de la categoría no la indica. */
  defaultGender: Gender;
}

export const cellText = (v: CellValue | undefined): string => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : v.trim());
const normDigits = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ───────────────────────────── Encabezados ─────────────────────────────
const HEADER_WORDS: Record<FieldKey, RegExp> = {
  name: /^(jugador(es|a)?|nombre (y|e) apellido|apellido (y|,)? ?nombres?|nombre completo|participante|player|apellido y nombre|jugador nombre)$/,
  firstName: /^(nombres?|first name)$/,
  lastName: /^(apellidos?|last name)$/,
  points: /^(total( de)? (puntos|pts)|puntos totales|total|puntos|pts|puntaje( total)?|points|ptos)$/,
  category: /^(categoria|cat|categ|category)$/,
  division: /^(division|div|zona|grupo)$/,
  season: /^(temporada|ano|season|anio)$/,
  position: /^(posicion|pos|puesto|n|nro|numero|ranking|rank|lugar)$/,
  gender: /^(rama|genero|sexo|gender)$/,
};

export function detectField(header: string): FieldKey | null {
  const h = normDigits(header).replace(/\s+/g, " ");
  if (!h) return null;
  for (const f of FIELDS) if (HEADER_WORDS[f].test(h)) return f;
  return null;
}

/** Fila de encabezados: la primera (de las 30 iniciales) con 2+ títulos reconocibles; si no, la primera con 2+ celdas. */
export function detectHeaderRow(rows: CellValue[][]): number {
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    const found = new Set((rows[i] ?? []).map((v) => detectField(cellText(v))).filter(Boolean));
    if (found.size >= 2 && (found.has("name") || found.has("lastName") || found.has("points"))) return i;
  }
  // Sin títulos reconocibles: si la primera fila con datos ya parece un jugador (texto + número, igual que
  // la siguiente), la planilla no tiene fila de títulos y el primer jugador NO debe tomarse como encabezado.
  const looksLikeData = (r: CellValue[] | undefined) =>
    !!r && r.some((v) => typeof v === "string" && /\p{L}{2,}/u.test(v) && !detectField(v)) && r.some((v) => parsePoints(v).value !== null && cellText(v) !== "");
  for (let i = 0; i < limit; i++) {
    if ((rows[i] ?? []).filter((v) => cellText(v)).length >= 2) return looksLikeData(rows[i]) && looksLikeData(rows[i + 1]) ? i - 1 : i;
  }
  return 0;
}

export function suggestColumns(headers: string[]): Partial<Record<FieldKey, number>> {
  const out: Partial<Record<FieldKey, number>> = {};
  headers.forEach((hd, i) => {
    const f = detectField(hd);
    if (!f || out[f] !== undefined) {
      // Si hay varias columnas de puntos ("Puntos" por torneo y "Total"), se prefiere la de total.
      if (f === "points" && /total/.test(normDigits(hd))) out.points = i;
      return;
    }
    out[f] = i;
  });
  if (out.name !== undefined) { delete out.firstName; delete out.lastName; }
  // "Jugador" + "Apellido" y "Nombre" sueltos: preferir columnas separadas sólo si no hay nombre completo.
  return out;
}

/**
 * Si los títulos no se reconocen (o la planilla no tiene títulos), deduce las columnas por su contenido:
 *  - jugador: la columna con más textos tipo nombre ("PEREZ, JUAN", "Facu Diaz");
 *  - puntos: entre las columnas casi todas numéricas, la de la derecha (suele ser el total);
 *  - posición: una columna numérica correlativa 1, 2, 3… al principio.
 */
export function inferColumns(rows: CellValue[][], known: Partial<Record<FieldKey, number>> = {}): Partial<Record<FieldKey, number>> {
  const out = { ...known };
  const sample = rows.filter((r) => r.some((v) => cellText(v))).slice(0, 60);
  if (!sample.length) return out;
  const width = Math.max(...sample.map((r) => r.length));
  const used = new Set(Object.values(out));
  const stats = Array.from({ length: width }, (_, i) => {
    const values = sample.map((r) => r[i]).filter((v) => cellText(v));
    const names = values.filter((v) => typeof v === "string" && /\p{L}{2,}/u.test(v) && /\p{L}[\s,]+\p{L}/u.test(v.trim()) && !/^\d/.test(v.trim())).length;
    const nums = values.map((v) => parsePoints(v).value).filter((n): n is number => n !== null);
    const sequential = nums.length >= 3 && nums.every((n, k) => k === 0 || n === nums[k - 1]! + 1 || n === nums[k - 1]!);
    return { i, filled: values.length, nameRatio: values.length ? names / values.length : 0, numRatio: values.length ? nums.length / values.length : 0, sequential };
  });
  const minFilled = Math.max(2, Math.ceil(sample.length * 0.4));
  const hasName = out.name !== undefined || out.lastName !== undefined || out.firstName !== undefined;
  if (!hasName) {
    const best = stats.filter((c) => !used.has(c.i) && c.filled >= minFilled && c.nameRatio >= 0.6).sort((a, b) => b.nameRatio - a.nameRatio || a.i - b.i)[0];
    if (best) { out.name = best.i; used.add(best.i); }
  }
  const numeric = stats.filter((c) => !used.has(c.i) && c.filled >= minFilled && c.numRatio >= 0.7);
  if (out.position === undefined) {
    const pos = numeric.find((c) => c.sequential && (out.name === undefined || c.i < out.name));
    if (pos) { out.position = pos.i; used.add(pos.i); }
  }
  if (out.points === undefined) {
    const pts = numeric.filter((c) => !used.has(c.i) && !c.sequential).sort((a, b) => b.i - a.i)[0];
    if (pts) out.points = pts.i;
  }
  return out;
}

/** Sugerencia completa: primero por títulos, después por contenido. */
export function suggestMapping(sheet: SheetData, headerRow: number): Partial<Record<FieldKey, number>> {
  return inferColumns(sheet.rows.slice(headerRow + 1), suggestColumns(headersOf(sheet, headerRow)));
}

export function headersOf(sheet: SheetData, headerRow: number): string[] {
  const candidate = headerRow >= 0 ? sheet.rows[headerRow] ?? [] : [];
  // Una fila de título suelta ("RANKING C6 2026") no sirve como nombres de columna.
  const row = candidate.filter((v) => cellText(v)).length >= 2 ? candidate : [];
  const width = Math.max(row.length, ...sheet.rows.slice(Math.max(0, headerRow), Math.max(0, headerRow) + 20).map((r) => r.length));
  return Array.from({ length: width }, (_, i) => cellText(row[i]) || `Columna ${columnLetter(i)}`);
}

export const columnLetter = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function defaultMapping(wb: Workbook): Mapping {
  const first = wb.sheets.find((s) => s.rows.some((r) => r.some((v) => cellText(v)))) ?? wb.sheets[0]!;
  const headerRow = detectHeaderRow(first.rows);
  const columns = suggestMapping(first, headerRow);
  return {
    sheets: [first.name],
    headerRow,
    columns,
    categorySource: columns.category !== undefined ? "columna" : "fija",
    categoryFixed: null,
    divisionSource: columns.division !== undefined ? "columna" : "ninguna",
    divisionFixed: null,
    seasonSource: columns.season !== undefined ? "columna" : "fija",
    seasonFixed: null,
    nameOrder: "auto",
    defaultGender: "M",
  };
}

// ───────────────────────────── Puntos ─────────────────────────────
/**
 * Interpreta puntos escritos en formato argentino o de planilla: "1.250" = 1250, "1250 pts", "+30".
 * Rechaza decimales reales ("12,5") porque los puntos son enteros: no se redondea en silencio.
 */
export function parsePoints(v: CellValue | undefined): { value: number | null; error: string | null } {
  if (v === null || v === undefined) return { value: null, error: null };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { value: null, error: "Valor no numérico" };
    if (Math.abs(v - Math.round(v)) > 1e-9) return { value: null, error: `“${v}” no es un número entero` };
    return { value: Math.round(v), error: null };
  }
  const s = v.trim().replace(/\s*(pts?|puntos|ptos)\.?$/i, "").replace(/\s+/g, "");
  if (!s || s === "-" || s === "—") return { value: null, error: null };
  if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) return { value: Number(s.replace(/\./g, "")), error: null };
  if (/^[+-]?\d{1,3}(,\d{3})+$/.test(s)) return { value: Number(s.replace(/,/g, "")), error: null };
  if (/^[+-]?\d+$/.test(s)) return { value: Number(s), error: null };
  if (/^[+-]?\d+[.,]0+$/.test(s)) return { value: Number(s.replace(/[.,]0+$/, "")), error: null };
  if (/^[+-]?\d+[.,]\d+$/.test(s)) return { value: null, error: `“${v}” tiene decimales: los puntos deben ser enteros` };
  return { value: null, error: `“${v}” no es un número` };
}

// ───────────────────────────── Categorías, divisiones y temporadas ─────────────────────────────
const ORDINALS: Record<string, number> = {
  primera: 1, segunda: 2, tercera: 3, cuarta: 4, quinta: 5, sexta: 6, septima: 7, setima: 7, octava: 8, novena: 9, decima: 10,
};

export interface CategoryOption { id: number; name: string; gender: Gender; level: number; active: boolean }
export interface DivisionOption { id: number; name: string; categoryId: number }
export interface SeasonOption { id: number; name: string; year: number }

export function genderFromText(text: string): Gender | null {
  const t = normDigits(text);
  if (/\b(damas?|femenin[oa]s?|mujer(es)?|f|fem)\b/.test(t)) return "F";
  if (/\b(caballeros?|masculin[oa]s?|hombres?|varones?|m|masc)\b/.test(t)) return "M";
  return null;
}

/** Nivel de categoría: "C6", "6ta", "6°", "Sexta", "6" → 6. */
export function levelFromText(text: string): number | null {
  const t = normDigits(text.replace(/[°º]/g, " "));
  for (const [w, n] of Object.entries(ORDINALS)) if (new RegExp(`\\b${w}\\b`).test(t)) return n;
  const m = t.match(/(?:^|\b|c|cat)(\d{1,2})(?:ra|da|ta|ma|va|na|a|era)?\b/);
  return m ? Number(m[1]) : null;
}

/** Sugiere la categoría para un texto del archivo (o de la hoja). Devuelve null si no hay una clara. */
export function suggestCategory(text: string, categories: CategoryOption[], fallbackGender: Gender): number | null {
  const gender = genderFromText(text) ?? fallbackGender;
  const pool = categories.filter((c) => c.gender === gender);
  const t = normDigits(text);
  const byName = pool.find((c) => normDigits(c.name) === t || t.split(" ").includes(normDigits(c.name)));
  if (byName) return byName.id;
  const level = levelFromText(text);
  if (level !== null) {
    const byLevel = pool.filter((c) => c.level === level);
    if (byLevel.length === 1) return byLevel[0]!.id;
    const nameLevel = pool.filter((c) => levelFromText(c.name) === level);
    if (nameLevel.length === 1) return nameLevel[0]!.id;
  }
  return null;
}

export function suggestDivision(text: string, divisions: DivisionOption[], categoryId: number): number | null {
  const t = normDigits(text).replace(/^(division|div|zona|grupo) /, "");
  if (!t) return null;
  const pool = divisions.filter((d) => d.categoryId === categoryId);
  return pool.find((d) => normDigits(d.name) === t)?.id ?? null;
}

export function suggestSeason(text: string, seasons: SeasonOption[]): number | null {
  const t = normDigits(text);
  const byName = seasons.find((s) => normDigits(s.name) === t);
  if (byName) return byName.id;
  const year = t.match(/\b(20\d{2})\b/)?.[1];
  if (year) {
    const list = seasons.filter((s) => s.year === Number(year));
    if (list.length === 1) return list[0]!.id;
  }
  return null;
}

// ───────────────────────────── Filas ─────────────────────────────
export interface SourceRow {
  id: string; // "hoja:fila"
  sheet: string;
  rowNumber: number; // fila del archivo (base 1, como en Excel)
  name: string; // tal como figura (o nombre + apellido)
  /** Nombre en orden "Nombre Apellido" para comparar con los jugadores registrados. */
  matchName: string;
  /** true si el orden no es seguro y conviene probar también el inverso. */
  orderUncertain: boolean;
  points: number;
  categoryText: string;
  divisionText: string;
  seasonText: string;
  positionText: string | null;
  genderText: string;
}

export interface SkippedRow { sheet: string; rowNumber: number; reason: string; text: string }

const looksLikeTotalRow = (s: string) => /^(total(es)?|suma|promedio|subtotal)\b/.test(normDigits(s));

/** "PEREZ, Juan" → "Juan PEREZ"; con orden "apellido nombre" se mueve la última palabra adelante. */
export function toFirstLast(name: string, order: NameOrder): { text: string; uncertain: boolean } {
  const clean = name.replace(/\s+/g, " ").trim();
  const comma = clean.indexOf(",");
  if (comma > 0) {
    const last = clean.slice(0, comma).trim();
    const first = clean.slice(comma + 1).trim();
    return { text: `${first} ${last}`.trim(), uncertain: false };
  }
  if (order === "apellido_nombre") {
    const tokens = clean.split(" ");
    if (tokens.length >= 2) return { text: `${tokens[tokens.length - 1]} ${tokens.slice(0, -1).join(" ")}`, uncertain: false };
  }
  return { text: clean, uncertain: order === "auto" };
}

export function extractRows(wb: Workbook, m: Mapping): { rows: SourceRow[]; skipped: SkippedRow[] } {
  const rows: SourceRow[] = [];
  const skipped: SkippedRow[] = [];
  const col = (r: CellValue[], f: FieldKey) => (m.columns[f] !== undefined ? cellText(r[m.columns[f]!]) : "");
  for (const sheet of wb.sheets.filter((s) => m.sheets.includes(s.name))) {
    sheet.rows.forEach((r, i) => {
      if (i <= m.headerRow) return;
      if (!r.some((v) => cellText(v))) return; // fila vacía
      const rowNumber = i + 1;
      let name = col(r, "name");
      if (!name && (m.columns.firstName !== undefined || m.columns.lastName !== undefined)) {
        const first = col(r, "firstName");
        const last = col(r, "lastName");
        name = last && first ? `${last}, ${first}` : `${first} ${last}`.trim();
      }
      const preview = r.map(cellText).filter(Boolean).join(" · ").slice(0, 120);
      const firstText = r.map(cellText).find(Boolean) ?? "";
      if (looksLikeTotalRow(name) || (looksLikeTotalRow(firstText) && !/\p{L}{2,}\s+\p{L}{2,}/u.test(name))) {
        skipped.push({ sheet: sheet.name, rowNumber, reason: "Fila de totales", text: preview });
        return;
      }
      if (!name || !/\p{L}/u.test(name)) {
        skipped.push({ sheet: sheet.name, rowNumber, reason: "Sin nombre de jugador", text: preview });
        return;
      }
      // Encabezado repetido (p. ej. una tabla por categoría dentro de la misma hoja).
      if (detectField(name) && detectField(col(r, "points"))) {
        skipped.push({ sheet: sheet.name, rowNumber, reason: "Encabezado repetido", text: preview });
        return;
      }
      const pts = parsePoints(m.columns.points !== undefined ? r[m.columns.points] : null);
      if (pts.error) {
        skipped.push({ sheet: sheet.name, rowNumber, reason: pts.error, text: preview });
        return;
      }
      if (pts.value === null) {
        skipped.push({ sheet: sheet.name, rowNumber, reason: "Sin puntos", text: preview });
        return;
      }
      if (pts.value === 0) {
        skipped.push({ sheet: sheet.name, rowNumber, reason: "0 puntos (no genera saldo)", text: preview });
        return;
      }
      const order = toFirstLast(name, m.nameOrder);
      rows.push({
        id: `${sheet.name}:${rowNumber}`,
        sheet: sheet.name,
        rowNumber,
        name: name.replace(/\s+/g, " ").trim(),
        matchName: order.text,
        orderUncertain: order.uncertain,
        points: pts.value,
        categoryText: m.categorySource === "columna" ? col(r, "category") : m.categorySource === "hoja" ? sheet.name : "",
        divisionText: m.divisionSource === "columna" ? col(r, "division") : m.divisionSource === "hoja" ? sheet.name : "",
        seasonText: m.seasonSource === "columna" ? col(r, "season") : m.seasonSource === "hoja" ? sheet.name : "",
        positionText: col(r, "position") || null,
        genderText: col(r, "gender"),
      });
    });
  }
  return { rows, skipped };
}

// ───────────────────────────── Valores → entidades ─────────────────────────────
export interface ValueMaps {
  category: Record<string, number | null>; // clave: texto de categoría (+ rama)
  division: Record<string, number | null>; // clave: `${categoryId}|${texto}`
  season: Record<string, number | null>;
}

export const categoryKey = (r: Pick<SourceRow, "categoryText" | "genderText">) => `${r.categoryText}¦${r.genderText}`;

export function suggestValueMaps(
  rows: SourceRow[], m: Mapping, cats: CategoryOption[], divs: DivisionOption[], seasons: SeasonOption[], previous?: ValueMaps,
): ValueMaps {
  const out: ValueMaps = { category: {}, division: {}, season: {} };
  for (const r of rows) {
    const ck = categoryKey(r);
    if (m.categorySource !== "fija" && !(ck in out.category)) {
      const gender = genderFromText(r.genderText) ?? genderFromText(r.categoryText) ?? m.defaultGender;
      out.category[ck] = previous?.category[ck] ?? suggestCategory(r.categoryText, cats, gender);
    }
    if (m.seasonSource !== "fija" && !(r.seasonText in out.season)) {
      out.season[r.seasonText] = previous?.season[r.seasonText] ?? suggestSeason(r.seasonText, seasons);
    }
  }
  for (const r of rows) {
    if (m.divisionSource === "columna" || m.divisionSource === "hoja") {
      const catId = rowCategory(r, m, out);
      if (catId === null || !r.divisionText) continue;
      const dk = `${catId}|${r.divisionText}`;
      if (!(dk in out.division)) out.division[dk] = previous?.division[dk] ?? suggestDivision(r.divisionText, divs, catId);
    }
  }
  return out;
}

export function rowCategory(r: SourceRow, m: Mapping, maps: ValueMaps): number | null {
  return m.categorySource === "fija" ? m.categoryFixed : maps.category[categoryKey(r)] ?? null;
}
export function rowSeason(r: SourceRow, m: Mapping, maps: ValueMaps): number | null {
  return m.seasonSource === "fija" ? m.seasonFixed : maps.season[r.seasonText] ?? null;
}
export function rowDivision(r: SourceRow, m: Mapping, maps: ValueMaps, categoryId: number | null): number | null {
  if (m.divisionSource === "ninguna" || categoryId === null) return null;
  if (m.divisionSource === "fija") return m.divisionFixed;
  return r.divisionText ? maps.division[`${categoryId}|${r.divisionText}`] ?? null : null;
}

export interface ResolvedRow extends SourceRow {
  seasonId: number;
  categoryId: number;
  divisionId: number | null;
  gender: Gender;
}

/** Aplica el mapeo de valores. Las filas sin temporada o categoría quedan pendientes (no se importan). */
export function resolveRows(rows: SourceRow[], m: Mapping, maps: ValueMaps, cats: CategoryOption[]): { resolved: ResolvedRow[]; pending: SourceRow[] } {
  const resolved: ResolvedRow[] = [];
  const pending: SourceRow[] = [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  for (const r of rows) {
    const categoryId = rowCategory(r, m, maps);
    const seasonId = rowSeason(r, m, maps);
    const cat = categoryId !== null ? byId.get(categoryId) : undefined;
    if (!cat || seasonId === null) { pending.push(r); continue; }
    resolved.push({ ...r, seasonId, categoryId: cat.id, divisionId: rowDivision(r, m, maps, cat.id), gender: cat.gender });
  }
  return { resolved, pending };
}

// ───────────────────────────── Jugadores ─────────────────────────────
export type Resolution =
  | { kind: "existing"; playerId: number }
  | { kind: "new"; firstName: string; lastName: string; categoryId: number }
  | { kind: "skip" }
  | { kind: "pending" };

export interface PlayerGroup {
  key: string; // `${rama}|${nombre normalizado}`
  gender: Gender;
  name: string; // como figura en el archivo (primera aparición)
  matchName: string;
  rowIds: string[];
  match: PlayerMatch;
  /** Sugerencia para crear: nombre y apellido separados. */
  suggestion: { firstName: string; lastName: string };
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

function splitForNew(r: SourceRow, order: NameOrder): { firstName: string; lastName: string } {
  const comma = r.name.indexOf(",");
  if (comma > 0) return { firstName: titleCase(r.name.slice(comma + 1).trim()), lastName: titleCase(r.name.slice(0, comma).trim()) };
  const tokens = r.name.replace(/\s+/g, " ").trim().split(" ");
  if (tokens.length < 2) return { firstName: titleCase(tokens[0] ?? ""), lastName: "" };
  if (order === "apellido_nombre") return { firstName: titleCase(tokens[tokens.length - 1]!), lastName: titleCase(tokens.slice(0, -1).join(" ")) };
  return { firstName: titleCase(tokens[0]!), lastName: titleCase(tokens.slice(1).join(" ")) };
}

/**
 * Índice por prefijo de palabra: evita comparar cada nombre del archivo contra todo el padrón
 * (una planilla de 500 filas contra 2000 jugadores serían millones de comparaciones).
 */
export interface DirectoryIndex { all: DirectoryPlayer[]; byPrefix: Map<string, DirectoryPlayer[]> }

const prefixesOf = (text: string) => normalizeName(text).split(" ").filter((t) => t.length >= 2).map((t) => t.slice(0, 3));

export function indexDirectory(directory: DirectoryPlayer[]): DirectoryIndex {
  const byPrefix = new Map<string, DirectoryPlayer[]>();
  for (const p of directory) {
    for (const k of new Set(prefixesOf(`${p.firstName} ${p.lastName} ${p.nickname ?? ""}`))) {
      const list = byPrefix.get(k);
      if (list) list.push(p); else byPrefix.set(k, [p]);
    }
  }
  return { all: directory, byPrefix };
}

function candidatesFor(name: string, index: DirectoryIndex): DirectoryPlayer[] {
  if (index.all.length <= 300) return index.all;
  const set = new Set<DirectoryPlayer>();
  for (const k of prefixesOf(name)) for (const p of index.byPrefix.get(k) ?? []) set.add(p);
  // Diminutivos que no comparten prefijo ("Pancho" ↔ Francisco) se resuelven igual por el apellido.
  return [...set];
}

/** Busca el mejor jugador; si el orden del nombre es dudoso, prueba también "apellido nombre". */
export function bestMatch(r: SourceRow, index: DirectoryIndex): { match: PlayerMatch; matchName: string } {
  const directory = candidatesFor(r.matchName, index);
  const direct = matchPlayer(r.matchName, directory);
  if (!r.orderUncertain) return { match: direct, matchName: r.matchName };
  const tokens = r.matchName.split(" ");
  if (tokens.length < 2) return { match: direct, matchName: r.matchName };
  const swapped = `${tokens[tokens.length - 1]} ${tokens.slice(0, -1).join(" ")}`;
  const alt = matchPlayer(swapped, directory);
  const top = (x: PlayerMatch) => x.candidates[0]?.score ?? 0;
  return top(alt) > top(direct) + 0.02 ? { match: alt, matchName: swapped } : { match: direct, matchName: r.matchName };
}

export function groupPlayers(rows: ResolvedRow[], directories: Record<Gender, DirectoryIndex>, order: NameOrder): PlayerGroup[] {
  const groups = new Map<string, PlayerGroup>();
  const matches = new Map<string, ReturnType<typeof bestMatch>>();
  for (const r of rows) {
    // El cotejo se hace una vez por nombre distinto; la clave del grupo usa el orden elegido, así
    // "GOMEZ, MARTIN" y "Gomez Martin" quedan juntos.
    const mk = `${r.gender}|${normalizeName(r.matchName)}|${r.orderUncertain ? 1 : 0}`;
    let best = matches.get(mk);
    if (!best) { best = bestMatch(r, directories[r.gender]); matches.set(mk, best); }
    const { match, matchName } = best;
    const key = `${r.gender}|${normalizeName(matchName)}`;
    const g = groups.get(key);
    if (g) { g.rowIds.push(r.id); continue; }
    const suggestion = r.orderUncertain && matchName !== r.matchName ? splitForNew(r, "apellido_nombre") : splitForNew(r, order);
    groups.set(key, { key, gender: r.gender, name: r.name, matchName, rowIds: [r.id], match, suggestion });
  }
  return [...groups.values()];
}

/** Resolución inicial: coincidencias exactas o probables se vinculan; el resto queda para decidir. */
export function initialResolution(g: PlayerGroup, rows: ResolvedRow[]): Resolution {
  const top = g.match.candidates[0];
  if ((g.match.status === "exacto" || g.match.status === "probable") && top) return { kind: "existing", playerId: top.player.id };
  if (g.match.status === "desconocido") {
    const first = rows.find((r) => r.id === g.rowIds[0]);
    return { kind: "new", firstName: g.suggestion.firstName, lastName: g.suggestion.lastName, categoryId: first?.categoryId ?? 0 };
  }
  return { kind: "pending" };
}

/** Nombres muy parecidos dentro del archivo (posible duplicado por error de tipeo o abreviatura). */
export function similarNamePairs(groups: PlayerGroup[], threshold = 0.88): [PlayerGroup, PlayerGroup][] {
  const pairs: [PlayerGroup, PlayerGroup][] = [];
  const items = groups.map((g) => ({ g, n: normalizeName(g.matchName) }));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      if (a.g.gender !== b.g.gender || Math.abs(a.n.length - b.n.length) > 4) continue;
      if (nameSimilarity(a.n, b.n) >= threshold) pairs.push([a.g, b.g]);
    }
  }
  return pairs;
}

export interface FinalRow {
  row: ResolvedRow;
  group: PlayerGroup;
  resolution: Resolution;
}

/** Filas que van a la base, con la clave del ranking para detectar duplicados. */
export const rankingKeyOf = (r: { seasonId: number; categoryId: number; divisionId: number | null }) => `${r.seasonId}:${r.categoryId}:${r.divisionId ?? 0}`;

export function playerKeyOf(groupKey: string, res: Resolution): string | null {
  if (res.kind === "existing") return `p${res.playerId}`;
  if (res.kind === "new") return `n${groupKey}`;
  return null;
}

/** Mismo jugador dos veces en el mismo ranking (dos filas o dos nombres vinculados al mismo jugador). */
export function duplicateAssignments(finals: FinalRow[]): FinalRow[][] {
  const map = new Map<string, FinalRow[]>();
  for (const f of finals) {
    const pk = playerKeyOf(f.group.key, f.resolution);
    if (!pk) continue;
    const k = `${pk}@${rankingKeyOf(f.row)}`;
    map.set(k, [...(map.get(k) ?? []), f]);
  }
  return [...map.values()].filter((l) => l.length > 1);
}
