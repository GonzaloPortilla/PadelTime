/**
 * Reconocimiento de un cuadro: estructura por colores + Tesseract.js celda por celda.
 * Todo corre en el navegador del organizador (sin servicios pagos ni envío de la imagen).
 */
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { ctx2d, estimateSkew, inkRatio, prepareCell, rotateCanvas, scaleCanvas, snapshot, type Rect } from "./image";
import { detectLayout, type BlockLayout, type LayoutResult } from "./layout";

export interface RawRow {
  nameText: string;
  nameConf: number;
  nameImage: string;
  scoreText: string;
  score: number | null;
  scoreConf: number;
  scoreImage: string | null;
  /** Hay una marca (p. ej. "X") en la celda del indicador. null = no hay celda de indicador. */
  marked: boolean | null;
  markRatio: number;
}

export interface RawBlock {
  id: string;
  column: number;
  y: number;
  headerText: string;
  headerConf: number;
  rows: [RawRow, RawRow];
}

export interface RawBracket {
  mode: "estructura" | "texto";
  blocks: RawBlock[];
  columns: number;
  imageWidth: number;
  imageHeight: number;
  elapsedMs: number;
  /** Enderezado automático aplicado (grados). */
  deskewDegrees: number;
  /** Factor de escala aplicado para normalizar el tamaño del texto. */
  scale: number;
}

export type Progress = (stage: string, done: number, total: number) => void;

let workerPromise: Promise<Worker> | null = null;

/** Un único worker reutilizable: la primera vez descarga el modelo (≈2 MB) y queda en caché del navegador. */
export function getOcrWorker(): Promise<Worker> {
  workerPromise ??= createWorker("spa", OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    workerBlobURL: false,
    gzip: true,
  }).catch((e) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

export async function disposeOcrWorker() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}

const NAME_CHARS = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZÁÉÍÓÚÜabcdefghijklmnñopqrstuvwxyzáéíóúü -.'";
const DIGITS = "0123456789";

async function readText(worker: Worker, canvas: HTMLCanvasElement): Promise<{ text: string; conf: number }> {
  const { data } = await worker.recognize(canvas);
  return { text: data.text.replace(/\s+/g, " ").trim(), conf: Math.round(data.confidence) };
}

const inset = (r: Rect, n: number): Rect => ({ x: r.x + n, y: r.y + n, w: Math.max(1, r.w - n * 2), h: Math.max(1, r.h - n * 2) });
/** Margen para no leer los bordes de la celda: proporcional a su altura. */
const margin = (r: Rect) => Math.max(1, Math.round(r.h * 0.12));

