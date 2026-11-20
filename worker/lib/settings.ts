import type { PublicationSettings } from "@shared/types";

export interface PublicSettings extends PublicationSettings {
  version: number;
}

/** Lee la configuración de publicación (una sola consulta, unas pocas filas). */
export async function loadPublicSettings(db: D1Database): Promise<PublicSettings> {
  const [settingsRes, hiddenRes] = await db.batch([
    db.prepare("SELECT key, value FROM app_settings"),
    db.prepare("SELECT id FROM seasons WHERE public_visible = 0"),
  ]);
  const map = new Map((settingsRes!.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return {
    enabled: map.get("public_enabled") !== "0",
    showHistory: map.get("public_show_history") !== "0",
    title: map.get("public_title") || "Padel Time",
    hiddenSeasonIds: (hiddenRes!.results as { id: number }[]).map((r) => r.id),
    version: Number(map.get("public_version") ?? 1),
  };
}

/** Sólo la versión: es lo único que se consulta cuando la página está en caché. */
export async function publicVersion(db: D1Database): Promise<{ version: number; enabled: boolean }> {
  const { results } = await db.prepare("SELECT key, value FROM app_settings WHERE key IN ('public_version', 'public_enabled')").all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  return { version: Number(map.get("public_version") ?? 1), enabled: map.get("public_enabled") !== "0" };
}
