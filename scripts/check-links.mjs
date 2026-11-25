#!/usr/bin/env node
/**
 * Verificador de enlaces de la web pública (Fase 11). Recorre la web desde la portada siguiendo los
 * enlaces internos y avisa de cualquier página que no responda bien. Sólo LEE: no inicia sesión ni modifica nada.
 *
 * Uso:
 *   npm run check:links -- https://padel-time-prueba.<subdominio>.workers.dev
 *   npm run check:links -- https://www.padeltime.com.ar --legacy     (además prueba las direcciones de la web anterior)
 */
import { readFileSync } from "node:fs";

const [base, ...flags] = process.argv.slice(2);
if (!base || !/^https?:\/\//.test(base)) {
  console.error("Uso: npm run check:links -- <https://dirección-de-la-web> [--legacy]");
  process.exit(1);
}
const origin = new URL(base).origin;
const MAX = 400;
const seen = new Map();
const queue = ["/"];
const skip = (p) => /^\/(admin|api|media|pub|brand|web|assets)(\/|$)|\.(css|js|png|jpe?g|webp|svg|webmanifest|ico|pdf)$/i.test(p) || /[?&](formato|format)=/.test(p);

async function check(path) {
  const res = await fetch(origin + path, { redirect: "manual", headers: { "user-agent": "padel-time-check-links" } });
  const location = res.headers.get("location");
  const body = res.headers.get("content-type")?.includes("text/html") ? await res.text() : "";
  return { status: res.status, location, body, robots: res.headers.get("x-robots-tag") };
}

let problems = 0;
while (queue.length && seen.size < MAX) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  const r = await check(path);
  seen.set(path, r.status);
  if (r.status >= 300 && r.status < 400 && r.location) {
    const next = new URL(r.location, origin);
    if (next.origin === origin) queue.push(next.pathname + next.search);
    continue;
  }
  if (r.status !== 200) {
    problems++;
    console.log(`✖ ${r.status}  ${path}`);
    continue;
  }
  if (!/<title>[^<]+<\/title>/.test(r.body)) console.log(`⚠ sin <title>: ${path}`);
  if (!/<meta name="description"/.test(r.body)) console.log(`⚠ sin descripción: ${path}`);
  for (const m of r.body.matchAll(/href="([^"#]+)"/g)) {
    let href = m[1].replace(/&amp;/g, "&");
    if (href.startsWith(origin)) href = href.slice(origin.length) || "/";
    if (href.startsWith("/") && !href.startsWith("//") && !skip(href) && !seen.has(href)) queue.push(href);
  }
}

if (flags.includes("--legacy")) {
  // Direcciones de la web anterior (inventario de la Fase 6): tienen que redirigir (301) o existir.
  const csv = readFileSync(new URL("../docs/web-anterior/inventario-paginas.csv", import.meta.url), "utf8").split("\n").slice(1).filter(Boolean);
  for (const line of csv) {
    const url = line.split(",")[0];
    const path = new URL(url).pathname;
    const r = await check(path);
    if (r.status !== 301 && r.status !== 200) {
      problems++;
      console.log(`✖ ${r.status}  (web anterior) ${decodeURIComponent(path)}`);
    }
  }
  console.log(`Direcciones de la web anterior revisadas: ${csv.length}`);
}

console.log(`\nPáginas revisadas: ${seen.size}${seen.size >= MAX ? " (límite alcanzado)" : ""}. Problemas: ${problems}.`);
process.exit(problems ? 1 : 0);
