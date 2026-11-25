#!/usr/bin/env node
/**
 * Migración del contenido de la web anterior (www.padeltime.com.ar, Google Sites) — Fase 11.
 *
 * En la web anterior, fixtures, tablas, copas, rankings y calendario son IMÁGENES. Este script las
 * conserva como archivos (no inventa datos estructurados), en tres pasos:
 *
 *   1) node scripts/migrar-web-anterior.mjs descargar
 *        Lee la web anterior (sólo lectura) según el inventario de la Fase 6 y guarda las imágenes de
 *        cada página en ./migracion-web-anterior/, con un índice (manifest.json). Damas queda afuera.
 *
 *   2) node scripts/migrar-web-anterior.mjs plantilla
 *        Crea ./migracion-web-anterior/correspondencias.json: para cada sección y categoría de la web anterior,
 *        el organizador anota el número de la categoría (competencia) ya creada en la web nueva
 *        (es el número que aparece en el panel: /admin/torneos/<número>). Lo que quede vacío no se sube.
 *
 *   3) node scripts/migrar-web-anterior.mjs subir --url https://<web> --usuario <usuario>
 *        Sube cada imagen a la biblioteca de la web nueva y la agrega como "archivo de resultados" de la
 *        categoría indicada. No borra ni reemplaza nada: sólo agrega (y no duplica archivos ya subidos).
 *        Las imágenes de rankings y calendario quedan en la biblioteca (Contenidos web → Multimedia).
 *        La contraseña se pide por consola (o PADEL_PASSWORD).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, def = null) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : def);
const DIR = opt("carpeta", "migracion-web-anterior");
const OLD = "https://www.padeltime.com.ar";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IMG_RX = /https:\/\/lh\d+-[a-z]+\.googleusercontent\.com\/sitesv-images-rt\/[A-Za-z0-9_-]+(?:=[A-Za-z0-9-]+)?/g;

function inventory() {
  const lines = readFileSync(new URL("../docs/web-anterior/inventario-paginas.csv", import.meta.url), "utf8").split("\n").slice(1).filter(Boolean);
  // url,titulo,seccion,tipo,formato,funcionalidad,damas  (los títulos no tienen comas en el inventario)
  return lines.map((l) => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    const path = decodeURIComponent(new URL(cells[0]).pathname).toLowerCase();
    // Damas (discontinuada): por la marca del inventario o por la dirección (damas, femenino, d5…d9).
    const damas = cells.includes("Sí") || /damas|femenino|\/d\d(\/|$)|\/d\d\/\d/.test(path);
    return { url: cells[0], titulo: cells[1], seccion: cells[2], tipo: cells[3], damas };
  });
}

async function descargar() {
  const pages = inventory().filter((p) => !p.damas && !p.tipo.startsWith("Índice") && p.tipo !== "Portada" && p.tipo !== "Reglamento");
  console.log(`Páginas con contenido (sin Damas): ${pages.length}. Leyendo la web anterior (sólo lectura)…`);
  const found = [];
  for (const [i, p] of pages.entries()) {
    const res = await fetch(p.url, { headers: { "user-agent": "padel-time-migracion" } });
    const html = res.ok ? await res.text() : "";
    found.push({ ...p, images: [...new Set(html.match(IMG_RX) ?? [])], status: res.status });
    process.stdout.write(`\r  ${i + 1}/${pages.length}`);
    await sleep(250); // sin apuro: no cargar el sitio de Google
  }
  console.log();
  // Las imágenes que se repiten en muchas páginas son del diseño (logo, banner): no son resultados.
  const freq = new Map();
  for (const p of found) for (const u of p.images) freq.set(u.split("=")[0], (freq.get(u.split("=")[0]) ?? 0) + 1);
  const chrome = new Set([...freq].filter(([, n]) => n > 3).map(([u]) => u));
  mkdirSync(DIR, { recursive: true });
  const manifest = [];
  for (const p of found) {
    const segs = new URL(p.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    // /torneo/c5/fixture · /torneo/masculino/c6/fixture → "c6" · /satelites/masculino/c8/santiago-p2-100 → "c8/santiago-p2-100"
    // /winter-time-cup-2025/resultados → "general" · /rankings-2026/caballeros-2026/c5 → "c5"
    const inner = segs.slice(1).filter((x) => !/^(masculino|caballeros(-\d+)?)$/i.test(x));
    const whole = p.tipo === "Resultado de Satélite" || /^(Ranking|Calendario)/.test(p.tipo);
    const categoria = whole ? inner.join("/") || "general" : inner.length > 1 ? inner.slice(0, -1).join("/") : "general";
    const imgs = p.images.filter((u) => !chrome.has(u.split("=")[0]));
    for (const [n, u] of imgs.entries()) {
      // La mayor resolución disponible; si Google no la sirve, la original de la página.
      let r = await fetch(u.replace(/=w\d+$/, "") + "=w4096");
      if (!r.ok) r = await fetch(u);
      if (!r.ok) { console.log(`✖ ${r.status} ${p.url}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") ?? "";
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const base = segs.join("__").replace(/[^a-z0-9_ñáéíóú-]/gi, "-");
      const file = `${base}${imgs.length > 1 ? `-${n + 1}` : ""}.${ext}`;
      writeFileSync(join(DIR, file), buf);
      manifest.push({ seccion: p.seccion, categoria, tipo: p.tipo, titulo: p.titulo, urlAnterior: p.url, archivo: file, mime, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") });
      await sleep(150);
    }
  }
  writeFileSync(join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  const sinImagen = found.filter((p) => !p.images.some((u) => !chrome.has(u.split("=")[0])));
  console.log(`✓ ${manifest.length} imágenes guardadas en ./${DIR} (índice: manifest.json).`);
  if (sinImagen.length) console.log(`  Páginas sin imagen de contenido: ${sinImagen.map((p) => decodeURIComponent(new URL(p.url).pathname)).join(", ")}`);
}

function plantilla() {
  const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
  const out = {};
  for (const m of manifest) {
    if (/^(rankings-|calendario-|ranking-general)/.test(m.seccion)) { out[m.seccion] = "biblioteca"; continue; }
    out[m.seccion] ??= {};
    if (typeof out[m.seccion] === "object") out[m.seccion][m.categoria ?? "general"] = null;
  }
  const file = join(DIR, "correspondencias.json");
  if (existsSync(file)) { console.error(`Ya existe ${file}: no se sobrescribe.`); process.exit(1); }
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`✓ ${file} creado. Completá cada null con el número de la categoría en la web nueva (/admin/torneos/<número>).`);
}

async function ask(q) {
  if (process.env.PADEL_PASSWORD) return process.env.PADEL_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a); }));
}

const pngSize = (b) => (b.length > 24 && b.readUInt32BE(12) === 0x49484452 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [null, null]);

async function subir() {
  const base = opt("url");
  const usuario = opt("usuario");
  if (!base || !usuario) { console.error("Uso: subir --url https://<web> --usuario <usuario>"); process.exit(1); }
  const origin = new URL(base).origin;
  const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
  const map = JSON.parse(readFileSync(join(DIR, "correspondencias.json"), "utf8"));
  const password = await ask(`Contraseña de ${usuario}: `);
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: usuario, password }) });
  if (!login.ok) { console.error("✖ No se pudo ingresar:", (await login.json()).error?.message); process.exit(1); }
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const api = (path, init = {}) => fetch(`${origin}/api${path}`, { ...init, headers: { origin, cookie, ...(init.headers ?? {}) } });
  const pending = new Map(); // tournamentId → archivos nuevos
  let up = 0, skipped = 0;
  for (const m of manifest) {
    const target = map[m.seccion] === "biblioteca" ? "biblioteca" : map[m.seccion]?.[m.categoria ?? "general"];
    if (!target) { skipped++; continue; }
    const buf = readFileSync(join(DIR, m.archivo));
    const [w, h] = m.mime.includes("png") ? pngSize(buf) : [null, null];
    const res = await api("/media", { method: "POST", body: buf, headers: { "content-type": m.mime, "x-file-name": encodeURIComponent(`${m.seccion} ${m.categoria ?? ""} ${m.titulo}`.trim()), "x-sha256": m.sha256, ...(w ? { "x-width": String(w), "x-height": String(h) } : {}) } });
    const json = await res.json();
    if (!res.ok) { console.log(`✖ ${m.archivo}: ${json.error?.message}`); continue; }
    up++;
    if (target !== "biblioteca") pending.set(target, [...(pending.get(target) ?? []), { mediaId: json.item.id, label: m.titulo.charAt(0) + m.titulo.slice(1).toLowerCase() }]);
  }
  for (const [tid, files] of pending) {
    const cur = await api(`/tournaments/${tid}`);
    if (!cur.ok) { console.log(`✖ La categoría ${tid} no existe en la web nueva`); continue; }
    const { item } = await cur.json();
    const merged = [...item.resultFiles, ...files.filter((f) => !item.resultFiles.some((x) => x.mediaId === f.mediaId))];
    const put = await api(`/tournaments/${tid}/files`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: merged }) });
    console.log(put.ok ? `✓ ${item.name} (${item.categoryName}): ${merged.length} archivo(s)` : `✖ ${item.name}: ${(await put.json()).error?.message}`);
  }
  console.log(`\nSubidos: ${up}. Sin correspondencia (no subidos): ${skipped}.`);
}

if (cmd === "descargar") await descargar();
else if (cmd === "plantilla") plantilla();
else if (cmd === "subir") await subir();
else {
  console.log("Uso: node scripts/migrar-web-anterior.mjs descargar | plantilla | subir --url <web> --usuario <usuario>");
  process.exit(1);
}
