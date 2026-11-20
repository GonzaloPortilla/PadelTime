import { Hono } from "hono";
import type { AppEnv } from "./types";
import { handleError, HttpError } from "./lib/errors";
import { readSession } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { categoryRoutes, divisionRoutes } from "./routes/categories";
import { playerRoutes } from "./routes/players";
import { seasonRoutes } from "./routes/seasons";
import { tournamentRoutes } from "./routes/tournaments";
import { dashboardRoutes } from "./routes/dashboard";
import { templateRoutes, tournamentScoringRoutes } from "./routes/scoring";
import { teamRoutes, tournamentTeamRoutes } from "./routes/teams";
import { creditRoutes } from "./routes/credits";
import { rankingRoutes } from "./routes/rankings";
import { movementRoutes, playerPointsRoutes } from "./routes/movements";
import { directoryRoutes, importRoutes } from "./routes/imports";
import { rankingImportRoutes } from "./routes/rankingImports";
import { publicationRoutes } from "./routes/publication";

export const app = new Hono<AppEnv>().basePath("/api");

app.onError(handleError);
app.notFound((c) => c.json({ error: { code: "no_encontrado", message: "Ruta inexistente" } }, 404));

// Cabeceras de seguridad y sin caché para toda la API.
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "same-origin");
});

// Protección CSRF: toda operación que modifica datos debe venir del mismo origen.
// (Se suma a la cookie SameSite=Strict y a la exigencia de Content-Type JSON.)
app.use("*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    const expected = new URL(c.req.url).origin;
    if (!origin || origin !== expected) {
      throw new HttpError(403, "origen_invalido", "Origen de la solicitud no permitido");
    }
  }
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

// Rutas públicas de autenticación (login). El resto exige sesión.
app.route("/auth", authRoutes);

app.use("*", async (c, next) => {
  const session = await readSession(c);
  if (!session) throw new HttpError(401, "no_autenticado", "Tu sesión expiró. Volvé a ingresar.");
  c.set("user", session.user);
  c.set("sessionId", session.sessionId);
  await next();
});

app.route("/users", userRoutes);
app.route("/categories", categoryRoutes);
app.route("/divisions", divisionRoutes);
app.route("/players", directoryRoutes);
app.route("/players", playerPointsRoutes);
app.route("/players", playerRoutes);
app.route("/seasons", seasonRoutes);
app.route("/tournaments", tournamentScoringRoutes);
app.route("/tournaments", tournamentTeamRoutes);
app.route("/tournaments", creditRoutes);
app.route("/tournaments", importRoutes);
app.route("/tournaments", tournamentRoutes);
app.route("/teams", teamRoutes);
app.route("/scoring-templates", templateRoutes);
app.route("/rankings", rankingRoutes);
app.route("/movements", movementRoutes);
app.route("/dashboard", dashboardRoutes);
app.route("/ranking-imports", rankingImportRoutes);
app.route("/publication", publicationRoutes);
