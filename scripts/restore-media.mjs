#!/usr/bin/env node
/**
 * Restaura los archivos multimedia (fotos, logos, PDF) desde el .zip que descarga la pantalla Respaldo.
 * Sube cada archivo al espacio KV "MEDIA" con la misma clave (id) y sus metadatos, así las páginas
 * restauradas desde el respaldo .sql vuelven a mostrar sus imágenes.
 *
 * Uso:  node scripts/restore-media.mjs padel-time-multimedia-AAAA-MM-DD.zip [--local]
 * Sin --local sube a producción (requiere `npx wrangler login`).
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";

const [zipPath, ...flags] = process.argv.slice(2);
if (!zipPath) {
  console.error("Uso: node scripts/restore-media.mjs <archivo.zip> [--local]");
  process.exit(1);
}
const local = flags.includes("--local");
const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const manifest = JSON.parse(strFromU8(files["manifest.json"]));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "pt-media-"));
let ok = 0;
try {
  for (const m of manifest) {
    const data = files[`archivos/${m.id}/${m.filename}`];
    if (!data) { console.warn(`Falta en el zip: ${m.filename}`); continue; }
    const tmp = join(dir, m.id);
    writeFileSync(tmp, data);
    execFileSync(process.execPath, [wrangler, "kv", "key", "put", m.id, "--binding", "MEDIA", "--path", tmp,
      "--metadata", JSON.stringify({ mime: m.mime, filename: m.filename }), local ? "--local" : "--remote"], { stdio: "inherit" });
    ok++;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`✓ ${ok} de ${manifest.length} archivos restaurados ${local ? "(local)" : "en producción"}.`);
