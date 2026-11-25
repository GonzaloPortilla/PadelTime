/**
 * Fase 10 · Prueba integral: competencia larga de demostración → grupos → resultados → Copa de Oro / Plata →
 * posiciones finales → distribución de puntos → acreditación → ranking anual público, y una corrección
 * posterior con revisión de cambios y reacreditación (PC y celular).
 */
import { expect, type Page } from "@playwright/test";
import { login } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(page: Page, method: string, path: string, body?: unknown): Promise<Json> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`${origin}/api${path}`, { method, headers: { origin, "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${JSON.stringify(json)}`);
  return json;
}

const W = [[6, 3], [6, 4]];
const L = [[3, 6], [4, 6]];

export async function automationCircuit(page: Page, opts: { mobile: boolean; prefix: string; category: string; shots?: string }) {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const shot = async (p: Page, step: string) => { if (opts.shots) await p.screenshot({ path: `${opts.shots}/${opts.prefix}-${step}.png`, fullPage: true }); };
  await login(page);

  // 1-2. Competencia (evento con una categoría) y parejas. Un jugador tiene otra categoría principal.
  const seasons = (await api(page, "GET", "/seasons")).items as Json[];
  const season = seasons.find((s) => s.status === "activa")!;
  // Categorías propias de la prueba: no alteran los rankings que verifican las otras pruebas.
  const cat = (await api(page, "POST", "/categories", { name: opts.category, gender: "M", level: 8 })).item;
  const other = (await api(page, "POST", "/categories", { name: `${opts.category} visita`, gender: "M", level: 9 })).item;
  const ev = (await api(page, "POST", "/events", { seasonId: season.id, name: `Demo ${opts.prefix}`, startDate: "2026-06-01", endDate: "2026-08-31", categoryIds: [cat.id], publicVisible: true })).item;
  const tid = ev.tournaments[0].id as number;
  const visitorPlayer: Json[] = [];
  for (let i = 0; i < 8; i++) {
    const p1 = (await api(page, "POST", "/players", { firstName: `Demo${i}`, lastName: `${opts.prefix}A${i}`, gender: "M", mainCategoryId: i === 0 ? other.id : cat.id })).item;
    const p2 = (await api(page, "POST", "/players", { firstName: `Demo${i}`, lastName: `${opts.prefix}B${i}`, gender: "M", mainCategoryId: cat.id })).item;
    if (i === 0) visitorPlayer.push(p1, p2);
    await api(page, "POST", `/tournaments/${tid}/teams`, { player1Id: p1.id, player2Id: p2.id, seed: i < 2 ? i + 1 : null });
  }

  // 3. Grupos y fixture desde el panel.
  await page.goto(new URL(`/admin/torneos/${tid}?tab=fixture`, page.url()).href);
  await page.getByRole("tab", { name: "Grupos y parejas" }).click();
  await page.getByRole("button", { name: "Proponer grupos (orden de inscripción)" }).click();
  await page.getByRole("button", { name: "Confirmar grupos y generar partidos" }).click();
  await expect(page.getByText("Grupos confirmados y partidos generados")).toBeVisible();

  // 4. Resultados de grupos (por API: gana la pareja inscripta antes) y 5-6 posiciones / clasificados.
  let s = (await api(page, "GET", `/tournaments/${tid}/fixture`)).item;
  expect(s.tournament.status).toBe("en_curso");
  for (const m of s.matches) await api(page, "PUT", `/tournaments/${tid}/fixture/matches/${m.id}/result`, { version: m.version, status: "jugado", sets: m.team1Id < m.team2Id ? W : L });
  await page.reload();
  await page.getByRole("tab", { name: "Copa de Oro / Plata" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByText("Cuadros armados")).toBeVisible();

  // 7. Cuadros completos (gana la mejor sembrada).
  for (let round = 1; round <= 2; round++) {
    s = (await api(page, "GET", `/tournaments/${tid}/fixture`)).item;
    for (const m of s.matches.filter((x: Json) => x.phase !== "grupos" && x.round === round && x.status === "pendiente")) {
      await api(page, "PUT", `/tournaments/${tid}/fixture/matches/${m.id}/result`, { version: m.version, status: "jugado", sets: W });
    }
  }
  await page.reload();

  // 8-10. Posiciones finales, reglamento de puntos configurado y distribución para revisión.
  await expect(page.getByRole("heading", { name: "Posiciones finales y puntos" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Instancia para Campeón · Copa de Oro" })).toHaveValue(/\d+/);
  await expect(page.getByText("Campeón · Copa de Oro → Campeón").first()).toBeVisible();
  await expect(page.getByText("100 pts c/u").first()).toBeVisible();
  if (opts.mobile) expect(await overflow()).toBeLessThanOrEqual(0);
  await shot(page, "puntos");
  await page.getByRole("button", { name: "Aplicar posiciones al torneo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Posiciones finales aplicadas al torneo")).toBeVisible();
  await expect(page.getByText("Aplicadas al torneo", { exact: true })).toBeVisible();

  // 11. Confirmación de la acreditación con el flujo existente.
  await page.getByRole("button", { name: "Ir a Acreditación" }).click();
  await expect(page.getByRole("heading", { name: "Previsualización de puntos" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar y acreditar puntos" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Acreditar puntos" }).click();
  await expect(page.getByText(/Se acreditaron \d+ puntos/)).toBeVisible();
  // La pestaña de la categoría refleja el nuevo estado.
  await expect(page.getByRole("navigation", { name: "Categorías del torneo" }).getByRole("link", { name: /Finalizado/ })).toBeVisible();
  await shot(page, "acreditado");

  // 12. Rankings públicos: el jugador de otra categoría principal suma en la suya; su compañero en la categoría del torneo.
  const visitor = await page.context().browser()!.newPage(opts.mobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {});
  const origin = new URL(page.url()).origin;
  await visitor.goto(`${origin}/rankings/${season.id}/${other.id}`);
  const row7 = visitor.locator("tr", { hasText: `${opts.prefix}A0` });
  await expect(row7).toContainText("100");
  await visitor.goto(`${origin}/rankings/${season.id}/${cat.id}`);
  await expect(visitor.locator("tr", { hasText: `${opts.prefix}B0` })).toContainText("100");
  await expect(visitor.locator("tr", { hasText: `${opts.prefix}A0` })).toHaveCount(0);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(visitor, "ranking");

  // Página del torneo: resultado final con puntos (y fixture al publicarlo).
  s = (await api(page, "GET", `/tournaments/${tid}/fixture`)).item;
  await api(page, "POST", `/tournaments/${tid}/fixture/publish`, { version: s.version });
  await visitor.goto(`${origin}/torneos/x-${tid}`);
  await expect(visitor.getByRole("heading", { name: "Resultado final" })).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Copa de Oro" })).toBeVisible();
  await expect(visitor.getByText("Parejas inscriptas")).toHaveCount(0);

  // Corrección: la final de Oro se cargó al revés. Se revisan los cambios antes de guardar.
  await page.getByRole("tab", { name: "Fixture" }).click();
  await page.getByRole("tab", { name: "Copa de Oro / Plata" }).click();
  s = (await api(page, "GET", `/tournaments/${tid}/fixture`)).item;
  const final = s.matches.find((m: Json) => m.phase === "oro" && m.round === 2);
  await page.getByTestId(`bracket-${final.id}`).click();
  const rd = page.getByRole("dialog");
  const inputs = rd.locator("input[inputmode=numeric]");
  await inputs.nth(0).fill("3"); await inputs.nth(3).fill("6");
  await inputs.nth(1).fill("4"); await inputs.nth(4).fill("6");
  await rd.getByRole("button", { name: "Revisar cambios" }).click();
  const effects = rd.getByTestId("correction-effects");
  await expect(effects).toContainText("Campeón · Copa de Oro → Finalista · Copa de Oro");
  await expect(effects).toContainText("puntos acreditados (v1)");
  await rd.getByLabel("Motivo de la corrección").fill("Se cargó invertida la final");
  if (opts.mobile) expect(await overflow()).toBeLessThanOrEqual(0);
  await shot(page, "correccion");
  await rd.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Resultado corregido")).toBeVisible();
  await expect(page.getByText(/problema.* para resolver/)).toBeVisible();

  // Los puntos no cambiaron solos.
  await visitor.goto(`${origin}/rankings/${season.id}/${other.id}`);
  await expect(visitor.locator("tr", { hasText: `${opts.prefix}A0` })).toContainText("100");

  // Diferencias, motivo y corrección explícita con reversión + nueva acreditación.
  await page.getByRole("tab", { name: /^Puntos/ }).click();
  await expect(page.getByRole("heading", { name: "Diferencias con la acreditación vigente" })).toBeVisible();
  await page.getByRole("button", { name: "Aplicar corrección al torneo" }).click();
  const ad = page.getByRole("dialog");
  await ad.getByLabel("Motivo de la corrección").fill("Final de Oro corregida");
  await ad.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Posiciones finales aplicadas al torneo")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar corrección en Acreditación" }).click();
  await expect(page.getByRole("heading", { name: "Corrección: diferencias con la versión vigente" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar corrección" }).click();
  const cd = page.getByRole("dialog");
  await cd.getByLabel("Motivo de la corrección").fill("Final de Oro corregida");
  await cd.getByRole("button", { name: "Confirmar corrección" }).click();
  await expect(page.getByText("Corrección confirmada (versión 2)")).toBeVisible();

  await visitor.goto(`${origin}/rankings/${season.id}/${other.id}`);
  await expect(visitor.locator("tr", { hasText: `${opts.prefix}A0` })).toContainText("70");
  await visitor.close();
}
