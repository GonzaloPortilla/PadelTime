import { Hono } from "hono";
import { SITE_SETTING_KEYS, siteSettingsFrom, siteSettingsSchema, type SiteSettings } from "@shared/site";
import type { AppEnv } from "../types";
import { HttpError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { auditStmt } from "../lib/audit";

/**
 * Datos de la web pública (WhatsApp, Instagram, sede, aviso destacado, ramas activas).
 * Cualquier organizador los lee (el panel los usa, p. ej., para ocultar Damas en las altas);
 * sólo un administrador los cambia. Cada cambio invalida la caché pública por trigger.
 */
export const siteRoutes = new Hono<AppEnv>();

async function load(db: D1Database): Promise<SiteSettings> {
  const { results } = await db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'site_%'").all<{ key: string; value: string }>();
  return siteSettingsFrom(new Map(results.map((r) => [r.key, r.value])));
}

siteRoutes.get("/", async (c) => c.json({ settings: await load(c.env.DB) }));

siteRoutes.put("/", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") throw new HttpError(403, "sin_permiso", "Sólo un administrador puede cambiar los datos de la web.");
  const input = await parseBody(c, siteSettingsSchema);
  const db = c.env.DB;
  const values: Record<keyof SiteSettings, string> = {
    tagline: input.tagline,
    whatsapp: input.whatsapp,
    whatsappMessage: input.whatsappMessage,
    instagram: input.instagram,
    venueName: input.venueName,
    address: input.address,
    mapLat: input.mapLat === null ? "" : String(input.mapLat),
    mapLng: input.mapLng === null ? "" : String(input.mapLng),
    announcementText: input.announcementText,
    announcementUrl: input.announcementUrl,
    activeGenders: [...new Set(input.activeGenders)].join(","),
  };
  const now = new Date().toISOString();
  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  await db.batch([
    ...(Object.keys(values) as (keyof SiteSettings)[]).map((k) => upsert.bind(SITE_SETTING_KEYS[k], values[k], now)),
    auditStmt(db, user.id, "editar", "web", null, "Actualizó los datos de la web pública"),
  ]);
  return c.json({ settings: await load(db) });
});
