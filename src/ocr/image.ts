/**
 * Utilidades de imagen para el OCR (navegador, Canvas 2D).
 * Preprocesamiento: rotación, recorte, contraste/brillo, ampliación y binarización.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export interface Adjustments {
  /** Rotación en grados (múltiplos de 90 + ajuste fino). */
  rotation: number;
  /** Recorte en coordenadas de la imagen ya rotada (null = imagen completa). */
  crop: Rect | null;
  /** 1 = sin cambios. */
  contrast: number;
  /** 0 = sin cambios (-100..100). */
  brightness: number;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = { rotation: 0, crop: null, contrast: 1, brightness: 0 };

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // La imagen decodificada queda en memoria; la URL ya no hace falta.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Lado máximo de trabajo: fotos de celular muy grandes se reducen para no agotar memoria. */
const MAX_SIDE = 4000;

/** Aplica rotación, recorte y contraste. Devuelve el canvas de trabajo. */
export function applyAdjustments(img: CanvasImageSource & { width: number; height: number }, adj: Adjustments): HTMLCanvasElement {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const sw = img.width * scale;
  const sh = img.height * scale;
  const rad = (adj.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rw = sw * cos + sh * sin;
  const rh = sw * sin + sh * cos;
  const rotated = createCanvas(rw, rh);
  const rc = ctx2d(rotated);
  rc.fillStyle = "#fff";
  rc.fillRect(0, 0, rotated.width, rotated.height);
  rc.translate(rotated.width / 2, rotated.height / 2);
  rc.rotate(rad);
  rc.imageSmoothingQuality = "high";
  rc.drawImage(img, -sw / 2, -sh / 2, sw, sh);

  const crop = adj.crop ? clampRect(adj.crop, rotated.width, rotated.height) : { x: 0, y: 0, w: rotated.width, h: rotated.height };
  const out = createCanvas(crop.w, crop.h);
  const oc = ctx2d(out);
  oc.filter = `contrast(${adj.contrast}) brightness(${1 + adj.brightness / 100})`;
  oc.drawImage(rotated, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  oc.filter = "none";
  return out;
}

export function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.min(w - 1, Math.round(r.x)));
  const y = Math.max(0, Math.min(h - 1, Math.round(r.y)));
  return { x, y, w: Math.max(1, Math.min(w - x, Math.round(r.w))), h: Math.max(1, Math.min(h - y, Math.round(r.h))) };
}

/** Umbral de Otsu sobre un histograma de grises. */
export function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

