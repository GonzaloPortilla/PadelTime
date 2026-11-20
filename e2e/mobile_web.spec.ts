import { test } from "@playwright/test";
import { browsePublicSite } from "./web";

test("web pública desde el celular: menú desplegable y todas las secciones sin iniciar sesión", async ({ page }) => {
  await browsePublicSite(page, { mobile: true, shots: process.env.PT_SCREENSHOTS, prefix: "f7-cel" });
});
