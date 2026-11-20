import { Hono } from "hono";
import { publicationSettingsSchema } from "@shared/schemas";
import type { Gender, SeasonStatus } from "@shared/constants";
import type { PublicationLink, PublicationOverview } from "@shared/types";
import type { AppEnv } from "../types";
import { HttpError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import { loadPublicSettings } from "../lib/settings";

export const publicationRoutes = new Hono<AppEnv>();

/** Configuración y enlaces públicos de cada ranking con puntos. */
publicationRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const settings = await loadPublicSettings(db);
  const [seasons, combos] = await db.batch([
    db.prepare("SELECT id, name, year, status, public_visible FROM seasons ORDER BY year DESC, start_date DESC"),
    db.prepare(
      `SELECT x.season_id, x.category_id, c.name AS category_name, c.gender, c.level, x.division_id, d.name AS division_name, d.sort_order, x.players
         FROM (SELECT season_id, category_id, NULL AS division_id, COUNT(*) AS players
                 FROM (SELECT season_id, category_id, player_id FROM point_movements GROUP BY season_id, category_id, player_id HAVING SUM(points) <> 0)
                GROUP BY season_id, category_id
               UNION ALL
               SELECT season_id, category_id, division_id, COUNT(*)
                 FROM (SELECT season_id, category_id, division_id, player_id FROM point_movements WHERE division_id IS NOT NULL
                        GROUP BY season_id, category_id, division_id, player_id HAVING SUM(points) <> 0)
                GROUP BY season_id, category_id, division_id) x
         JOIN categories c ON c.id = x.category_id LEFT JOIN divisions d ON d.id = x.division_id
        ORDER BY x.season_id, c.gender DESC, c.level, c.name, d.sort_order IS NOT NULL, d.sort_order, d.name`,
    ),
  ]);
  const links: PublicationLink[] = (combos!.results as {
    season_id: number; category_id: number; category_name: string; gender: Gender; division_id: number | null; division_name: string | null; players: number;
  }[]).map((r) => ({
    seasonId: r.season_id, categoryId: r.category_id, categoryName: r.category_name, gender: r.gender,
    divisionId: r.division_id, divisionName: r.division_name, players: r.players,
    path: `/publico/ranking/${r.season_id}/${r.category_id}${r.division_id ? `/${r.division_id}` : ""}`,
  }));
  const body: PublicationOverview = {
    settings: { enabled: settings.enabled, showHistory: settings.showHistory, title: settings.title, hiddenSeasonIds: settings.hiddenSeasonIds },
    seasons: (seasons!.results as { id: number; name: string; year: number; status: SeasonStatus; public_visible: number }[]).map((s) => ({
      id: s.id, name: s.name, year: s.year, status: s.status, publicVisible: s.public_visible === 1,
    })),
    links,
    version: settings.version,
  };
  return c.json(body);
});

publicationRoutes.put("/settings", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") throw new HttpError(403, "sin_permiso", "Sólo un administrador puede cambiar la publicación.");
  const input = await parseBody(c, publicationSettingsSchema);
  const db = c.env.DB;
  const now = new Date().toISOString();
  const set = (key: string, value: string) =>
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE value <> excluded.value")
      .bind(key, value, now);
  await db.batch([
    set("public_enabled", input.enabled ? "1" : "0"),
    set("public_show_history", input.showHistory ? "1" : "0"),
    set("public_title", input.title),
    db.prepare("UPDATE seasons SET public_visible = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 0 ELSE 1 END WHERE public_visible <> CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 0 ELSE 1 END")
      .bind(JSON.stringify(input.hiddenSeasonIds), JSON.stringify(input.hiddenSeasonIds)),
    // Asegura que la caché pública se renueve aunque el único cambio sea de visibilidad.
    db.prepare("UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'"),
    auditStmt(db, user.id, "editar", "publicacion", null,
      `Publicación ${input.enabled ? "habilitada" : "deshabilitada"}; historial ${input.showHistory ? "visible" : "oculto"}; ${input.hiddenSeasonIds.length} temporada(s) ocultas`),
  ]);
  return c.json({ ok: true });
});
