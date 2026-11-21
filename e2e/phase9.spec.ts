import { test } from "@playwright/test";
import { fixtureCircuit } from "./fixture";

test("fixture desde la PC: evento, grupos, resultados, copas, publicación y web", async ({ page }) => {
  test.setTimeout(180_000);
  await fixtureCircuit(page, { mobile: false, name: "Qatar Major 2000", category: "5ta", shots: process.env.PT_SCREENSHOTS, prefix: "f9-pc" });
});
