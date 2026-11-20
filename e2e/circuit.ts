/**
 * Fase 5B · Circuito completo, tal como lo hace un organizador, sin atajos por API:
 * crear torneo → configurar puntos → cargar cuadro → identificar jugadores → revisar →
 * confirmar → acreditar → ranking interno y ranking público actualizados.
 * Se usa desde PC (phase5.spec.ts) y desde el celular (mobile_circuito.spec.ts).
 */
import { expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { login } from "./helpers";

const IMAGE = fileURLToPath(new URL("../test/fixtures/cuadro-referencia.png", import.meta.url));

interface Options { name: string; mobile: boolean; championPoints: number; shots?: string; prefix: string }

/** Puntos públicos de un jugador en el ranking de 4ta Caballeros de la temporada actual (0 si no figura). */
async function publicPoints(page: Page, catId: number, playerName: string): Promise<number> {
  const html = await (await page.request.get(`/publico/ranking/actual/${catId}`)).text();
  const row = html.split("<tr").find((r) => r.includes(playerName));
  if (!row) return 0;
  const m = row.match(/class="num pts">\s*([\d.]+)/);
  return m ? Number(m[1]!.replace(/\./g, "")) : 0;
}

export async function runCircuit(page: Page, o: Options) {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const checkLayout = async (step: string) => {
    if (o.shots) await page.screenshot({ path: `${o.shots}/${o.prefix}-${step}.png`, fullPage: true });
    if (o.mobile) expect(await overflow(), `desborde horizontal en "${step}"`).toBeLessThanOrEqual(0);
  };
  const nav = async (label: string) => {
    if (o.mobile) await page.getByRole("button", { name: "Abrir menú" }).click();
    await page.getByRole("link", { name: label, exact: true }).click();
  };

  await login(page);
  const categories = await (await page.request.get("/api/categories?gender=M")).json();
  const cat4 = categories.items.find((c: { name: string }) => c.name === "4ta") as { id: number };
  const before = await publicPoints(page, cat4.id, "Salas, Nicolás");

  // 1. Crear el torneo.
  await nav("Torneos");
  await page.getByRole("button", { name: "Nuevo torneo" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre").fill(o.name);
  await dialog.getByRole("radio", { name: /largo/i }).click();
  await dialog.getByLabel("Temporada").selectOption({ label: "Temporada 2026 (activa)" });
  await dialog.getByLabel("Categoría").selectOption({ label: "4ta · Caballeros" });
  await dialog.getByLabel("Fecha de inicio").fill("2026-11-20");
  await dialog.getByLabel("Fecha de finalización").fill("2026-11-22");
  await checkLayout("01-nuevo-torneo");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("heading", { name: o.name })).toBeVisible();
  await page.getByRole("tab", { name: "Resumen" }).click();
  await page.getByRole("button", { name: "Iniciar torneo" }).click();
  await expect(page.getByText("En curso").first()).toBeVisible();

  // 2. Configurar los puntos propios de este torneo.
  await page.getByRole("tab", { name: "Puntuación" }).click();
  const champion = page.getByLabel("Puntos", { exact: true }).first();
  await champion.fill(String(o.championPoints));
  await checkLayout("02-puntuacion");
  await page.getByRole("button", { name: "Guardar puntuación" }).click();
  await expect(page.getByText("Puntuación del torneo guardada")).toBeVisible();

  // 3. Cargar el cuadro (imagen) y reconocerlo.
  await page.getByRole("tab", { name: "Importar cuadro" }).click();
  await page.getByLabel("Imagen del cuadro").setInputFiles(IMAGE);
  await page.getByRole("button", { name: "Reconocer cuadro" }).click();
  await expect(page.getByRole("heading", { name: "Revisión del cuadro" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("champion")).toHaveText("NICOLAS SALAS - MILTON AHUMADA");
  await checkLayout("03-revision");
  await page.getByRole("button", { name: "Continuar con los jugadores" }).click();

  // 4. Identificar jugadores: los ya registrados se vinculan solos; los desconocidos se crean con confirmación.
  await expect(page.getByRole("heading", { name: "Jugadores", exact: true })).toBeVisible();
  await expect(page.getByTestId("player-slot")).toHaveCount(32);
  const salas = page.getByTestId("player-slot").filter({ has: page.getByText("NICOLAS SALAS", { exact: true }) });
  await expect(salas.getByLabel("Jugador para NICOLAS SALAS").locator("option:checked")).toContainText("Salas, Nicolás");
  const checho = page.getByLabel("Apellido del nuevo jugador CHECHO");
  if (await checho.isVisible()) await checho.fill("Rodríguez");
  const createNew = page.getByRole("button", { name: /Confirmar la creación de \d+ jugador/ });
  if (await createNew.isVisible()) await createNew.click();
  await checkLayout("04-jugadores");
  await page.getByRole("button", { name: "Revisar y confirmar" }).click();

  // 5. Revisar resultados: el campeón recibe los puntos configurados en el paso 2.
  await expect(page.getByRole("heading", { name: "Confirmación", exact: true })).toBeVisible();
  const table = page.getByTestId("confirm-table");
  await expect(table.locator("tbody tr")).toHaveCount(16);
  await expect(table.locator("tbody tr").first()).toContainText("Nicolás Salas");
  await expect(table.locator("tbody tr").first()).toContainText(String(o.championPoints));
  await checkLayout("05-confirmacion");
  await page.getByText(/Revisé la lista completa/).click();
  await page.getByRole("button", { name: "Importar resultados (sin acreditar)" }).click();
  await expect(page.getByText(/Cuadro importado: 16 parejas/)).toBeVisible({ timeout: 30_000 });

  // Importar NO acredita: el ranking público todavía no cambió.
  expect(await publicPoints(page, cat4.id, "Salas, Nicolás")).toBe(before);

  // 6. Confirmar y acreditar.
  await expect(page.getByText("Sin acreditar")).toBeVisible();
  const preview = page.getByTestId("preview-table");
  await expect(preview.locator("tbody tr")).toHaveCount(32);
  await expect(preview.getByRole("row", { name: /^Nicolás Salas/ })).toContainText(String(o.championPoints));
  await checkLayout("06-acreditacion");
  await page.getByRole("button", { name: "Confirmar y acreditar puntos" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Acreditar puntos" }).click();
  await expect(page.getByText(/Se acreditaron .* puntos a 32 jugadores/)).toBeVisible();
  await expect(page.getByText("Acreditado · versión 1")).toBeVisible();
  // Una segunda confirmación queda bloqueada (no se acredita dos veces).
  await expect(page.getByRole("button", { name: "Confirmar y acreditar puntos" })).toBeDisabled();

  // 7. Ranking interno actualizado.
  await nav("Rankings");
  await page.getByLabel("Categoría").selectOption({ label: "4ta" });
  const ranking = page.getByTestId("ranking-table");
  await expect(ranking.getByRole("row", { name: /Salas, Nicolás/ }).first()).toContainText(String(before + o.championPoints));
  await checkLayout("07-ranking");

  // 8. Ranking público actualizado automáticamente (también en el modo incrustado de Google Sites).
  expect(await publicPoints(page, cat4.id, "Salas, Nicolás")).toBe(before + o.championPoints);
  await page.goto(`/publico/ranking/actual/${cat4.id}`);
  await expect(page.locator("tr", { hasText: "Salas, Nicolás" }).first().locator("td.pts")).toHaveText(String(before + o.championPoints));
  await checkLayout("08-publico");
  await page.goto(`/publico/ranking/actual/${cat4.id}?embed=1`);
  await expect(page.locator("tr", { hasText: "Salas, Nicolás" }).first()).toBeVisible();
  // El buscador público encuentra al jugador y su historial incluye el torneo nuevo.
  await page.goto(`/publico/jugadores?q=salas`);
  await page.getByRole("link", { name: /Salas/ }).first().click();
  await expect(page.getByText(o.name)).toBeVisible();
  await checkLayout("09-historial-publico");
}
