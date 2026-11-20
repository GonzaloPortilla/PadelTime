import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { login } from "./helpers";

const SHOTS = process.env.PT_SCREENSHOTS;
const IMAGE = fileURLToPath(new URL("../test/fixtures/cuadro-referencia.png", import.meta.url));
test.describe.configure({ mode: "serial" });

/** Datos verdaderos de la imagen de referencia (transcriptos a mano): [pareja, resultado, marca X]. */
const TRUTH: [string, number, boolean | null][][] = [
  [["ARIEL GONZALEZ - DIEGO CEJAS", 5, true], ["DIEGO HARRIEGUE - MAXI FERNANDEZ", 6, false]],
  [["LEONEL LARREA - LUCAS LARREA", 6, false], ["GONZALO CALANDRA - GONZALO FABRO", 4, true]],
  [["ARIEL BUFFA - LEANDRO GOROSITO", 3, true], ["LEO MOSQUERA - TIMO MOSQUERA", 6, false]],
  [["FACU CASTILLO - DANTE STASSI", 2, true], ["GUIDO GROSSO - GASTON ANDREASSI", 6, false]],
  [["EZEQUIEL CESAR - MARCELO AMPUERO", 4, true], ["TOMAS IVENICEVICH - SANTIAGO WOLF", 6, false]],
  [["MILTON GONZALEZ - EZE FONTOURA", 6, false], ["NICOLAS EMULO - CHECHO", 4, true]],
  [["NICOLAS SALAS - MILTON AHUMADA", 6, false], ["SERGIO ZANON - TIZIANO ZANON", 1, false]],
  [["NICOLAS STAMPONE - LEAN SODERO", 4, true], ["JORGE PIPINO - MATIAS ROCHELLE", 6, false]],
  [["DIEGO HARRIEGUE - MAXI FERNANDEZ", 6, false], ["LEONEL LARREA - LUCAS LARREA", 5, true]],
  [["LEO MOSQUERA - TIMO MOSQUERA", 6, false], ["GUIDO GROSSO - GASTON ANDREASSI", 1, true]],
  [["TOMAS IVENICEVICH - SANTIAGO WOLF", 6, false], ["MILTON GONZALEZ - EZE FONTOURA", 5, true]],
  [["NICOLAS SALAS - MILTON AHUMADA", 6, false], ["JORGE PIPINO - MATIAS ROCHELLE", 4, true]],
  [["DIEGO HARRIEGUE - MAXI FERNANDEZ", 3, true], ["LEO MOSQUERA - TIMO MOSQUERA", 6, false]],
  [["TOMAS IVENICEVICH - SANTIAGO WOLF", 4, false], ["NICOLAS SALAS - MILTON AHUMADA", 6, false]],
  [["LEO MOSQUERA - TIMO MOSQUERA", 2, null], ["NICOLAS SALAS - MILTON AHUMADA", 6, null]],
];
const norm = (s: string) => s.toUpperCase().replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();

let tournamentId = 0;

async function api(page: Page, method: "post" | "patch", path: string, data: unknown) {
  const base = new URL(page.url()).origin;
  const res = await page.request[method](`${base}/api${path}`, { data, headers: { origin: base } });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return res.json();
}