const gray = (d: Uint8ClampedArray, i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;

/**
 * Recorta una celda, la amplía y la binariza (texto negro sobre fondo blanco),
 * listo para Tesseract. Invierte automáticamente texto claro sobre fondo oscuro.
 */
export function prepareCell(
  source: HTMLCanvasElement,
  rect: Rect,
  targetTextHeight = 48,
  mode: "binario" | "grises" | "estricto" = "binario",
  removeBorderLines = false,
): HTMLCanvasElement {
  const r = clampRect(rect, source.width, source.height);
  const scale = Math.max(2, Math.min(8, targetTextHeight / Math.max(8, r.h)));
  const pad = 14;
  const big = createCanvas(r.w * scale + pad * 2, r.h * scale + pad * 2);
  const bc = ctx2d(big);
  bc.imageSmoothingEnabled = true;
  bc.imageSmoothingQuality = "high";
  bc.drawImage(source, r.x, r.y, r.w, r.h, pad, pad, r.w * scale, r.h * scale);
  const img = bc.getImageData(0, 0, big.width, big.height);
  const d = img.data;
  const hist = new Array<number>(256).fill(0);
  let count = 0;
  let edgeSum = 0;
  let edgeN = 0;
  for (let y = pad; y < big.height - pad; y++) {
    for (let x = pad; x < big.width - pad; x++) {
      const v = Math.round(gray(d, (y * big.width + x) * 4));
      hist[v]!++;
      count++;
      if (y < pad + 3 || x < pad + 3 || y >= big.height - pad - 3 || x >= big.width - pad - 3) { edgeSum += v; edgeN++; }
    }
  }
  const t0 = otsu(hist, count);
  // El fondo es el color dominante en los bordes de la celda.
  const darkBackground = edgeN > 0 && edgeSum / edgeN < t0;
  // Umbral "estricto" (fotos desenfocadas): a mitad de camino entre Otsu y el núcleo de la tinta,
  // para que las letras engrosadas por el desenfoque no se peguen entre sí.
  let t = t0;
  if (mode === "estricto") {
    let acc = 0, core = t0;
    if (!darkBackground) { for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= count * 0.04) { core = v; break; } } }
    else { for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc >= count * 0.04) { core = v; break; } } }
    t = Math.round((t0 + core) / 2);
  }
  const W = big.width, H = big.height;
  const ink = new Uint8Array(W * H);
  for (let y = pad; y < H - pad; y++) {
    for (let x = pad; x < W - pad; x++) {
      const i = (y * W + x) * 4;
      if ((gray(d, i) < t) !== darkBackground) ink[y * W + x] = 1;
    }
  }
  // Restos de las líneas de la planilla pegados al borde del recorte ("3|", "I6"): se borran
  // sólo los componentes con forma de línea (largos y finos) que tocan el borde.
  if (removeBorderLines) removeLineComponents(ink, W, H, pad);
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    let v: number;
    if (mode === "grises") {
      // Escala de grises con fondo blanco (sin binarizar), conservando sólo la tinta útil.
      const inside = ink[k] === 1;
      const g = gray(d, i);
      v = inside ? Math.round(darkBackground ? 255 - g : g) : 255;
    } else v = ink[k] ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  bc.putImageData(img, 0, 0);
  return big;
}

