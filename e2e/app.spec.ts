import { expect, test } from "@playwright/test";
import { login, PASSWORD } from "./helpers";

const SHOTS = process.env.PT_SCREENSHOTS;

test("rechaza credenciales inválidas y protege las rutas", async ({ page }) => {
  await page.goto("/jugadores");
  await expect(page).toHaveURL(/\/ingresar/);
  await page.getByLabel("Usuario").fill("admin");
  await page.getByLabel("Contraseña").fill("incorrecta-1234");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Usuario o contraseña incorrectos");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-login.png` });
  // Después de ingresar vuelve a la ruta que se pidió.
  await page.getByLabel("Usuario").fill("admin");
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/jugadores$/);
});

test("panel principal con datos de la temporada", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Temporada 2026").first()).toBeVisible();
  await expect(page.getByText("Torneo Clausura")).toBeVisible(); // en curso
  await expect(page.getByText("Americano Fin de Año")).toBeVisible(); // próximo
  await expect(page.getByText("Jugadores activos", { exact: true })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-dashboard.png`, fullPage: true });
});

test("alta de jugador homónimo, búsqueda sin acentos y cambio de categoría", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Jugadores", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo jugador" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Juan");
  await dialog.getByRole("textbox", { name: "Apellido", exact: true }).fill("Perez");
  await expect(dialog.getByText("Ya hay 2 jugadores con este nombre")).toBeVisible();
  // Validación del lado del cliente.
  await dialog.getByRole("button", { name: "Crear jugador" }).click();
  // La rama viene elegida: Damas está discontinuada y sólo se ofrece Caballeros.
  await expect(dialog.getByRole("radio", { name: "Caballeros" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("radio", { name: "Caballeros" }).click();
  await dialog.getByRole("combobox", { name: "Categoría principal" }).selectOption({ label: "5ta" });
  await dialog.getByLabel("Apodo").fill("El Mago");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-nuevo-jugador.png` });
  await dialog.getByRole("button", { name: "Crear jugador" }).click();
  await expect(page.getByText(/quedó registrado con el código J-00012/)).toBeVisible();

  await page.getByPlaceholder(/Buscar por nombre/).fill("PÉREZ");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-jugadores.png` });
  await page.getByPlaceholder(/Buscar por nombre/).fill("mago");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.locator("tbody tr").first().click();

  await expect(page.getByRole("heading", { name: "Juan Perez" })).toBeVisible();
  await page.getByRole("button", { name: "Editar" }).click();
  const edit = page.getByRole("dialog");
  await edit.getByRole("combobox", { name: "Categoría principal" }).selectOption({ label: "4ta" });
  await edit.getByLabel("Tipo de cambio de categoría").selectOption("ascenso");
  await edit.getByLabel("Motivo").fill("Campeón del Clausura");
  await edit.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Ascenso: 5ta → 4ta")).toBeVisible();
  await expect(page.getByText("Campeón del Clausura")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-ficha-jugador.png`, fullPage: true });

  // Desactivar
  await page.getByRole("button", { name: "Desactivar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desactivar" }).click();
  await expect(page.getByText("Jugador desactivado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reactivar" })).toBeVisible();
});

test("categorías y divisiones", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Categorías" }).click();
  // Damas está discontinuada: se ve como histórico, sin alta de categorías nuevas.
  const damasCard = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Damas" }) });
  await expect(damasCard.getByText("Discontinuada · histórico")).toBeVisible();
  await expect(damasCard.getByRole("button", { name: "Categoría" })).toHaveCount(0);
  const damas = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Caballeros" }) });
  await damas.getByRole("button", { name: "Categoría" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "Damas" })).toHaveCount(0);
  await dialog.getByLabel("Nombre").fill("2da");
  await dialog.getByLabel("Nivel").fill("2");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Categoría creada")).toBeVisible();
  // Duplicada → error del servidor en el formulario.
  await damas.getByRole("button", { name: "Categoría" }).click();
  await dialog.getByLabel("Nombre").fill("2DA");
  await dialog.getByLabel("Nivel").fill("2");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Ya existe una categoría con ese nombre");
  await dialog.getByRole("button", { name: "Cancelar" }).click();

  const item = damas.locator("li", { has: page.getByRole("heading", { name: "2da" }) });
  await item.getByRole("button", { name: "División" }).click();
  await page.getByRole("dialog").getByLabel("Nombre").fill("Oro");
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(item.getByRole("button", { name: "Oro" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-categorias.png`, fullPage: true });
});

test("temporadas: crear y validar una sola activa", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Temporadas" }).click();
  await page.getByRole("button", { name: "Nueva temporada" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Año").fill("2027");
  await expect(dialog.getByLabel("Nombre")).toHaveValue("Temporada 2027");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Temporada creada")).toBeVisible();
  const card = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Temporada 2027" }) });
  await card.getByRole("button", { name: "Activar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Activar" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Ya está activa la temporada Temporada 2026");
  await page.getByRole("dialog").getByRole("button", { name: "Volver" }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/07-temporadas.png`, fullPage: true });
});

test("torneos: crear americano y cambiar estado", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Torneos", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo torneo" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Americano Primavera");
  await dialog.getByRole("radio", { name: /Americano/ }).click();
  await dialog.getByRole("combobox", { name: "Categoría" }).selectOption({ label: "6ta · Caballeros" });
  await dialog.getByLabel("División").selectOption({ label: "B" });
  await dialog.getByLabel(/^Fecha/).fill("2026-11-28");
  await dialog.getByLabel("Sede").fill("Club Padel Norte");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/08-nuevo-torneo.png` });
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Torneo creado")).toBeVisible();

  // Al crearlo se abre su página, lista para inscribir parejas.
  await expect(page.getByRole("heading", { name: "Americano Primavera" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Parejas y resultados" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Resumen" }).click();
  await expect(page.getByText("6ta Caballeros · División B")).toBeVisible();
  await page.getByRole("button", { name: "Iniciar torneo" }).click();
  await expect(page.getByRole("button", { name: "Finalizar" })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/09-detalle-torneo.png` });

  await page.getByRole("link", { name: "Torneos", exact: true }).first().click();
  await page.getByLabel("Filtrar por estado").selectOption("en_curso");
  await expect(page.getByRole("button", { name: /Americano Primavera/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Torneo Clausura/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Torneo Apertura/ })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/10-torneos.png`, fullPage: true });
});

test("un organizador no ve la gestión de usuarios; el admin sí", async ({ page }) => {
  await login(page, "marcos");
  await expect(page.getByRole("link", { name: "Usuarios" })).toHaveCount(0);
  await page.goto("/usuarios");
  await expect(page).toHaveURL(/\/admin\/?$/);
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/ingresar/);
  await login(page, "admin");
  await page.getByRole("link", { name: "Usuarios" }).click();
  await expect(page.getByText("@marcos")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/11-usuarios.png` });
});