test("reconoce el cuadro de referencia con precisión y deduce campeones y finalistas", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  // Torneo nuevo de 4ta Caballeros (temporada 2026 activa) y tres jugadores que ya existen.
  const seasons = await (await page.request.get("/api/seasons")).json();
  const categories = await (await page.request.get("/api/categories?gender=M")).json();
  const cat4 = categories.items.find((c: { name: string }) => c.name === "4ta");
  const season = seasons.items.find((s: { status: string }) => s.status === "activa");
  const t = (await api(page, "post", "/tournaments", { seasonId: season.id, name: "Master de Primavera", type: "largo", categoryId: cat4.id, startDate: "2026-11-01", endDate: "2026-11-15" })).item;
  tournamentId = t.id;
  await api(page, "patch", `/tournaments/${t.id}/status`, { status: "en_curso" });
  for (const [firstName, lastName] of [["Nicolás", "Salas"], ["Milton", "Ahumada"], ["Leonardo", "Mosquera"]]) {
    await api(page, "post", "/players", { firstName, lastName, gender: "M", mainCategoryId: cat4.id });
  }

  await page.goto(`/torneos/${t.id}?tab=importar`);
  await page.getByLabel("Imagen del cuadro").setInputFiles(IMAGE);
  await expect(page.getByRole("button", { name: "Reconocer cuadro" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-01-imagen.png`, fullPage: true });
  const started = Date.now();
  await page.getByRole("button", { name: "Reconocer cuadro" }).click();
  await expect(page.getByRole("heading", { name: "Revisión del cuadro" })).toBeVisible({ timeout: 90_000 });
  const seconds = (Date.now() - started) / 1000;

  // Campeones y finalistas según la imagen.
  await expect(page.getByTestId("champion")).toHaveText("NICOLAS SALAS - MILTON AHUMADA");
  await expect(page.getByTestId("finalists")).toHaveText("LEO MOSQUERA - TIMO MOSQUERA");
  await expect(page.getByTestId("match-card")).toHaveCount(15);
  await expect(page.getByTestId("review-issues").locator(".bg-red-50")).toHaveCount(0);

  // Precisión campo por campo contra los datos verdaderos.
  const raw = await page.evaluate(() => (window as unknown as { __ptOcr: { mode: string; elapsedMs: number; blocks: { headerText: string; rows: { nameText: string; score: number | null; marked: boolean | null }[] }[] } }).__ptOcr);
  let names = 0, scores = 0, marks = 0, markTotal = 0;
  const errors: string[] = [];
  TRUTH.forEach((block, b) => block.forEach(([name, score, mark], r) => {
    const got = raw.blocks[b]!.rows[r]!;
    if (norm(got.nameText) === norm(name)) names++; else errors.push(`nombre: "${got.nameText}" ≠ "${name}"`);
    if (got.score === score) scores++; else errors.push(`resultado de ${name}: ${got.score} ≠ ${score}`);
    if (mark !== null) { markTotal++; if (got.marked === mark) marks++; else errors.push(`marca de ${name}: ${got.marked} ≠ ${mark}`); }
  }));
  const report = {
    imagen: "test/fixtures/cuadro-referencia.png (1222×525)",
    modo: raw.mode,
    partidos: raw.blocks.length,
    rondas: raw.blocks.map((x) => x.headerText).filter((v, i, a) => a.indexOf(v) === i),
    nombresCorrectos: `${names}/30`,
    resultadosCorrectos: `${scores}/30`,
    marcasCorrectas: `${marks}/${markTotal}`,
    tiempoReconocimientoMs: raw.elapsedMs,
    tiempoTotalSegundos: Math.round(seconds * 10) / 10,
    diferencias: errors,
  };
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/ocr-reporte.json", JSON.stringify(report, null, 2));
  console.log("Reporte OCR:", JSON.stringify(report));
  expect(raw.mode).toBe("estructura");
  expect(names).toBeGreaterThanOrEqual(28);
  expect(scores).toBeGreaterThanOrEqual(28);
  expect(marks).toBeGreaterThanOrEqual(markTotal - 2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-02-revision.png`, fullPage: true });

  // Una corrección manual recalcula al instante (y se puede deshacer).
  const finalCard = page.getByTestId("match-card").last();
  await finalCard.getByLabel(/Resultado de la pareja 2/).fill("");
  await finalCard.getByLabel(/Resultado de la pareja 1/).fill("");
  await expect(page.getByTestId("champion")).toHaveText("Sin determinar");
  await expect(page.getByText("No se pudo determinar el campeón: elegí el ganador de la final.")).toBeVisible();
  await finalCard.getByLabel(/Resultado de la pareja 1/).fill("2");
  await finalCard.getByLabel(/Resultado de la pareja 2/).fill("6");
  await expect(page.getByTestId("champion")).toHaveText("NICOLAS SALAS - MILTON AHUMADA");
  const deduced = page.getByTestId("deduced-list");
  await expect(deduced.locator("li", { hasText: "HARRIEGUE" })).toContainText("Semifinal");
  await expect(deduced.locator("li", { hasText: "ZANON" })).toContainText("Octavos de final");
});

