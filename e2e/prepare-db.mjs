// Prepara una base D1 local aislada para las pruebas E2E: migraciones + datos demo + usuarios.
import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = ".wrangler/e2e";
rmSync(new URL(`../${dir}`, import.meta.url), { recursive: true, force: true });
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
// Se ejecuta con Node directamente (sin npx ni consola) para que funcione también en Windows.
const run = (args, env = {}) => {
  const [cmd, ...rest] = args;
  const full = cmd === "wrangler" ? [wranglerBin, ...rest] : rest;
  execFileSync(process.execPath, full, { cwd: root, stdio: "ignore", env: { ...process.env, ...env } });
};
// Wrangler guarda D1 en <persist-to>/v3/d1; el plugin de Vite usa <path>/v3/d1 también.
run(["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", dir]);
run(["wrangler", "d1", "execute", "DB", "--local", "--persist-to", dir, "--file", "seed/demo.sql"]);
const pw = { PADEL_PASSWORD: "clave-e2e-segura" };
run(["node", "scripts/create-user.mjs", "--username", "admin", "--name", "Gabriela Organizadora", "--persist-to", dir], pw);
run(["node", "scripts/create-user.mjs", "--username", "marcos", "--name", "Marcos Ruiz", "--role", "organizador", "--persist-to", dir], pw);
console.log("Base E2E lista en", dir);
