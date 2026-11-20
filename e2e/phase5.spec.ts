import { test } from "@playwright/test";
import { runCircuit } from "./circuit";

test("circuito completo desde la PC: torneo → puntos → cuadro → jugadores → acreditación → ranking público", async ({ page }) => {
  test.setTimeout(150_000);
  await runCircuit(page, { name: "Copa Integral PC", mobile: false, championPoints: 150, shots: process.env.PT_SCREENSHOTS, prefix: "f5b-pc" });
});

test("respaldo: se descarga desde la app y se restaura con wrangler en una base nueva", async ({ page }) => {
  test.setTimeout(150_000);
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { expect } = await import("@playwright/test");
  const { login } = await import("./helpers");

  await login(page);
  await page.getByRole("link", { name: "Respaldo", exact: true }).click();
  await expect(page.getByText(/confidencial/i)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar respaldo (.sql)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^padel-time-respaldo-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.sql$/);
  const dir = mkdtempSync(join(tmpdir(), "pt-restore-"));
  const sqlPath = join(dir, "respaldo.sql");
  await file.saveAs(sqlPath);
  await expect(page.getByText(/Último: .* registros/)).toBeVisible();

  // Restauración real, con los mismos comandos de docs/RESPALDO.md (en local).
  const root = fileURLToPath(new URL("..", import.meta.url));
  const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const run = (...args: string[]) => execFileSync(process.execPath, [wrangler, ...args, "--local", "--persist-to", join(dir, "db")], { cwd: root, encoding: "utf8" });
  try {
    run("d1", "migrations", "apply", "DB");
    run("d1", "execute", "DB", `--file=${sqlPath}`);
    const count = (table: string) => JSON.parse(run("d1", "execute", "DB", "--json", `--command=SELECT COUNT(*) AS n FROM ${table}`))[0].results[0].n as number;
    const live = async (table: string) => {
      const start = await (await page.request.post("/api/backup/start", { headers: { origin: new URL(page.url()).origin } })).json();
      return start.tables.find((t: { table: string }) => t.table === table).count as number;
    };
    for (const table of ["players", "tournaments", "tournament_credits", "point_movements", "initial_balances"]) {
      expect(count(table), table).toBe(await live(table));
    }
    expect(count("players")).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