test("vincula jugadores existentes, crea los desconocidos con confirmación e importa sin acreditar", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto(`/torneos/${tournamentId}?tab=importar`);
  await page.getByLabel("Imagen del cuadro").setInputFiles(IMAGE);
  await page.getByRole("button", { name: "Reconocer cuadro" }).click();
  await expect(page.getByRole("heading", { name: "Revisión del cuadro" })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Continuar con los jugadores" }).click();

  await expect(page.getByRole("heading", { name: "Jugadores", exact: true })).toBeVisible();
  const slots = page.getByTestId("player-slot");
  await expect(slots).toHaveCount(32);
  // Coincidencias con jugadores registrados (ignorando acentos y diminutivos).
  const slotOf = (name: string) => slots.filter({ has: page.getByText(name, { exact: true }) });
  await expect(slotOf("NICOLAS SALAS").getByLabel("Jugador para NICOLAS SALAS")).toHaveValue(/\d+/);
  await expect(slotOf("NICOLAS SALAS").getByLabel("Jugador para NICOLAS SALAS").locator("option:checked")).toContainText("Salas, Nicolás");
  await expect(slotOf("LEO MOSQUERA").getByLabel("Jugador para LEO MOSQUERA").locator("option:checked")).toContainText("Mosquera, Leonardo");
  // Hermanos: TIMO no se confunde con Leonardo Mosquera.
  await expect(slotOf("TIMO MOSQUERA").getByLabel("Jugador para TIMO MOSQUERA").locator("option:checked")).toContainText("Crear jugador nuevo");
  // "CHECHO" no tiene apellido: hay que completarlo.
  const checho = slotOf("CHECHO");
  await expect(checho.getByText(/Completá nombre y apellido/)).toBeVisible();
  await checho.getByLabel("Apellido del nuevo jugador CHECHO").fill("Rodríguez");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-03-jugadores.png`, fullPage: true });

  await expect(page.getByRole("button", { name: /Resolvé \d+ pendientes/ })).toBeDisabled();
  await page.getByRole("button", { name: /Confirmar la creación de 29 jugadores nuevos/ }).click();
  await page.getByRole("button", { name: "Revisar y confirmar" }).click();

  // Confirmación: lista completa con instancias y puntos del torneo.
  await expect(page.getByRole("heading", { name: "Confirmación", exact: true })).toBeVisible();
  const table = page.getByTestId("confirm-table");
  await expect(table.locator("tbody tr")).toHaveCount(16);
  const champRow = table.locator("tbody tr").first();
  await expect(champRow).toContainText("Nicolás Salas");
  await expect(champRow.getByRole("combobox").locator("option:checked")).toHaveText("Campeón");
  await expect(champRow).toContainText("100");
  await expect(page.getByText(/16 parejas · 32 jugadores \(29 nuevos\)/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-04-confirmacion.png`, fullPage: true });
  const importButton = page.getByRole("button", { name: "Importar resultados (sin acreditar)" });
  await expect(importButton).toBeDisabled();
  await page.getByText(/Revisé la lista completa/).click();
  await importButton.click();

  // Se importó sin acreditar: la acreditación sigue pendiente de confirmación.
  await expect(page.getByText(/Cuadro importado: 16 parejas/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Acreditación" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Sin acreditar")).toBeVisible();
  const preview = page.getByTestId("preview-table");
  await expect(preview.locator("tbody tr")).toHaveCount(32);
  await expect(preview.getByRole("row", { name: /^Nicolás Salas/ })).toContainText("Campeón");
  await expect(preview.getByRole("row", { name: /^Timo Mosquera/ })).toContainText("Finalista");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-05-acreditacion.png`, fullPage: true });

  // El organizador confirma explícitamente.
  await page.getByRole("button", { name: "Confirmar y acreditar puntos" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Acreditar puntos" }).click();
  await expect(page.getByText(/Se acreditaron .* puntos a 32 jugadores/)).toBeVisible();
});

test("queda el registro de la importación", async ({ page }) => {
  await login(page);
  await page.goto(`/torneos/${tournamentId}?tab=importar`);
  await expect(page.getByText(/cuadro-referencia\.png · 16 parejas · reemplazó/)).toBeVisible();
  await expect(page.getByText(/lectura por estructura · .*29 jugadores creados/)).toBeVisible();
});
