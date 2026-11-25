/**
 * Fase 11 · Lanzamiento: archivos históricos de resultados, redirecciones de la web anterior y cabeceras del panel.
 */
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { login } from "./helpers";

const IMAGE = fileURLToPath(new URL("../test/fixtures/cuadro-referencia.png", import.meta.url));

test("panel protegido: no se indexa, no se incrusta y pide ingresar", async ({ page }) => {
  const res = await page.goto("/admin");
  expect(res!.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(res!.headers()["x-frame-options"]).toBe("DENY");
  await expect(page).toHaveURL(/\/admin\/ingresar/);
  const api = await page.request.get("/api/players");
  expect(api.status()).toBe(401);
});

test("cuadro histórico como archivo: se sube en la categoría y se ve en la web", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/admin/torneos");
  await page.getByRole("button", { name: /Torneo Apertura/ }).click();
  await expect(page.getByRole("heading", { name: "Archivos de resultados" })).toBeVisible();
  await page.getByLabel("Subir imágenes o PDF").setInputFiles(IMAGE);
  await expect(page.getByLabel("Título del archivo")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Título del archivo").fill("Cuadro final (imagen original)");
  await page.getByRole("button", { name: "Guardar archivos" }).click();
  await expect(page.getByText("Archivos de resultados guardados")).toBeVisible();
  const tid = Number(/torneos\/(\d+)/.exec(page.url())![1]);
  // Publicarlo en la web para verlo como visitante.
  await page.getByRole("button", { name: "Editar datos" }).click();
  await page.getByRole("dialog").getByLabel("Publicar en la web").check();
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Torneo actualizado")).toBeVisible();
  const visitor = await browser.newPage();
  await visitor.goto(new URL(`/torneos/x-${tid}`, page.url()).href);
  await expect(visitor.getByRole("heading", { name: "Resultados (archivo)" })).toBeVisible();
  const img = visitor.getByRole("img", { name: /Cuadro final|Torneo Apertura/ }).first();
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await visitor.close();
});

test("redirecciones: las direcciones de la web anterior llevan a la nueva y se editan desde el panel", async ({ page }) => {
  const res = await page.request.get("/p%C3%A1gina-principal", { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  expect(res.headers().location).toBe("/");
  await login(page);
  await page.goto("/admin/web");
  await page.getByRole("link", { name: /Redirecciones/ }).click();
  await expect(page.getByRole("heading", { name: "Redirecciones" })).toBeVisible();
  await expect(page.getByText("/qatar-major-2000/…")).toBeVisible();
  await page.getByRole("button", { name: "Editar /winter-time-cup-2025" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Dirección nueva" }).fill("/torneos?estado=finalizados");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Redirección guardada")).toBeVisible();
  const r2 = await page.request.get("/winter-time-cup-2025/resultados", { maxRedirects: 0 });
  expect(r2.headers().location).toBe("/torneos?estado=finalizados");
});
