import { test } from "@playwright/test";
import { automationCircuit } from "./automation";

test("circuito integral desde la PC: competencia larga → puntos → ranking anual, con corrección", async ({ page }) => {
  test.setTimeout(240_000);
  await automationCircuit(page, { mobile: false, prefix: "f10pc", category: "C-Demo PC", shots: process.env.PT_SCREENSHOTS });
});
