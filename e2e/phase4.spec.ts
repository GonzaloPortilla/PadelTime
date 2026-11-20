import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { login } from "./helpers";

const SHOTS = process.env.PT_SCREENSHOTS;
const FIXTURE = fileURLToPath(new URL("./fixtures/ranking-6ta-caballeros-2025.xlsx", import.meta.url));
test.describe.configure({ mode: "serial" });

async function openImport(page: Page) {
  await page.getByRole("link", { name: "Importar rankings" }).click();
  await expect(page.getByRole("heading", { name: "Importar rankings" })).toBeVisible();
}

async function uploadAndMap(page: Page) {
  await page.getByLabel("Archivo de ranking").setInputFiles(FIXTURE);
  // Mapeo sugerido: título en la fila 3, jugador en B, puntos = columna "Total" (no las de cada torneo).
  await expect(page.getByLabel("Fila de títulos")).toHaveValue("3");
  await expect(page.getByLabel("Columna: Jugador (nombre completo)")).toHaveValue("1");
  await expect(page.getByLabel("Columna: Puntos")).toHaveValue("5");
  await expect(page.getByLabel("Categoría del ranking").locator("option:checked")).toHaveText("6ta Caballeros");
  await expect(page.getByLabel("Temporada del ranking").locator("option:checked")).toHaveText(/Temporada 2025/);
  await expect(page.getByTestId("mapping-counts")).toHaveText("6 filas con puntos · 2 omitidas");
}

test("importa un ranking existente desde Excel como saldo inicial", async ({ page }) => {
  await login(page);
  await openImport(page);
  await uploadAndMap(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p4-01-columnas.png`, fullPage: true });
  await page.getByText("Ver filas omitidas (2)").click();
  await expect(page.getByText(/fila 10: Sin puntos/)).toBeVisible();
  await expect(page.getByText(/fila 11: Fila de totales/)).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Jugadores: homónimos a resolver, apodos y orden invertido vinculados, uno nuevo.
  await expect(page.getByRole("heading", { name: "Jugadores" })).toBeVisible();
  await expect(page.getByTestId("players-counts")).toContainText("6 jugadores");
  const perez = page.getByLabel("Jugador para PEREZ, JUAN");
  await expect(perez).toHaveValue("");
  const juancho = await perez.locator("option", { hasText: "Juancho" }).getAttribute("value");
  await perez.selectOption(juancho!);
  await page.getByRole("tab", { name: "Todos" }).click();
  await expect(page.getByLabel("Jugador para Gomez Martin").locator("option:checked")).toContainText("Gómez, Martín");
  await expect(page.getByLabel("Jugador para Tano Fernandez").locator("option:checked")).toContainText("Fernández, Lucas");
  await expect(page.getByLabel("Jugador para Facu Diaz").locator("option:checked")).toContainText("Díaz, Facundo");
  await expect(page.getByLabel("Nombre del nuevo jugador Ramiro Quiroga")).toHaveValue("Ramiro");
  await expect(page.getByLabel("Apellido del nuevo jugador Ramiro Quiroga")).toHaveValue("Quiroga");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p4-02-jugadores.png`, fullPage: true });
  await page.getByRole("button", { name: "Ver la vista previa" }).click();

  // Vista previa verificada contra la base.
  await expect(page.getByTestId("import-preview-stats")).toContainText("1.060");
  await expect(page.getByTestId("import-lines").locator("tbody tr")).toHaveCount(6);
  await expect(page.getByTestId("import-issues")).toContainText("Temporada 2025 está cerrada");
  await expect(page.getByTestId("import-rankings")).toContainText("6ta Caballeros");
  const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
  await expect(confirmBtn).toBeDisabled();
  await page.getByLabel(/Revisé la lista completa/).check();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p4-03-vista-previa.png`, fullPage: true });
  await confirmBtn.click();
  await expect(page.getByTestId("import-done")).toContainText("Importación #1 confirmada");
  await expect(page.getByTestId("import-done")).toContainText("6 saldos iniciales · 1.060 pts · 1 jugador nuevo");
  await expect(page.getByTestId("import-history")).toContainText("ranking-6ta-caballeros-2025.xlsx");

  // El ranking interno muestra la columna "Saldo inicial".
  await page.getByRole("link", { name: "Ver el ranking" }).click();
  const table = page.getByTestId("ranking-table");
  await expect(table.locator("tbody tr")).toHaveCount(6);
  await expect(table.locator("tbody tr").first()).toContainText("Pérez, Juan");
  await expect(table.locator("tbody tr").first()).toContainText("320");
  await expect(page.getByRole("columnheader", { name: "Saldo inicial" })).toBeVisible();
});

test("la página pública muestra el ranking importado y el historial del jugador", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Publicación web" }).click();
  await page.getByLabel("Temporada de los enlaces").selectOption({ label: "Temporada 2025" });
  const link = page.getByTestId("publication-links").getByRole("textbox").first();
  const url = await link.inputValue();
  expect(url).toMatch(/\/publico\/ranking\/\d+\/\d+\?embed=1$/);
  const embedUrl = url;
  const plainUrl = url.replace("?embed=1", "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p4-04-publicacion.png`, fullPage: true });

  // Sin sesión: contexto nuevo, como un visitante de Google Sites.
  const visitor = await page.context().browser()!.newContext({ locale: "es-AR" });
  const pub = await visitor.newPage();
  await pub.goto(plainUrl);
  await expect(pub.getByRole("heading", { name: "Ranking 6ta Caballeros" })).toBeVisible();
  const rows = pub.locator("#ranking tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText("Pérez, Juan");
  await expect(rows.first()).toContainText("320");
  await expect(rows.nth(5)).toContainText("Quiroga, Ramiro");
  // Filtro instantáneo.
  await pub.getByLabel("Filtrar por nombre").fill("facu");
  await expect(rows.filter({ visible: true })).toHaveCount(1);
  await pub.getByLabel("Filtrar por nombre").fill("");
  if (SHOTS) await pub.screenshot({ path: `${SHOTS}/p4-05-publico.png`, fullPage: true });

  // Modo incrustado (como dentro de Google Sites) y vista de celular.
  await pub.setViewportSize({ width: 390, height: 800 });
  await pub.goto(embedUrl);
  await expect(pub.locator("header.top")).toHaveCount(0);
  await expect(pub.getByRole("link", { name: /Ver en Padel Time/ })).toBeVisible();
  if (SHOTS) await pub.screenshot({ path: `${SHOTS}/p4-06-embed-celular.png`, fullPage: true });
  await pub.setViewportSize({ width: 1280, height: 800 });

  // Historial del jugador.
  await pub.goto(plainUrl);
  await pub.getByRole("link", { name: "Pérez, Juan" }).click();
  await expect(pub.getByRole("heading", { name: /Juan Pérez/ })).toBeVisible();
  await expect(pub.getByText("Saldo inicial importado").first()).toBeVisible();
  await expect(pub.getByText(/1°.*de 6/)).toBeVisible();
  if (SHOTS) await pub.screenshot({ path: `${SHOTS}/p4-07-jugador.png`, fullPage: true });

  // Buscador.
  await pub.goto("/publico/jugadores?q=quiroga");
  await expect(pub.getByRole("link", { name: /Quiroga, Ramiro/ })).toBeVisible();
  // La descarga a Excel funciona sin sesión.
  const resp = await pub.request.get(`${plainUrl}?descargar=xlsx`);
  expect(resp.status()).toBe(200);
  expect(resp.headers()["content-disposition"]).toContain(".xlsx");
  await visitor.close();
});