async function readBlocks(canvas: HTMLCanvasElement, layout: BlockLayout[], rowHeight: number, onProgress?: Progress): Promise<RawBlock[]> {
  const worker = await getOcrWorker();
  const total = layout.length * 5;
  let done = 0;
  const tick = (stage: string) => onProgress?.(stage, ++done, total);
  const target = Math.max(44, Math.min(64, rowHeight * 3));

  // 1) Encabezados (nombre de la ronda).
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: NAME_CHARS, preserve_interword_spaces: "1" });
  const headers: { text: string; conf: number }[] = [];
  for (const b of layout) {
    headers.push(await readText(worker, prepareCell(canvas, inset(b.header, margin(b.header)), target)));
    tick("Leyendo rondas");
  }
  // 2) Nombres de las parejas.
  const names: { text: string; conf: number }[][] = [];
  for (const b of layout) {
    const pair: { text: string; conf: number }[] = [];
    for (const r of b.rows) {
      const area = inset(r.name, margin(r.name));
      let res = await readText(worker, prepareCell(canvas, area, target));
      if (res.conf < 70) {
        // Lectura dudosa (p. ej. foto desenfocada): se reintenta con un umbral más estricto.
        const alt = await readText(worker, prepareCell(canvas, area, target, "estricto"));
        if (alt.conf > res.conf) res = alt;
      }
      pair.push(res);
      tick("Leyendo nombres");
    }
    names.push(pair);
  }
  // 3) Resultados (sólo dígitos).
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: DIGITS });
  const scores: { text: string; conf: number }[][] = [];
  for (const b of layout) {
    const pair: { text: string; conf: number }[] = [];
    for (const r of b.rows) {
      if (!r.score) pair.push({ text: "", conf: 0 });
      else {
        const area = inset(r.score, margin(r.score));
        let res = await readText(worker, prepareCell(canvas, area, target, "binario", true));
        if (!res.text) {
          // Reintentos: modo "un carácter", y una versión en grises sin binarizar.
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_CHAR });
          res = await readText(worker, prepareCell(canvas, area, target, "binario", true));
          if (!res.text) res = await readText(worker, prepareCell(canvas, area, target, "grises", true));
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD });
          if (!res.text) res = await readText(worker, prepareCell(canvas, area, target * 1.4, "grises", true));
        }
        pair.push(res);
      }
      tick("Leyendo resultados");
    }
    scores.push(pair);
  }

  return layout.map((b, i) => ({
    id: `b${i}`,
    column: b.column,
    y: b.header.y,
    headerText: headers[i]!.text,
    headerConf: headers[i]!.conf,
    rows: b.rows.map((r, j) => {
      const s = scores[i]![j]!;
      const digits = s.text.replace(/\D/g, "");
      const markArea = r.mark && r.mark.x < canvas.width - 2 ? inset(r.mark, margin(r.mark)) : null;
      const ratio = markArea ? inkRatio(canvas, markArea) : 0;
      return {
        nameText: names[i]![j]!.text,
        nameConf: names[i]![j]!.conf,
        nameImage: snapshot(canvas, r.name),
        scoreText: s.text,
        // No se inventan resultados: si no hay dígitos legibles, queda vacío.
        score: digits.length > 0 && digits.length <= 2 ? Number(digits) : null,
        scoreConf: s.conf,
        scoreImage: r.score ? snapshot(canvas, r.score) : null,
        marked: markArea ? ratio > 0.022 : null,
        markRatio: Math.round(ratio * 1000) / 1000,
      };
    }) as [RawRow, RawRow],
  }));
}

/**
 * Respaldo cuando no se reconoce la estructura de colores (p. ej. una foto de un cuadro impreso):
 * OCR de la imagen completa y armado aproximado de bloques por posición. Menos preciso:
 * el organizador completa o corrige en la revisión.
 */
async function textFallback(canvas: HTMLCanvasElement, onProgress?: Progress): Promise<RawBlock[]> {
  const worker = await getOcrWorker();
  onProgress?.("Leyendo la imagen completa", 0, 1);
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: "", preserve_interword_spaces: "1" });
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  onProgress?.("Leyendo la imagen completa", 1, 1);
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).map((l) => ({
    text: l.text.replace(/\s+/g, " ").trim(),
    conf: Math.round(l.confidence),
    x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0,
  })).filter((l) => l.text);
  const isHeader = (t: string) => /^(octavos|cuartos|semi|semis|semifinal|final|16avos|dieciseisavos)\b/i.test(t.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const headers = lines.filter((l) => isHeader(l.text));
  const used = new Set<(typeof lines)[number]>();
  const columns = clusterX(headers.map((h) => h.x), canvas.width * 0.05);
  const blocks: RawBlock[] = [];
  headers.forEach((h, i) => {
    const below = lines
      .filter((l) => !used.has(l) && !isHeader(l.text) && l.y > h.y && l.y < h.y + h.h * 6 && Math.abs(l.x - h.x) < canvas.width * 0.08 && /[A-Za-zÑñ]{2,}/.test(l.text))
      .sort((a, b) => a.y - b.y)
      .slice(0, 2);
    below.forEach((l) => used.add(l));
    const toRow = (l: (typeof lines)[number] | undefined): RawRow => {
      const m = l?.text.match(/^(.*?)[\s|\]]*(\d{1,2})?\s*[|\]X×x]*\s*$/);
      const name = (m?.[1] ?? l?.text ?? "").replace(/[|[\]_—*"”]+/g, " ").replace(/\s+/g, " ").trim();
      return {
        nameText: name, nameConf: l?.conf ?? 0, nameImage: l ? snapshot(canvas, { x: l.x, y: l.y, w: l.w, h: l.h }) : "",
        scoreText: m?.[2] ?? "", score: m?.[2] ? Number(m[2]) : null, scoreConf: m?.[2] ? Math.min(60, l?.conf ?? 0) : 0, scoreImage: null,
        marked: null, markRatio: 0,
      };
    };
    blocks.push({ id: `t${i}`, column: columns[i]!, y: h.y, headerText: h.text, headerConf: h.conf, rows: [toRow(below[0]), toRow(below[1])] });
  });
  return blocks.sort((a, b) => a.column - b.column || a.y - b.y);
}

