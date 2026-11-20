/**
 * Fase 8 · Circuito del gestor de contenidos (PC y celular):
 * iniciar sesión → editar página → guardar borrador → vista previa → publicar → verificar en la web.
 */
import { expect, type Page } from "@playwright/test";
import { login } from "./helpers";

export async function cmsCircuit(page: Page, opts: { mobile: boolean; text: string; shots?: string; prefix: string }) {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await login(page);
  if (opts.mobile) await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("link", { name: "Contenidos web" }).click();
  await expect(page.getByRole("heading", { name: "Contenidos de la web" })).toBeVisible();
  if (opts.mobile) expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: /^Liga/ }).click();
  await expect(page.getByRole("heading", { name: /Editar: Liga/ })).toBeVisible();

  // Editar: agregar un bloque de texto con formato.
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await page.getByRole("button", { name: "Texto", exact: true }).click();
  const blocks = page.locator("section[aria-label^='Bloque']");
  const last = blocks.last();
  await last.getByLabel("Texto").fill(`${opts.text} **importante**.`);
  if (opts.mobile) expect(await overflow()).toBeLessThanOrEqual(0);
  if (opts.shots) await page.screenshot({ path: `${opts.shots}/${opts.prefix}-editor.png`, fullPage: true });

  // Guardar borrador: todavía no se ve en la web.
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador guardado (todavía no se ve en la web)")).toBeVisible();
  await expect(page.getByText("Cambios sin publicar")).toBeVisible();
  const visitor = await page.context().browser()!.newPage();
  await visitor.goto(new URL("/liga", page.url()).href);
  await expect(visitor.getByText(opts.text)).toHaveCount(0);

  // Vista previa: se abre en otra pestaña con el diseño real de la web.
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Vista previa" }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/\/api\/cms\/pages\/\d+\/preview/);
  await expect(popup.getByText("Vista previa · Este contenido todavía no está publicado")).toBeVisible();
  await expect(popup.getByText(`${opts.text} importante.`)).toBeVisible();
  await expect(popup.locator("p", { hasText: opts.text }).locator("strong", { hasText: "importante" })).toBeVisible();
  if (opts.shots) await popup.screenshot({ path: `${opts.shots}/${opts.prefix}-vista-previa.png`, fullPage: true });
  await popup.close();

  // Publicar y verificar en la web pública.
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado: ya se ve en la web")).toBeVisible();
  await expect(page.getByText("Cambios sin publicar")).toHaveCount(0);
  await visitor.goto(new URL("/liga", page.url()).href);
  await expect(visitor.getByText(`${opts.text} importante.`)).toBeVisible();
  if (opts.mobile) expect(await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  if (opts.shots) await visitor.screenshot({ path: `${opts.shots}/${opts.prefix}-publicado.png`, fullPage: true });

  // Historial: quedaron el borrador y la publicación, con su autor.
  await page.getByRole("button", { name: "Historial de cambios" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Publicación").first()).toBeVisible();
  await expect(dialog.getByText("Borrador guardado").first()).toBeVisible();
  await expect(dialog.getByText(/Gabriela Organizadora/).first()).toBeVisible();
  await visitor.close();
}
