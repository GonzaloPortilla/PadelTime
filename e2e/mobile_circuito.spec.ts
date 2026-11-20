import { test } from "@playwright/test";
import { runCircuit } from "./circuit";

test("circuito completo desde el celular: torneo → puntos → cuadro → jugadores → acreditación → ranking público", async ({ page }) => {
  test.setTimeout(150_000);
  await runCircuit(page, { name: "Copa Integral Celular", mobile: true, championPoints: 120, shots: process.env.PT_SCREENSHOTS, prefix: "f5b-cel" });
});
