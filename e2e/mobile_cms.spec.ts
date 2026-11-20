import { test } from "@playwright/test";
import { cmsCircuit } from "./cms";

test("CMS desde el celular: editar, guardar borrador, vista previa, publicar y ver en la web", async ({ page }) => {
  test.setTimeout(120_000);
  await cmsCircuit(page, { mobile: true, text: "Liga editada desde el celular", shots: process.env.PT_SCREENSHOTS, prefix: "f8-cel" });
});
