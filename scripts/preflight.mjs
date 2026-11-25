#!/usr/bin/env node
/**
 * Controles previos al despliegue (se ejecuta solo con `npm run deploy`).
 * No publica nada ni contacta a Cloudflare: sólo revisa la configuración local.
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
// JSONC → JSON: quita comentarios de línea (fuera de cadenas) y comas finales.
const json = raw.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*/g, (m, str) => str ?? "").replace(/,(\s*[}\]])/g, "$1");
const root = JSON.parse(json);
const envName = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : null;
const config = envName ? { ...root, ...root.env?.[envName] } : root;
if (envName && !root.env?.[envName]) {
  console.error(`✖ No existe el entorno "${envName}" en wrangler.jsonc.`);
  process.exit(1);
}
const problems = [];
const placeholder = (v, ch) => !v || new RegExp(`^[${ch}-]+$`).test(v);

const db = config.d1_databases?.[0];
if (!db?.database_id || placeholder(db.database_id, "0") || placeholder(db.database_id, "1")) {
  problems.push(`Falta el database_id real en wrangler.jsonc${envName ? ` (entorno ${envName})` : ""}. Creá la base con \`npx wrangler d1 create ${db?.database_name ?? "padel-time"}\` y pegá el ID que devuelve.`);
}
const kv = config.kv_namespaces?.find((k) => k.binding === "MEDIA");
if (!kv?.id || placeholder(kv.id, "0") || placeholder(kv.id, "1")) {
  problems.push(`Falta el id real del espacio de archivos (KV)${envName ? ` del entorno ${envName}` : ""}. Crealo con \`npx wrangler kv namespace create MEDIA${envName ? ` --env ${envName}` : ""}\` y pegá el id que devuelve.`);
}
// El entorno de prueba nunca debe apuntar a la base o los archivos de producción.
if (envName) {
  if (db?.database_id === root.d1_databases?.[0]?.database_id) problems.push("El entorno de prueba usa la MISMA base que producción: creá una base aparte.");
  if (kv?.id === root.kv_namespaces?.find((k) => k.binding === "MEDIA")?.id) problems.push("El entorno de prueba usa el MISMO espacio de archivos que producción: creá uno aparte.");
  if (config.vars?.ENVIRONMENT !== "prueba") problems.push('El entorno de prueba tiene que tener ENVIRONMENT = "prueba".');
} else if (config.vars?.ENVIRONMENT && config.vars.ENVIRONMENT !== "produccion") {
  problems.push('En producción ENVIRONMENT tiene que ser "produccion".');
}
const iterations = Number(config.vars?.PBKDF2_ITERATIONS);
if (!(iterations >= 10000 && iterations <= 100000)) problems.push("PBKDF2_ITERATIONS debe estar entre 10000 y 100000 (recomendado 30000 en el plan gratuito).");
const ttl = Number(config.vars?.SESSION_TTL_DAYS);
if (!(ttl > 0 && ttl <= 365)) problems.push("SESSION_TTL_DAYS debe ser un número de días entre 1 y 365.");
if (!envName && !config.vars?.PUBLIC_FRAME_ANCESTORS?.includes("https://sites.google.com")) {
  console.warn("⚠ PUBLIC_FRAME_ANCESTORS no incluye https://sites.google.com: los rankings no se podrán incrustar en Google Sites.");
}

if (problems.length) {
  console.error("\n✖ No se puede desplegar todavía:\n" + problems.map((p) => `  • ${p}`).join("\n") + "\n");
  process.exit(1);
}
console.log(`✓ Configuración lista para ${envName ? `el entorno ${envName}` : "producción"} (base ${db.database_name}, ${db.database_id.slice(0, 8)}…)`);
