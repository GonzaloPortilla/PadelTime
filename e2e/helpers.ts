import { expect, type Page } from "@playwright/test";

export const PASSWORD = "clave-e2e-segura";

export async function login(page: Page, username = "admin") {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/ingresar/);
  await page.getByLabel("Usuario").fill(username);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: /¡Hola,/ })).toBeVisible();
}
