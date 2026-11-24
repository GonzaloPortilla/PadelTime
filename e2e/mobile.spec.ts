import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const SHOTS = process.env.PT_SCREENSHOTS;

test("navegación y alta desde el celular", async ({ page }) => {
  await login(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-dashboard.png`, fullPage: true });
  // Sin scroll horizontal.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Abrir menú" }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m2-menu.png` });
  await page.getByRole("link", { name: "Jugadores" }).click();
  await expect(page.getByRole("heading", { name: "Jugadores" })).toBeVisible();
  // Otras pruebas agregan jugadores: se busca para no depender de la paginación.
  await page.getByPlaceholder(/Buscar por nombre/).fill("perez");
  await expect(page.getByRole("link", { name: /Pérez, Juan/ }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m3-jugadores.png`, fullPage: true });

  await page.getByRole("button", { name: "Nuevo jugador" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Andrés");
  await dialog.getByRole("textbox", { name: "Apellido", exact: true }).fill("Celular");
  // Damas está discontinuada: en un alta nueva sólo se ofrece Caballeros (ya elegida).
  await expect(dialog.getByRole("radio", { name: "Damas" })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "Caballeros" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("combobox", { name: "Categoría principal" }).selectOption({ label: "6ta" });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m4-form.png` });
  await dialog.getByRole("button", { name: "Crear jugador" }).click();
  await expect(page.getByText(/quedó registrado/)).toBeVisible();

  await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("link", { name: "Torneos" }).click();
  await expect(page.getByRole("button", { name: /Torneo Clausura/ })).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m5-torneos.png`, fullPage: true });
});

test("rankings y carga de resultados en el celular", async ({ page }) => {
  await login(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("link", { name: "Rankings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rankings" })).toBeVisible();
  await page.getByLabel("Categoría", { exact: true }).selectOption({ label: "5ta" });
  // Según el orden de las pruebas puede haber puntos o no: se verifica que cargue el contenido.
  await expect(page.getByTestId("ranking-table").or(page.getByText("Sin puntos todavía"))).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m6-rankings.png`, fullPage: true });

  await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("link", { name: "Torneos" }).click();
  await page.getByRole("button", { name: /Torneo Apertura/ }).click();
  await page.getByRole("tab", { name: "Parejas y resultados" }).click();
  await expect(page.getByTestId("team-row")).toHaveCount(3);
  expect(await overflow()).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m7-resultados.png`, fullPage: true });
  await page.getByRole("tab", { name: "Acreditación" }).click();
  await expect(page.getByTestId("preview-table")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m8-acreditacion.png`, fullPage: true });
});

test("importar un cuadro desde el celular", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("link", { name: "Torneos" }).click();
  await page.getByRole("button", { name: /Torneo Clausura/ }).click();
  await page.getByRole("tab", { name: "Importar cuadro" }).click();
  await page.getByLabel("Imagen del cuadro").setInputFiles(new URL("../test/fixtures/cuadro-referencia.png", import.meta.url).pathname);
  await page.getByRole("button", { name: "Reconocer cuadro" }).click();
  await expect(page.getByTestId("champion")).toHaveText("NICOLAS SALAS - MILTON AHUMADA", { timeout: 90_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m9-importar.png`, fullPage: false });
});
