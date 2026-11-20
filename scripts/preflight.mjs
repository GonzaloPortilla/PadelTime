#!/usr/bin/env node
/**
 * Controles previos al despliegue (se ejecuta solo con `npm run deploy`).
 * No publica nada ni contacta a Cloudflare: sólo revisa la configuración local.
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
// JSONC → JSON: quita comentarios de línea (fuera de cadenas) y comas finales.
const json = raw.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*/g, (m, str) => str ?? "").replace(/,(\s*[}\]])/g, "$1");
const config = JSON.parse(json);
const problems = [];

const db = config.d1_databases?.[0];
if (!db?.database_id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(db.database_id)) {
  problems.push("Falta el database_id real en wrangler.jsonc. Creá la base con `npx wrangler d1 create padel-time` y pegá el ID que devuelve.");
}
const iterations = Number(config.vars?.PBKDF2_ITERATIONS);
if (!(iterations >= 10000 && iterations <= 100000)) problems.push("PBKDF2_ITERATIONS debe estar entre 10000 y 100000 (recomendado 30000 en el plan gratuito).");
const ttl = Number(config.vars?.SESSION_TTL_DAYS);
if (!(ttl > 0 && ttl <= 365)) problems.push("SESSION_TTL_DAYS debe ser un número de días entre 1 y 365.");
if (!config.vars?.PUBLIC_FRAME_ANCESTORS?.includes("https://sites.google.com")) {
  console.warn("⚠ PUBLIC_FRAME_ANCESTORS no incluye https://sites.google.com: los rankings no se podrán incrustar en Google Sites.");
}

if (problems.length) {
  console.error("\n✖ No se puede desplegar todavía:\n" + problems.map((p) => `  • ${p}`).join("\n") + "\n");
  process.exit(1);
}
console.log(`✓ Configuración lista para producción (base ${db.database_name}, ${db.database_id.slice(0, 8)}…)`);
