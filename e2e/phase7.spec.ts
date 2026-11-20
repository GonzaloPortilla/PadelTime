import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { browsePublicSite } from "./web";

test("web pública desde la PC: todas las secciones sin iniciar sesión", async ({ page }) => {
  await browsePublicSite(page, { mobile: false, shots: process.env.PT_SCREENSHOTS, prefix: "f7-pc" });
});

test("un organizador publica un torneo desde el panel y aparece en la web", async ({ page, browser }) => {
  await login(page);
  await page.goto("/admin/torneos");
  await page.getByRole("button", { name: /Americano Fin de Año/ }).click();
  await page.getByRole("button", { name: "Editar datos" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Publicar en la web").check();
  await dialog.getByLabel("Modalidad").selectOption({ label: "Satélite 100" });
  await dialog.getByLabel("Inscripción abierta").check();
  await dialog.getByLabel("Premios").fill("Paletas para la pareja campeona");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Torneo actualizado")).toBeVisible();
  await expect(page.getByText("En la web ↗")).toBeVisible();

  // Un visitante sin sesión lo ve en la web.
  const visitor = await browser.newPage();
  await visitor.goto(new URL("/torneos", page.url()).href);
  await visitor.getByRole("link", { name: /Americano Fin de Año/ }).click();
  await expect(visitor.getByRole("heading", { level: 1, name: "Americano Fin de Año" })).toBeVisible();
  await expect(visitor.getByText("Paletas para la pareja campeona")).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Inscribirme" })).toHaveAttribute("href", /wa\.me\/\d+\?text=Hola!%20Quiero%20inscribirme%20al%20torneo%20Americano%20Fin%20de%20A%C3%B1o/);
  await visitor.goto(new URL("/torneos?modalidad=satelite-100", page.url()).href);
  await expect(visitor.getByRole("link", { name: /Americano Fin de Año/ })).toBeVisible();
  await visitor.close();
});
