import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { login } from "./helpers";
import { cmsCircuit } from "./cms";

const LOGO = fileURLToPath(new URL("../public/brand/padeltime-simbolo.png", import.meta.url));

test("CMS desde la PC: editar, guardar borrador, vista previa, publicar y ver en la web", async ({ page }) => {
  test.setTimeout(120_000);
  await cmsCircuit(page, { mobile: false, text: "La liga se juega todo el año desde la PC", shots: process.env.PT_SCREENSHOTS, prefix: "f8-pc" });
});

test("multimedia: subir una foto, usarla en una página y verla publicada", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/admin/web/multimedia");
  await page.getByLabel("Subir archivos").setInputFiles(LOGO);
  await expect(page.getByText(/archivo\(s\) subidos|ya estaban en la biblioteca/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Título" }).first()).toHaveValue("padeltime-simbolo");
  await expect(page.getByText("Sin usar").first()).toBeVisible();

  await page.goto("/admin/web");
  await page.getByRole("link", { name: /^Premios/ }).click();
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await page.getByRole("button", { name: "Imagen", exact: true }).click();
  await page.locator("section[aria-label^='Bloque']").last().getByRole("button", { name: "Elegir" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: /padeltime-simbolo/ }).first().click();
  await picker.getByRole("button", { name: "Usar selección" }).click();
  await page.locator("section[aria-label^='Bloque']").last().getByLabel("Texto alternativo (opcional)").fill("Logo de Padel Time");
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado: ya se ve en la web")).toBeVisible();

  const visitor = await browser.newPage();
  await visitor.goto(new URL("/premios", page.url()).href);
  const img = visitor.getByRole("img", { name: "Logo de Padel Time" });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await visitor.close();

  // La biblioteca ahora indica dónde se usa: no se puede borrar.
  await page.goto("/admin/web/multimedia");
  await expect(page.getByText("Página: Premios").first()).toBeVisible();
});
