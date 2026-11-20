/**
 * Fase 7 · Web pública: recorrido completo sin sesión (PC y celular).
 * Lo usan phase7.spec.ts (escritorio) y mobile_web.spec.ts (Pixel 7).
 */
import { expect, type Page } from "@playwright/test";

export const SECTIONS: [label: string, path: string, heading: RegExp][] = [
  ["Torneos", "/torneos", /^Torneos$/i],
  ["Rankings", "/rankings", /^Rankings$/i],
  ["Calendario", "/calendario", /^Calendario$/i],
  ["Reglamentos", "/reglamentos", /^Reglamentos$/i],
  ["Liga", "/liga", /^Liga$/i],
  ["Cancha abierta", "/cancha-abierta", /^Cancha abierta$/i],
  ["Premios", "/premios", /^Premios$/i],
  ["Contacto", "/contacto", /^Contacto e inscripciones$/i],
];

export async function browsePublicSite(page: Page, opts: { mobile: boolean; shots?: string; prefix: string }) {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // Sin cookies de sesión: la web es de acceso libre.
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /padel time/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /¿De qué se trata el circuito Padel Time\?/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inscribite por WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+/);
  expect(await overflow()).toBeLessThanOrEqual(0);
  if (opts.shots) await page.screenshot({ path: `${opts.shots}/${opts.prefix}-inicio.png`, fullPage: true });

  for (const [label, path, heading] of SECTIONS) {
    if (opts.mobile) {
      await page.locator("details.nav-m summary").click();
      await page.locator("details.nav-m").getByRole("link", { name: label, exact: true }).click();
    } else {
      await page.locator("nav.nav-d").getByRole("link", { name: label, exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    // La sección actual queda marcada en el menú (en el celular, el menú se cierra al navegar).
    await expect(page.locator(`${opts.mobile ? "details.nav-m" : "nav.nav-d"} a[href="${path}"]`)).toHaveAttribute("aria-current", "page");
    expect(await overflow(), `desborde en ${path}`).toBeLessThanOrEqual(0);
    if (opts.shots) await page.screenshot({ path: `${opts.shots}/${opts.prefix}${path.replace(/\//g, "-")}.png`, fullPage: true });
  }

  // Damas no aparece en la web.
  await page.goto("/rankings");
  await expect(page.getByText("Damas")).toHaveCount(0);
  await page.goto("/torneos?estado=historial");
  await expect(page.getByText("Americano Damas Navidad")).toHaveCount(0);

  // 404 con el diseño de la web.
  const res = await page.goto("/esta-pagina-no-existe");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Página no encontrada").first()).toBeVisible();
  await page.getByRole("link", { name: "Ir al inicio" }).click();
  await expect(page).toHaveURL(/\/$/);

  // El panel sigue protegido.
  await page.goto("/admin/torneos");
  await expect(page).toHaveURL(/\/admin\/ingresar/);
}
