#!/usr/bin/env node
/**
 * Copia a public/ocr los archivos que necesita Tesseract.js en el navegador:
 * worker, motor WebAssembly (variantes LSTM) y datos del idioma español.
 * Se sirven desde el propio sitio (sin CDNs externos): gratis, con CSP estricta y sin depender de terceros.
 * Se ejecuta automáticamente después de `npm install` y antes de `dev`/`build`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = (...p) => join(root, "node_modules", ...p);
const out = (...p) => join(root, "public", "ocr", ...p);

const files = [
  [nm("tesseract.js", "dist", "worker.min.js"), out("worker.min.js")],
  // Variantes del motor sólo-LSTM: tesseract.js elige la adecuada según el navegador.
  ...["tesseract-core-lstm", "tesseract-core-simd-lstm", "tesseract-core-relaxedsimd-lstm"].flatMap((n) => [
    [nm("tesseract.js-core", `${n}.wasm.js`), out("core", `${n}.wasm.js`)],
    [nm("tesseract.js-core", `${n}.js`), out("core", `${n}.js`)],
  ]),
  // Modelo de español "best_int": más preciso que "fast" y liviano (≈2 MB comprimido).
  [nm("@tesseract.js-data", "spa", "4.0.0_best_int", "spa.traineddata.gz"), out("lang", "spa.traineddata.gz")],
];

let copied = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.warn(`[ocr] No se encontró ${from}. ¿Corriste npm install?`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  copied++;
}
console.log(`[ocr] Archivos de reconocimiento listos en public/ocr (${copied} copiados).`);
