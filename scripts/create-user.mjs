#!/usr/bin/env node
/**
 * Crea (o resetea) un organizador directamente en D1. Es la única forma de dar de alta
 * el primer administrador, ya que la aplicación no tiene registro público.
 *
 * Uso:
 *   npm run user:create -- --username admin --name "Nombre Apellido" [--role admin|organizador] [--remote] [--reset]
 *
 * La contraseña se pide por consola sin mostrarse (o se toma de PADEL_PASSWORD para uso no interactivo).
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import readline from "node:readline";

const MIN_PASSWORD_LENGTH = 10;
const ITERATIONS = 30000; // mantener en línea con PBKDF2_ITERATIONS de wrangler.jsonc

const { values: args } = parseArgs({
  options: {
    username: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "admin" },
    remote: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    iterations: { type: "string" },
    "persist-to": { type: "string" },
  },
});

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const username = (args.username ?? "").trim().toLowerCase();
if (!/^[a-z0-9._-]{3,50}$/.test(username)) fail("Indicá --username (3 a 50 caracteres: letras, números, . _ -)");
if (!["admin", "organizador"].includes(args.role)) fail("--role debe ser admin u organizador");
const displayName = (args.name ?? username).trim().slice(0, 80);
const iterations = args.iterations ? Number(args.iterations) : ITERATIONS;
if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100000) fail("--iterations debe estar entre 1000 y 100000");

let password = process.env.PADEL_PASSWORD;
if (!password) {
  password = await askHidden(`Contraseña para ${username}: `);
  const again = await askHidden("Repetila: ");
  if (password !== again) fail("Las contraseñas no coinciden");
}
if (password.length < MIN_PASSWORD_LENGTH) fail(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const stored = `pbkdf2-sha256$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}`;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = args.reset
  ? `UPDATE users SET password_hash = ${q(stored)}, active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE username = ${q(username)};
     DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ${q(username)});
     DELETE FROM login_attempts WHERE key = ${q(`u:${username}`)};`
  : `INSERT INTO users (username, display_name, password_hash, role) VALUES (${q(username)}, ${q(displayName)}, ${q(stored)}, ${q(args.role)});`;

const target = args.remote ? "--remote" : "--local";
console.log(`\n→ ${args.reset ? "Reseteando contraseña de" : "Creando"} "${username}" en la base ${args.remote ? "REMOTA (producción)" : "local"}…`);
// El SQL va en un archivo temporal y wrangler se ejecuta directamente con Node (sin pasar por
// la consola del sistema), así funciona igual en Windows, macOS y Linux.
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "padel-time-"));
const sqlFile = join(tmp, "user.sql");
writeFileSync(sqlFile, sql, "utf8");
const extra = args["persist-to"] && !args.remote ? ["--persist-to", args["persist-to"]] : [];
let res;
try {
  res = spawnSync(process.execPath, [wranglerBin, "d1", "execute", "DB", target, ...extra, "--yes", "--file", sqlFile], {
    stdio: "inherit",
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (res.status !== 0) fail("wrangler devolvió un error (¿aplicaste las migraciones? ¿el usuario ya existe? usá --reset)");
console.log(`\n✔ Listo. ${args.reset ? "Contraseña actualizada" : `Usuario "${username}" creado con rol ${args.role}`}.\n`);
