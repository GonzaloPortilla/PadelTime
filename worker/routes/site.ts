import { Hono } from "hono";
import { SITE_SETTING_KEYS, siteSettingsFrom, siteSettingsSchema, type SiteSettings } from "@shared/site";
import type { AppEnv } from "../types";
import { HttpError } from "../lib/errors";
import { parseBody } from "../lib/validate";

/**
 * Datos de la web pública (WhatsApp, Instagram, sede, aviso destacado, ramas activas).
 * Cualquier organizador los lee y edita (contacto, sede, avisos); las ramas activas sólo un administrador.
 * Cada cambio invalida la caché pública por trigger.
 */
export const siteRoutes = new Hono<AppEnv>();

async function load(db: D1Database): Promise<SiteSettings> {
  const { results } = await db.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'site_%'").all<{ key: string; value: string }>();
  return siteSettingsFrom(new Map(results.map((r) => [r.key, r.value])));
}

siteRoutes.get("/", async (c) => c.json({ settings: await load(c.env.DB) }));

siteRoutes.put("/", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, siteSettingsSchema);
  const db = c.env.DB;
  const current = await load(db);
  // Contacto, sede y avisos los edita cualquier organizador; las ramas activas son una decisión sensible: sólo admin.
  const gendersChanged = [...input.activeGenders].sort().join(",") !== [...current.activeGenders].sort().join(",");
  if (gendersChanged && user.role !== "admin") throw new HttpError(403, "sin_permiso", "Sólo un administrador puede cambiar las ramas activas.");
  // Edición simultánea: si otro guardó mientras éste editaba, no se pisa.
  if (input.version !== current.version) {
    throw new HttpError(409, "version_desactualizada", "Otro organizador guardó los datos de la web recién. Recargá para ver los valores actuales: tus cambios no se guardaron.");
  }
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
    announcementUntil: input.announcementUntil,
    venueMediaId: input.venueMediaId,
    activeGenders: [...new Set(input.activeGenders)].join(","),
    version: String(current.version + 1),
  };
  const now = new Date().toISOString();
  // La versión se incrementa sólo si sigue siendo la leída (dos guardados simultáneos: sólo uno gana).
  const bump = db.prepare("UPDATE app_settings SET value = ?, updated_at = ? WHERE key = 'site_settings_version' AND value = ?").bind(String(current.version + 1), now, String(current.version));
  const res = await db.batch([
    bump,
    ...(Object.keys(values) as (keyof SiteSettings)[]).filter((k) => k !== "version").map((k) =>
      // Cada escritura se encadena a la anterior (changes() > 0): si la versión no subió, no se escribe nada.
      db.prepare("INSERT INTO app_settings (key, value, updated_at) SELECT ?1, ?2, ?3 WHERE changes() > 0 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(SITE_SETTING_KEYS[k], values[k], now)),
    db.prepare("INSERT INTO audit_log (user_id, action, entity, summary) SELECT ?, 'editar', 'web', 'Actualizó los datos de la web pública' WHERE changes() > 0").bind(user.id),
  ]);
  if (!res[0]!.meta.changes) throw new HttpError(409, "version_desactualizada", "Otro organizador guardó los datos de la web recién. Recargá: tus cambios no se guardaron.");
  return c.json({ settings: await load(db) });
});
