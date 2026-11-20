/**
 * Detección de la estructura de un cuadro eliminatorio a partir de los colores (sin OCR).
 * Pensado para las planillas de Padel Time: cada partido es una barra de color (encabezado de
 * la ronda), con las dos parejas en las filas de abajo, una celda de resultado coloreada a la
 * derecha y, a continuación, la celda del indicador de victoria/derrota.
 * Funciones puras sobre píxeles RGBA: no dependen del DOM.
 */
import type { Rect } from "./image";

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

export interface Component extends Rect { count: number; color: [number, number, number] }

export interface CellLayout {
  name: Rect;
  score: Rect | null;
  mark: Rect | null;
}

export interface BlockLayout {
  header: Rect;
  column: number;
  rows: [CellLayout, CellLayout];
  /** true si las filas se ubicaron por las celdas de resultado (más confiable). */
  anchored: boolean;
}

export interface LayoutResult {
  blocks: BlockLayout[];
  columns: number;
  /** Altura típica de una fila: sirve para escalar el OCR. */
  rowHeight: number;
}

const idx = (p: Pixels, x: number, y: number) => (y * p.width + x) * 4;

/** Píxel "saturado y no muy claro": encabezados y barras de color (no texto negro, no fondo blanco). */
function isStrongColor(d: Uint8ClampedArray, i: number) {
  const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx - mn > 70 && mx < 240 && mx > 60;
}

/** Píxel "tinte claro": celdas de resultado celestes, amarillas, verdes, etc. */
function isLightTint(d: Uint8ClampedArray, i: number) {
  const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx - mn >= 20 && mx - mn <= 90 && mn >= 140;
}

/**
 * Máscara binaria de los píxeles que cumplen `test`, limpiada con un filtro de mayoría 3×3:
 * elimina el "granulado" de la compresión JPEG y cierra huecos de un píxel.
 */
export function cleanMask(p: Pixels, test: (d: Uint8ClampedArray, i: number) => boolean): Uint8Array {
  const { width: w, height: h, data: d } = p;
  const raw = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) raw[k] = test(d, k * 4) ? 1 : 0;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          total++;
          n += raw[yy * w + xx]!;
        }
      }
      out[y * w + x] = n * 2 > total ? 1 : 0;
    }
  }
  return out;
}

/**
 * Componentes conexos de una máscara, separando zonas de colores distintos que se tocan
 * (cada región crece mientras el color del vecino se parezca al color PROMEDIO de la región,
 * lo que tolera el ruido de compresión sin unir, por ejemplo, un encabezado con una barra vecina).
 */
export function components(p: Pixels, test: (d: Uint8ClampedArray, i: number) => boolean, colorTolerance = 45, minCount = 30): Component[] {
  const { width: w, height: h, data: d } = p;
  const mask = cleanMask(p, test);
  const seen = new Uint8Array(w * h);
  const out: Component[] = [];
  const stack: number[] = [];
  const tol2 = colorTolerance * colorTolerance;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (seen[k] || !mask[k]) continue;
      let sr = d[k * 4]!, sg = d[k * 4 + 1]!, sb = d[k * 4 + 2]!;
      let x0 = x, x1 = x, y0 = y, y1 = y, count = 0;
      seen[k] = 1;
      stack.push(k);
      while (stack.length) {
        const c = stack.pop()!;
        const cx = c % w, cy = (c - cx) / w;
        count++;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        const ci = c * 4;
        // Promedio móvil del color de la región.
        sr += (d[ci]! - sr) / count; sg += (d[ci + 1]! - sg) / count; sb += (d[ci + 2]! - sb) / count;
        const neighbors = [c - 1, c + 1, c - w, c + w];
        for (let n = 0; n < 4; n++) {
          const nk = neighbors[n]!;
          if (nk < 0 || nk >= w * h || seen[nk] || !mask[nk]) continue;
          if ((n === 0 && cx === 0) || (n === 1 && cx === w - 1)) continue;
          const i = nk * 4;
          const dr = d[i]! - sr, dg = d[i + 1]! - sg, db = d[i + 2]! - sb;
          if (dr * dr + dg * dg + db * db > tol2) continue;
          seen[nk] = 1;
          stack.push(nk);
        }
      }
      if (count >= minCount) out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, count, color: [Math.round(sr), Math.round(sg), Math.round(sb)] });
    }
  }
  return out;
}

