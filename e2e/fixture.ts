/**
 * Fase 9 · Circuito del fixture de un torneo largo (PC y celular):
  * torneo con varias categorías → parejas → grupos → resultados → tablas → Copa de Oro / Plata → publicar → web.
 */
import { expect, type Page } from "@playwright/test";
import { login } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Llamada a la API con la sesión del navegador (para preparar datos rápido). */
async function api(page: Page, method: string, path: string, body?: unknown): Promise<Json> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`${origin}/api${path}`, { method, headers: { origin, "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${JSON.stringify(json)}`);
  return json;
}

export async function fixtureCircuit(page: Page, opts: { mobile: boolean; name: string; category: string; categories: string[]; shots?: string; prefix: string }) {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const shot = async (p: Page, step: string) => { if (opts.shots) await p.screenshot({ path: `${opts.shots}/${opts.prefix}-${step}.png`, fullPage: true }); };
  await login(page);

  // 1. Un único torneo con varias categorías (Torneos → Nuevo torneo).
  if (opts.mobile) await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("link", { name: "Torneos", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo torneo" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill(opts.name);
  await dialog.getByLabel("Fecha de inicio").fill("2026-06-01");
  await dialog.getByLabel("Fecha de finalización").fill("2026-08-31");
  const group = dialog.getByRole("group", { name: "Categorías" });
  await expect(group.getByLabel("4ta", { exact: true })).toHaveCount(1); // Damas está discontinuada: un solo "4ta"
  for (const c of opts.categories) await group.getByLabel(c, { exact: true }).check();
  await dialog.getByLabel("Publicar en la web").check();
  if (opts.mobile) expect(await overflow()).toBeLessThanOrEqual(0);
  await shot(page, "nuevo-torneo");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Torneo creado")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/torneos\/\d+\?tab=parejas/);

  // Una pestaña por categoría; se entra a la categoría que se va a jugar.
  const cats = page.getByRole("navigation", { name: "Categorías del torneo" });
  for (const c of opts.categories) await expect(cats.getByRole("link", { name: new RegExp(`^${c}`) })).toBeVisible();
  await cats.getByRole("link", { name: new RegExp(`^${opts.category}`) }).click();
  await expect(cats.getByRole("link", { name: new RegExp(`^${opts.category}`) })).toHaveAttribute("aria-current", "page");
  await page.getByRole("tab", { name: "Fixture" }).click();
  await expect(page).toHaveURL(/\/admin\/torneos\/\d+\?tab=fixture/);
  const tid = Number(/torneos\/(\d+)/.exec(page.url())![1]);

  // 2. Parejas: 8 parejas de jugadores existentes / nuevos (por API, para no alargar la prueba).
  const t = (await api(page, "GET", `/tournaments/${tid}`)).item;
  for (let i = 0; i < 8; i++) {
    const p1 = (await api(page, "POST", "/players", { firstName: `Jugador${i}A`, lastName: `${opts.prefix}${i}`, gender: "M", mainCategoryId: t.categoryId })).item;
    const p2 = (await api(page, "POST", "/players", { firstName: `Jugador${i}B`, lastName: `${opts.prefix}${i}`, gender: "M", mainCategoryId: t.categoryId })).item;
    await api(page, "POST", `/tournaments/${tid}/teams`, { player1Id: p1.id, player2Id: p2.id, seed: i < 2 ? i + 1 : null });
  }
  await page.reload();

  // 3. Grupos: propuesta en serpentina (cabezas de serie en grupos distintos) y confirmación.
  await page.getByRole("tab", { name: "Grupos y parejas" }).click();
  await page.getByRole("button", { name: "Proponer grupos (orden de inscripción)" }).click();
  await expect(page.getByRole("heading", { name: /Grupo A/ })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar grupos y generar partidos" }).click();
  await expect(page.getByText("Grupos confirmados y partidos generados")).toBeVisible();
  if (opts.mobile) expect(await overflow()).toBeLessThanOrEqual(0);
  await shot(page, "grupos");

  // 4. Resultado desde el panel (con validación del marcador).
  await page.getByRole("tab", { name: "Partidos" }).click();
  await expect(page.getByText("Fecha 1").first()).toBeVisible();
  await page.getByRole("button", { name: "Resultado" }).first().click();
  const rd = page.getByRole("dialog");
  const inputs = rd.locator("input[inputmode=numeric]");
  await inputs.nth(0).fill("6"); await inputs.nth(3).fill("5"); // set 1: 6-5 → inválido
  await inputs.nth(1).fill("6"); await inputs.nth(4).fill("2");
  await expect(rd.getByText(/Set 1: un set termina/)).toBeVisible();
  await expect(rd.getByRole("button", { name: "Guardar" })).toBeDisabled();
  await inputs.nth(0).fill("7");
  await expect(rd.getByText(/^Gana /)).toBeVisible();
  if (opts.mobile) expect(await overflow()).toBeLessThanOrEqual(0);
  await rd.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Resultado cargado")).toBeVisible();
  await expect(page.getByText("7-5 6-2").first()).toBeVisible();

  // Resto de los partidos de grupo por API (gana la pareja inscripta antes).
  let s = (await api(page, "GET", `/tournaments/${tid}/fixture`)).item;
  for (const m of s.matches.filter((x: Json) => x.phase === "grupos" && x.status === "pendiente")) {
    const w = m.team1Id < m.team2Id;
    await api(page, "PUT", `/tournaments/${tid}/fixture/matches/${m.id}/result`, { version: m.version, status: "jugado", sets: w ? [[6, 3], [6, 4]] : [[3, 6], [4, 6]] });
  }
  await page.reload();

  // 5. Posiciones.
  await page.getByRole("tab", { name: "Posiciones" }).click();
  await expect(page.getByText("6 de 6 partidos con resultado · terminado").first()).toBeVisible();
  await shot(page, "posiciones");

  // 6. Copa de Oro / Plata: propuesta y confirmación; resultado de una semifinal desde el cuadro.
  await page.getByRole("tab", { name: "Copa de Oro / Plata" }).click();
  await expect(page.getByText(/1° Grupo A/).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Cuadros armados")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Copa de Oro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Copa de Plata" })).toBeVisible();
  s = (await api(page, "GET", `/tournaments/${tid}/fixture`)).item;
  const semi = s.matches.find((m: Json) => m.phase === "oro" && m.round === 1 && m.slot === 0);
  await page.getByTestId(`bracket-${semi.id}`).click();
  const bd = page.getByRole("dialog");
  const bi = bd.locator("input[inputmode=numeric]");
  await bi.nth(0).fill("6"); await bi.nth(3).fill("4");
  await bi.nth(1).fill("6"); await bi.nth(4).fill("4");
  await bd.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Resultado cargado")).toBeVisible();
  if (opts.mobile) expect(await overflow()).toBeLessThanOrEqual(0);
  await shot(page, "copas");

  // 7. Publicar y verificar en la web pública (sin sesión).
  await expect(page.getByText("No publicado")).toBeVisible();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Fixture publicado en la web")).toBeVisible();
  await expect(page.getByText("Publicado", { exact: true })).toBeVisible();
  const visitor = await page.context().browser()!.newPage(opts.mobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {});
  await visitor.goto(new URL(`/torneos/x-${tid}`, page.url()).href);
  await expect(visitor.getByRole("heading", { name: "Fixture" })).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Grupos y posiciones" })).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Copa de Oro" })).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Copa de Plata" })).toBeVisible();
  await expect(visitor.getByText("7-5 6-2").first()).toBeVisible();
  // Un solo torneo con selector de categoría.
  const pubCats = visitor.getByRole("navigation", { name: "Categorías del torneo" });
  for (const c of opts.categories) await expect(pubCats.getByRole("link", { name: c, exact: true })).toBeVisible();
  await visitor.goto(new URL("/torneos?estado=historial", page.url()).href);
  await expect(visitor.getByRole("heading", { name: opts.name })).toHaveCount(1);
  await visitor.goto(new URL(`/torneos/x-${tid}`, page.url()).href);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(visitor, "web");

  // 8. Un cambio posterior no se ve hasta volver a publicar.
  s = (await api(page, "GET", `/tournaments/${tid}/fixture`)).item;
  const semi2 = s.matches.find((m: Json) => m.phase === "oro" && m.round === 1 && m.slot === 1);
  await api(page, "PUT", `/tournaments/${tid}/fixture/matches/${semi2.id}/result`, { version: semi2.version, status: "wo", winner: 2 });
  await page.reload();
  await expect(page.getByText("Hay cambios sin publicar")).toBeVisible();
  await visitor.reload();
  await expect(visitor.locator(".bk-side b", { hasText: "W.O." })).toHaveCount(0);
  await page.getByRole("button", { name: "Publicar cambios" }).click();
  await expect(page.getByText("Fixture publicado en la web")).toBeVisible();
  await visitor.reload();
  await expect(visitor.locator(".bk-side b", { hasText: "W.O." })).toHaveCount(1);
  await visitor.close();
}