test("impide importar dos veces el mismo archivo y permite revertir", async ({ page }) => {
  await login(page);
  await openImport(page);
  await uploadAndMap(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  const perez = page.getByLabel("Jugador para PEREZ, JUAN");
  await perez.selectOption((await perez.locator("option", { hasText: "Juancho" }).getAttribute("value"))!);
  // Quiroga ya existe: ahora se vincula solo.
  await page.getByRole("tab", { name: "Todos" }).click();
  await expect(page.getByLabel("Jugador para Ramiro Quiroga").locator("option:checked")).toContainText("Quiroga, Ramiro");
  await page.getByRole("button", { name: "Ver la vista previa" }).click();
  await expect(page.getByTestId("import-issues")).toContainText("Este archivo ya fue importado");
  await expect(page.getByRole("button", { name: /error.* para corregir/ })).toBeDisabled();

  // Revertir desde el historial.
  const history = page.getByTestId("import-history");
  await history.getByRole("button", { name: "Revertir" }).click();
  await page.getByLabel("Motivo de la reversión").fill("Prueba de reversión");
  await page.getByRole("dialog").getByRole("button", { name: /Revertir 6 saldos/ }).click();
  await expect(page.getByText("Importación revertida: 6 saldos anulados")).toBeVisible();
  await expect(history).toContainText("Revertida");

  // La vista pública se actualiza sola.
  const pub = await page.context().browser()!.newPage();
  await pub.goto(page.url().replace(/\/importar-rankings.*/, "/publico"));
  await expect(pub.getByText("6ta Caballeros")).toHaveCount(0);
  await pub.close();
});