function removeLineComponents(ink: Uint8Array, W: number, H: number, pad: number) {
  const innerW = W - pad * 2, innerH = H - pad * 2;
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let y = pad; y < H - pad; y++) {
    for (let x = pad; x < W - pad; x++) {
      const k0 = y * W + x;
      if (!ink[k0] || seen[k0]) continue;
      const pixels: number[] = [];
      let x0 = x, x1 = x, y0 = y, y1 = y;
      seen[k0] = 1;
      stack.push(k0);
      while (stack.length) {
        const k = stack.pop()!;
        pixels.push(k);
        const cx = k % W, cy = (k - cx) / W;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        for (const n of [k - 1, k + 1, k - W, k + W]) {
          const nx = n % W, ny = (n - nx) / W;
          if (nx < pad || nx >= W - pad || ny < pad || ny >= H - pad || seen[n] || !ink[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const touches = x0 === pad || x1 === W - pad - 1 || y0 === pad || y1 === H - pad - 1;
      const vertical = ch >= innerH * 0.7 && cw <= innerH * 0.18 && (x0 <= pad + 1 || x1 >= W - pad - 2);
      const horizontal = cw >= innerW * 0.6 && ch <= innerH * 0.2;
      if (touches && (vertical || horizontal)) for (const k of pixels) ink[k] = 0;
    }
  }
}

/**
 * Proporción de "tinta" en un área (para detectar marcas como la "X").
 * Se descartan filas y columnas casi completas de tinta: son bordes de celda, no marcas.
 */
export function inkRatio(source: HTMLCanvasElement, rect: Rect): number {
  const r = clampRect(rect, source.width, source.height);
  if (r.w < 2 || r.h < 2) return 0;
  const d = ctx2d(source).getImageData(r.x, r.y, r.w, r.h).data;
  const n = r.w * r.h;
  const lum = new Float32Array(n);
  for (let k = 0; k < n; k++) lum[k] = gray(d, k * 4);
  // Fondo = luminancia mediana de la celda. "Tinta" = bastante más oscuro que el fondo:
  // funciona con fondo blanco o de color (la columna del indicador suele ser azul) y tolera
  // la mezcla de colores que producen la compresión JPEG y la ampliación.
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const bg = sorted[Math.floor(n / 2)]!;
  const limit = Math.min(bg * 0.62, bg - 28);
  if (limit <= 0) return 0;
  const ink = new Uint8Array(n);
  const rowInk = new Array<number>(r.h).fill(0);
  const colInk = new Array<number>(r.w).fill(0);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (lum[y * r.w + x]! < limit) {
        ink[y * r.w + x] = 1;
        rowInk[y]!++;
        colInk[x]!++;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < r.h; y++) {
    if (rowInk[y]! > r.w * 0.6) continue;
    for (let x = 0; x < r.w; x++) if (ink[y * r.w + x] && colInk[x]! <= r.h * 0.6) dark++;
  }
  return dark / n;
}

/** Miniatura de un área de la imagen (para mostrar junto al dato reconocido). */
export function snapshot(source: HTMLCanvasElement, rect: Rect, maxH = 28): string {
  const r = clampRect(rect, source.width, source.height);
  const s = Math.min(3, maxH / r.h);
  const c = createCanvas(r.w * s, r.h * s);
  const cc = ctx2d(c);
  cc.imageSmoothingQuality = "high";
  cc.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

/** Reescala un canvas (ampliación o reducción de alta calidad). */
export function scaleCanvas(source: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const out = createCanvas(source.width * factor, source.height * factor);
  const c = ctx2d(out);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

/** Rota un canvas `degrees` grados (sentido horario), con fondo blanco. */
export function rotateCanvas(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const out = createCanvas(source.width * cos + source.height * sin, source.width * sin + source.height * cos);
  const c = ctx2d(out);
  c.fillStyle = "#fff";
  c.fillRect(0, 0, out.width, out.height);
  c.translate(out.width / 2, out.height / 2);
  c.rotate(rad);
  c.imageSmoothingQuality = "high";
  c.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

/**
 * Estima la inclinación de la imagen (en grados) por perfil de proyección: prueba ángulos y elige
 * el que concentra la "tinta" (texto, bordes, barras) en menos filas. Devuelve el ángulo a aplicar
 * con `rotateCanvas` para enderezarla (0 si no hay una inclinación clara).
 */
export function estimateSkew(source: HTMLCanvasElement, maxDegrees = 8): number {
  const s = Math.min(1, 1200 / source.width);
  const small = s < 1 ? scaleCanvas(source, s) : source;
  const { width: w, height: h } = small;
  const d = ctx2d(small).getImageData(0, 0, w, h).data;
  // Sólo "tinta oscura" (texto y bordes): las barras de color verticales confunden la estimación.
  const collect = (limit: number) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (Math.max(d[i]!, d[i + 1]!, d[i + 2]!) < limit) { xs.push(x - w / 2); ys.push(y - h / 2); }
      }
    }
    return { xs, ys };
  };
  let { xs, ys } = collect(110);
  // Fotos lavadas o desenfocadas: el texto no llega a negro.
  if (xs.length < 1500) ({ xs, ys } = collect(150));
  if (xs.length < 200) return 0;
  const diag = Math.ceil(Math.hypot(w, h));
  const score = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    const sin = Math.sin(rad), cos = Math.cos(rad);
    const bins = new Float64Array(diag * 2);
    for (let k = 0; k < xs.length; k++) bins[Math.round(xs[k]! * sin + ys[k]! * cos) + diag]! += 1;
    let sum = 0;
    for (let k = 0; k < bins.length; k++) sum += bins[k]! * bins[k]!;
    return sum;
  };
  let best = 0, bestScore = score(0);
  for (let a = -maxDegrees; a <= maxDegrees; a += 0.25) {
    const sc = score(a);
    if (sc > bestScore) { bestScore = sc; best = a; }
  }
  for (let a = best - 0.25; a <= best + 0.25; a += 0.05) {
    const sc = score(a);
    if (sc > bestScore) { bestScore = sc; best = a; }
  }
  // `best` es el ángulo que alinea las filas: se aplica tal cual con rotateCanvas.
  return Math.abs(best) < 0.25 ? 0 : Math.round(best * 10) / 10;
}
