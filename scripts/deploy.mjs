#!/usr/bin/env node
/**
 * Despliegue (producción o entorno de prueba) — Fase 11.
 *
 *   npm run deploy            → producción (padel-time)
 *   npm run deploy:prueba     → entorno de prueba (padel-time-prueba)
 *
 * Con el plugin de Cloudflare para Vite el entorno se elige AL COMPILAR (CLOUDFLARE_ENV): por eso este script
 * compila siempre con el entorno pedido justo antes de publicar, y aplica las migraciones con la
 * configuración explícita (--config wrangler.jsonc [--env prueba]). Así es imposible publicar el código de
 * prueba contra la base de producción, o al revés.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envName = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : null;
const root = fileURLToPath(new URL("..", import.meta.url));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const run = (label, args, extraEnv = {}) => {
  console.log(`\n→ ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) {
    console.error(`\n✖ Falló: ${label}. No se publicó nada nuevo (la versión anterior sigue en línea).`);
    process.exit(r.status ?? 1);
  }
};
const envArgs = envName ? ["--env", envName] : [];

run("Controles previos", [fileURLToPath(new URL("./preflight.mjs", import.meta.url)), ...envArgs]);
run("Verificación de tipos", [tsc, "-b"]);
run(`Compilación (${envName ?? "producción"})`, [vite, "build"], envName ? { CLOUDFLARE_ENV: envName } : { CLOUDFLARE_ENV: "" });
// La compilación deja la configuración del entorno en dist/: se confirma antes de publicar.
const built = JSON.parse(readFileSync(new URL("../dist/padel_time/wrangler.json", import.meta.url), "utf8"));
const expected = envName === "prueba" ? "prueba" : "produccion";
if (built.vars?.ENVIRONMENT !== expected) {
  console.error(`✖ La compilación quedó para "${built.vars?.ENVIRONMENT}" y se pidió "${expected}". No se publica.`);
  process.exit(1);
}
console.log(`  Worker: ${built.name} · base: ${built.d1_databases?.[0]?.database_name}`);
run("Migraciones de la base (sólo agregan estructuras)", [wrangler, "d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.jsonc", ...envArgs]);
run("Publicación", [wrangler, "deploy"]);
console.log(`\n✓ Publicado ${built.name}. Verificá con: npm run check:links -- https://${built.name}.<subdominio>.workers.dev`);
