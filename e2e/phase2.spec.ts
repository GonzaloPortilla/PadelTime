import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { login } from "./helpers";

const SHOTS = process.env.PT_SCREENSHOTS;
test.describe.configure({ mode: "serial" });

async function openApertura(page: Page, tab?: string) {
  await page.getByRole("link", { name: "Torneos", exact: true }).click();
  await page.getByRole("button", { name: /Torneo Apertura/ }).click();
  await expect(page.getByRole("heading", { name: "Torneo Apertura" })).toBeVisible();
  if (tab) await page.getByRole("tab", { name: tab }).click();
}

test("carga manual de resultados con puntos en vivo", async ({ page }) => {
  await login(page);
  await openApertura(page, "Parejas y resultados");
  const rows = page.getByTestId("team-row");
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("Sin instancia: 3")).toBeVisible();

  await page.getByLabel("Instancia de Pérez / Gómez").selectOption({ label: "Campeón" });
  await page.getByLabel("Instancia de Fernández / Sosa").selectOption({ label: "Finalista" });
  await page.getByLabel("Instancia de Romero / Díaz").selectOption({ label: "Semifinal" });
  await page.getByLabel("Partidos jugados por Pérez / Gómez").fill("4");
  await page.getByLabel("Partidos ganados por Pérez / Gómez").fill("4");
  await expect(rows.nth(0).getByTestId("team-points")).toHaveText("100");
  await expect(page.getByText("3 parejas con cambios sin guardar")).toBeVisible();
  await expect(page.getByText("Campeón: 1/1")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-01-resultados.png`, fullPage: true });
  await page.getByRole("button", { name: "Guardar resultados" }).click();
  await expect(page.getByText("Resultados guardados")).toBeVisible();
  await expect(page.getByText(/cambios sin guardar/)).toHaveCount(0);
});

test("previsualización y acreditación (una sola vez)", async ({ page }) => {
  await login(page);
  await openApertura(page, "Acreditación");
  await expect(page.getByText("Sin acreditar")).toBeVisible();
  const table = page.getByTestId("preview-table");
  await expect(table.locator("tbody tr")).toHaveCount(6);
  // Jugadores de otra categoría suman en su categoría principal.
  await expect(table.getByRole("row", { name: /^Nicolás Romero/ })).toContainText("3ra");
  await expect(page.getByText("6 jugadores · 440 puntos en total")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-02-preview.png`, fullPage: true });

  await page.getByRole("button", { name: "Confirmar y acreditar puntos" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Acreditar puntos" }).click();
  await expect(page.getByText("Se acreditaron 440 puntos a 6 jugadores")).toBeVisible();
  await expect(page.getByText("Acreditado · versión 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar y acreditar puntos" })).toBeDisabled();
});

test("ranking por categoría principal y exportación a CSV y Excel", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Rankings", exact: true }).click();
  await page.getByLabel("Categoría", { exact: true }).selectOption({ label: "4ta" });
  const table = page.getByTestId("ranking-table");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.locator("tbody tr").first()).toContainText("100");
  await expect(table.locator("tbody tr").first()).toContainText("1=");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-03-ranking.png`, fullPage: true });

  const csvDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  const csv = await csvDl;
  expect(csv.suggestedFilename()).toBe("ranking-4ta-caballeros-temporada-2026.csv");
  const csvText = readFileSync((await csv.path())!, "utf8");
  expect(csvText.startsWith("﻿Posición;Jugador")).toBe(true);
  expect(csvText).toContain("1=;Gómez, Martín");

  const xlsxDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel", exact: true }).click();
  const xlsx = await xlsxDl;
  expect(xlsx.suggestedFilename()).toBe("ranking-4ta-caballeros-temporada-2026.xlsx");
  expect(readFileSync((await xlsx.path())!).subarray(0, 2).toString()).toBe("PK"); // zip válido

  const seasonDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Temporada completa" }).click();
  expect((await seasonDl).suggestedFilename()).toBe("rankings-temporada-2026.xlsx");

  // El jugador de 3ra que jugó el torneo de 4ta suma en el ranking de 3ra.
  await page.getByLabel("Categoría", { exact: true }).selectOption({ label: "3ra" });
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("Romero, Nicolás");
  await expect(table).toContainText("50");
});

test("corrección con motivo y diferencias", async ({ page }) => {
  await login(page);
  await openApertura(page, "Parejas y resultados");
  await page.getByLabel("Instancia de Pérez / Gómez").selectOption({ label: "Finalista" });
  await page.getByLabel("Instancia de Fernández / Sosa").selectOption({ label: "Campeón" });
  await page.getByRole("button", { name: "Guardar resultados" }).click();
  await expect(page.getByText("Resultados guardados")).toBeVisible();

  await page.getByRole("tab", { name: "Acreditación" }).click();
  await expect(page.getByText("Hay cambios sin acreditar")).toBeVisible();
  await expect(page.getByText("Corrección: diferencias con la versión vigente")).toBeVisible();
  await expect(page.getByRole("cell", { name: "-30" })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "+30" })).toHaveCount(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-04-correccion.png`, fullPage: true });

  await page.getByRole("button", { name: "Confirmar corrección" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Confirmar corrección" })).toBeDisabled();
  await dialog.getByLabel(/Motivo de la corrección/).fill("Se invirtió el resultado de la final");
  await dialog.getByRole("button", { name: "Confirmar corrección" }).click();
  await expect(page.getByText("Corrección confirmada (versión 2)")).toBeVisible();
  await expect(page.getByText("Acreditado · versión 2")).toBeVisible();
  await expect(page.getByText("Reemplazada por corrección")).toBeVisible();
  await expect(page.getByText(/Motivo: Se invirtió el resultado/).first()).toBeVisible();
});

