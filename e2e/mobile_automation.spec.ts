import { test } from "@playwright/test";
import { automationCircuit } from "./automation";

test("circuito integral desde el celular: competencia larga → puntos → ranking anual, con corrección", async ({ page }) => {
  test.setTimeout(240_000);
  await automationCircuit(page, { mobile: true, prefix: "f10cel", category: "C-Demo Cel", shots: process.env.PT_SCREENSHOTS });
});
