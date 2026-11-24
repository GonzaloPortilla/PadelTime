import { test } from "@playwright/test";
import { fixtureCircuit } from "./fixture";

test("fixture desde el celular: evento, grupos, resultados, copas, publicación y web", async ({ page }) => {
  test.setTimeout(180_000);
  await fixtureCircuit(page, { mobile: true, name: "Open Celular 1000", category: "6ta", categories: ["4ta", "6ta", "7ma"], shots: process.env.PT_SCREENSHOTS, prefix: "f9-cel" });
});
