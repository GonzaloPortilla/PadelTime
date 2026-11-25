import { expect, test } from "@playwright/test";

/** Fase 11 · Recorrido de la web pública en el celular: todas las secciones, sin desbordes ni errores. */
test("web pública en el celular: secciones del menú, sin desborde horizontal ni errores de consola", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Recursos externos (mapa de Google) pueden no cargar en el entorno de pruebas sin Internet: no son errores de la web.
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  for (const path of ["/", "/torneos", "/torneos?estado=historial", "/rankings", "/calendario", "/reglamentos", "/liga", "/cancha-abierta", "/premios", "/contacto", "/novedades"]) {
    const res = await page.goto(path);
    expect(res!.status(), path).toBe(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
    await expect(page.locator("h1").first(), path).toBeVisible();
  }
  // Una dirección de la web anterior lleva a su equivalente.
  await page.goto("/rankings-2026/c5");
  await expect(page).toHaveURL(/\/rankings$/);
  expect(errors).toEqual([]);
});