test("historial del jugador con ajuste manual y anulación", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Jugadores", exact: true }).click();
  await page.getByPlaceholder(/Buscar por nombre/).fill("J-00001");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.locator("tbody tr").first().click();
  await expect(page.getByRole("heading", { name: "Juan Pérez" })).toBeVisible();
  const list = page.getByTestId("movement-list");
  await expect(list.locator("li")).toHaveCount(3); // v1, reversión de v1, v2
  await expect(page.getByRole("button", { name: /Temporada 2026 · 4ta/ })).toContainText("70");

  await page.getByRole("button", { name: "Ajuste" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Puntos").fill("-10");
  await dialog.getByLabel(/Motivo/).fill("Sanción por llegada tarde");
  await dialog.getByRole("button", { name: "Registrar ajuste" }).click();
  await expect(page.getByText("Ajuste registrado")).toBeVisible();
  await expect(page.getByRole("button", { name: /Temporada 2026 · 4ta/ })).toContainText("60");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-05-historial.png`, fullPage: true });

  await list.getByRole("button", { name: "Anular" }).click();
  await page.getByRole("dialog").getByLabel(/Motivo/).fill("Cargado por error");
  await page.getByRole("dialog").getByRole("button", { name: "Anular ajuste" }).click();
  await expect(page.getByText("Ajuste anulado")).toBeVisible();
  await expect(page.getByRole("button", { name: /Temporada 2026 · 4ta/ })).toContainText("70");
  await expect(list.getByText("Anulado")).toBeVisible();
});

test("plantillas reutilizables y puntuación propia del torneo", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Puntuación" }).click();
  await expect(page.getByRole("heading", { name: "Torneo largo estándar" })).toBeVisible();
  await page.getByRole("button", { name: "Nueva plantilla" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Master de fin de año");
  await dialog.getByLabel("Bonus por participar").fill("2");
  await dialog.getByRole("button", { name: "Guardar plantilla" }).click();
  await expect(page.getByText("Plantilla creada")).toBeVisible();
  await expect(page.getByText("+2 por participar")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-06-plantillas.png`, fullPage: true });

  // Editar la puntuación sólo para un torneo.
  await page.getByRole("link", { name: "Torneos", exact: true }).click();
  await page.getByRole("button", { name: /Torneo Clausura/ }).click();
  await page.getByRole("tab", { name: "Puntuación" }).click();
  await expect(page.getByText('Basada en "Torneo largo estándar"')).toBeVisible();
  await page.getByLabel("Puntos", { exact: true }).first().fill("150");
  await page.getByRole("button", { name: "Guardar puntuación" }).click();
  await expect(page.getByText("Puntuación del torneo guardada")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-07-puntuacion-torneo.png`, fullPage: true });

  // Inscribir una pareja con el buscador.
  await page.getByRole("tab", { name: "Parejas y resultados" }).click();
  await page.getByRole("button", { name: "Inscribir pareja" }).click();
  const teamDialog = page.getByRole("dialog");
  await teamDialog.getByRole("combobox", { name: "Jugador 1" }).fill("tano");
  await teamDialog.getByRole("option", { name: /Fernández, Lucas/ }).click();
  await teamDialog.getByRole("combobox", { name: "Jugador 2" }).fill("sosa");
  await teamDialog.getByRole("option", { name: /Sosa, Diego/ }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-08-inscribir.png` });
  await teamDialog.getByRole("button", { name: "Inscribir" }).click();
  await expect(page.getByText("Pareja inscripta")).toBeVisible();
  await page.getByLabel("Instancia de Fernández / Sosa").selectOption({ label: "Campeón" });
  await expect(page.getByTestId("team-points").first()).toHaveText("150");
});

test("revertir acreditación deja los puntos en cero y queda auditado", async ({ page }) => {
  await login(page);
  await openApertura(page, "Acreditación");
  await page.getByRole("button", { name: "Revertir acreditación" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Motivo/).fill("Prueba de reversión");
  await dialog.getByRole("button", { name: "Revertir" }).click();
  await expect(page.getByText(/Acreditación revertida/)).toBeVisible();
  await expect(page.getByText("Sin acreditar")).toBeVisible();

  await page.getByRole("link", { name: "registro de movimientos" }).click();
  await expect(page.getByRole("heading", { name: "Registro de movimientos" })).toBeVisible();
  const list = page.getByTestId("movement-list");
  // Filtrado por el torneo: 6 de v1 + 6 de su reversión + 6 de v2 + 6 de la reversión de v2.
  await expect(list.locator("li")).toHaveCount(24);
  await expect(list.getByText("Revertido").first()).toBeVisible();
});