/** Barras de encabezado: rectángulos anchos, bajos y bastante llenos (el texto blanco deja huecos). */
export function findHeaders(p: Pixels): Component[] {
  const minW = Math.max(40, p.width * 0.06);
  return components(p, isStrongColor, 45, 60).filter(
    (c) => c.w >= minW && c.w >= c.h * 5 && c.h >= 5 && c.h <= p.height * 0.12 && c.count / (c.w * c.h) >= 0.5,
  );
}

export function findScoreCells(p: Pixels): Component[] {
  return components(p, isLightTint, 32, 15).filter((c) => c.h >= 4 && c.w >= 4 && c.w <= c.h * 4 && c.count / (c.w * c.h) >= 0.45);
}

/** Agrupa encabezados en columnas (rondas) por su posición horizontal. */
export function clusterColumns(headers: Rect[]): number[] {
  const order = headers.map((h, i) => ({ i, x: h.x, w: h.w })).sort((a, b) => a.x - b.x);
  const col = new Array<number>(headers.length).fill(0);
  let current = -1;
  let lastX = -Infinity;
  for (const o of order) {
    if (o.x - lastX > o.w * 0.4) { current++; lastX = o.x; }
    col[o.i] = current;
  }
  return col;
}

export function detectLayout(p: Pixels): LayoutResult {
  const headers = findHeaders(p);
  const scores = findScoreCells(p);
  const columns = clusterColumns(headers);
  const blocks: BlockLayout[] = headers.map((hd, i) => {
    const hh = hd.h;
    // Celdas de resultado a la derecha del encabezado, en las dos filas siguientes.
    const near = scores
      .filter((s) => s.x >= hd.x + hd.w - hh * 2 && s.x <= hd.x + hd.w + hh * 4 && s.y >= hd.y + hh * 0.6 && s.y <= hd.y + hh * 3.6)
      .sort((a, b) => a.y - b.y)
      .slice(0, 2);
    let rows: [CellLayout, CellLayout];
    let anchored = false;
    if (near.length === 2 && near[1]!.y - near[0]!.y >= hh * 0.6) {
      anchored = true;
      rows = near.map((s) => ({
        name: { x: hd.x + 1, y: s.y, w: Math.max(4, s.x - hd.x - 2), h: s.h },
        score: { x: s.x, y: s.y, w: s.w, h: s.h },
        mark: { x: s.x + s.w + 1, y: s.y, w: Math.round(Math.max(s.w, hh) * 1.1), h: s.h },
      })) as [CellLayout, CellLayout];
    } else {
      // Sin celdas de resultado reconocibles: filas de la misma altura que el encabezado.
      const rowH = hh + 2;
      rows = [0, 1].map((n) => {
        const y = hd.y + hd.h + 1 + n * rowH;
        return {
          name: { x: hd.x + 1, y, w: hd.w - 2, h: rowH - 1 },
          score: { x: hd.x + hd.w + 1, y, w: Math.round(hh * 1.4), h: rowH - 1 },
          mark: { x: hd.x + hd.w + Math.round(hh * 1.5), y, w: Math.round(hh * 1.4), h: rowH - 1 },
        };
      }) as [CellLayout, CellLayout];
    }
    return { header: { x: hd.x, y: hd.y, w: hd.w, h: hd.h }, column: columns[i]!, rows, anchored };
  });
  // Los bloques sin celdas de resultado reconocibles copian la geometría de un bloque anclado
  // de su misma columna (en una planilla, todos los partidos de una ronda tienen las mismas medidas).
  for (const b of blocks) {
    if (b.anchored) continue;
    const model = blocks.find((m) => m.anchored && m.column === b.column && Math.abs(m.header.w - b.header.w) <= 3);
    if (!model) continue;
    const dy = b.header.y - model.header.y;
    const dx = b.header.x - model.header.x;
    const shift = (r: Rect | null): Rect | null => (r ? { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h } : null);
    b.rows = model.rows.map((r) => ({ name: shift(r.name)!, score: shift(r.score), mark: shift(r.mark) })) as [CellLayout, CellLayout];
  }
  blocks.sort((a, b) => a.column - b.column || a.header.y - b.header.y);
  const rowHeight = blocks.length ? median(blocks.map((b) => b.rows[0].name.h)) : 0;
  return { blocks, columns: Math.max(0, ...columns.map((c) => c + 1)), rowHeight };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

export { idx as pixelIndex };