function clusterX(xs: number[], tol: number): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const out = new Array<number>(xs.length).fill(0);
  let c = -1, last = -Infinity;
  for (const o of order) {
    if (o.x - last > tol) c++;
    last = o.x;
    out[o.i] = c;
  }
  return out;
}

const detect = (c: HTMLCanvasElement): LayoutResult => detectLayout(ctx2d(c).getImageData(0, 0, c.width, c.height));
const usable = (l: LayoutResult) => l.blocks.length >= 3 || (l.blocks.length >= 1 && l.blocks.every((b) => b.anchored));

/** Altura de fila objetivo (px) al normalizar imágenes con texto muy chico o muy grande. */
const TARGET_ROW = 18;

export async function recognizeBracket(input: HTMLCanvasElement, onProgress?: Progress): Promise<RawBracket> {
  const t0 = performance.now();
  onProgress?.("Preparando el reconocimiento", 0, 1);
  await getOcrWorker();
  onProgress?.("Enderezando y detectando la estructura", 0, 1);
  let canvas = input;
  let scale = 1;
  // 1) Enderezado automático (fotos tomadas con el celular levemente torcidas).
  const deskewDegrees = estimateSkew(canvas);
  if (deskewDegrees !== 0) canvas = rotateCanvas(canvas, deskewDegrees);
  // 2) Estructura por colores; si la imagen es chica, se reintenta ampliada.
  let layout = detect(canvas);
  if (!usable(layout) && canvas.width < 2000) {
    const up = scaleCanvas(canvas, 2);
    const l2 = detect(up);
    if (l2.blocks.length > layout.blocks.length) { canvas = up; layout = l2; scale *= 2; }
  }
  // 3) Normaliza el tamaño sólo si el texto es muy chico o muy grande (con filas de 13-40 px se lee bien tal cual).
  if (usable(layout) && layout.rowHeight > 0 && (layout.rowHeight < 13 || layout.rowHeight > 40)) {
    const f = Math.max(0.5, Math.min(3, TARGET_ROW / layout.rowHeight));
    const scaled = scaleCanvas(canvas, f);
    const l2 = detect(scaled);
    if (l2.blocks.length >= layout.blocks.length) { canvas = scaled; layout = l2; scale *= f; }
  }
  const meta = { imageWidth: canvas.width, imageHeight: canvas.height, deskewDegrees, scale: Math.round(scale * 100) / 100 };
  if (usable(layout)) {
    const blocks = await readBlocks(canvas, layout.blocks, layout.rowHeight, onProgress);
    return { mode: "estructura", blocks, columns: layout.columns, elapsedMs: Math.round(performance.now() - t0), ...meta };
  }
  const blocks = await textFallback(canvas, onProgress);
  return { mode: "texto", blocks, columns: Math.max(0, ...blocks.map((b) => b.column + 1)), elapsedMs: Math.round(performance.now() - t0), ...meta };
}
