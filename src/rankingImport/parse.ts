import { strFromU8, unzipSync } from "fflate";

/**
 * Lectura de planillas en el navegador (sin enviar el archivo al servidor):
 *  - CSV / TXT: separador detectado (; , tab |), comillas RFC 4180, UTF-8 o Windows-1252.
 *  - XLSX (Excel 2007+, Google Sheets, LibreOffice): todas las hojas, valores ya calculados.
 * El formato .xls antiguo (binario) no se puede leer: se pide guardarlo como .xlsx o .csv.
 */

export type CellValue = string | number | null;
export interface SheetData {
  name: string;
  rows: CellValue[][];
}
export interface Workbook {
  kind: "csv" | "xlsx";
  sheets: SheetData[];
}

export class SpreadsheetError extends Error {}

// ───────────────────────────── Texto ─────────────────────────────
/** UTF-8 (con o sin BOM); si hay bytes inválidos, Windows-1252 (CSV guardado por Excel en Windows). */
export function decodeText(bytes: Uint8Array): string {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be").decode(bytes.subarray(2));
  }
  const body = bytes.subarray(start);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

/** Separador más probable: el que aparece una cantidad constante (y > 0) de veces en las primeras líneas. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 20);
  let best = ";";
  let bestScore = -1;
  for (const d of [";", ",", "\t", "|"]) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const nonZero = counts.filter((n) => n > 0);
    if (!nonZero.length) continue;
    const mode = mostCommon(nonZero);
    const consistent = counts.filter((n) => n === mode).length;
    const score = consistent * 10 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

function mostCommon(nums: number[]): number {
  const m = new Map<number, number>();
  for (const n of nums) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // Neutraliza el apóstrofo que se agrega para evitar fórmulas al exportar ('=algo).
  return rows.map((r) => r.map((v) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v)));
}

// ───────────────────────────── XLSX ─────────────────────────────
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });

/** Texto de un nodo con posibles fragmentos de formato (<r><t>…</t></r>), ignorando la fonética (<rPh>). */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ?? "";
  return decodeEntities(out);
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** "AB12" → índice de columna 27 (base 0). */
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(bytes: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") && f.name.endsWith(".xml") || f.name.endsWith(".rels") });
  } catch {
    throw new SpreadsheetError("El archivo no es un Excel válido (.xlsx). Si es un .xls antiguo, abrilo y guardalo como .xlsx o .csv.");
  }
  const read = (name: string) => (files[name] ? strFromU8(files[name]!) : null);
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new SpreadsheetError("El archivo no tiene hojas de cálculo reconocibles.");

  const rels = new Map<string, string>();
  for (const m of (read("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }

  const shared: string[] = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(textOf(m[1] ?? ""));

  const sheets: SheetData[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decodeEntities(attr(m[0], "name") ?? `Hoja ${sheets.length + 1}`);
    const rid = attr(m[0], "r:id");
    if (attr(m[0], "state") === "hidden" || attr(m[0], "state") === "veryHidden") continue;
    const path = rid ? rels.get(rid) : undefined;
    const xml = path ? read(path) : null;
    if (!xml) continue;
    sheets.push({ name, rows: readSheet(xml, shared) });
  }
  if (!sheets.length) throw new SpreadsheetError("No se encontraron hojas visibles en el archivo.");
  return { kind: "xlsx", sheets };
}

function readSheet(xml: string, shared: string[]): CellValue[][] {
  const rows: CellValue[][] = [];
  const data = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/)?.[1] ?? "";
  let nextRow = 0;
  for (const rm of data.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const rAttr = rm[1] ? attr(rm[1], "r") : undefined;
    const rowIndex = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const cells: CellValue[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1]!;
      const ref = attr(tag, "r");
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      const type = attr(tag, "t");
      const inner = cm[2] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: CellValue = null;
      if (type === "s") value = v !== undefined ? shared[Number(v)] ?? null : null;
      else if (type === "inlineStr") value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (type === "str" || type === "e") value = v !== undefined ? decodeEntities(v) : null;
      else if (type === "b") value = v === "1" ? "VERDADERO" : "FALSO";
      else if (v !== undefined) {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeEntities(v);
      }
      cells[col] = value;
    }
    rows[rowIndex] = Array.from(cells, (x) => x ?? null);
  }
  return Array.from(rows, (r) => r ?? []);
}

// ───────────────────────────── Entrada ─────────────────────────────
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function readSpreadsheet(fileName: string, bytes: Uint8Array): Workbook {
  if (bytes.length > MAX_FILE_BYTES) throw new SpreadsheetError("El archivo supera los 10 MB.");
  const lower = fileName.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (lower.endsWith(".xls") && !isZip) {
    throw new SpreadsheetError("Los archivos .xls (Excel 97-2003) no se pueden leer. Abrilo en Excel o Google Sheets y guardalo como .xlsx o .csv.");
  }
  if (isZip || lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return readXlsx(bytes);
  if (lower.endsWith(".ods")) throw new SpreadsheetError("Los archivos .ods no están soportados. Guardalo como .xlsx o .csv.");
  const text = decodeText(bytes);
  if (text.includes("\u0000")) throw new SpreadsheetError("El archivo no parece ser una planilla de texto (CSV).");
  const rows = parseCsv(text);
  return { kind: "csv", sheets: [{ name: fileName.replace(/\.[^.]+$/, "") || "CSV", rows }] };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
