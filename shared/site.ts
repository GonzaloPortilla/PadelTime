/**
 * Web pública oficial (Fase 7): modelos compartidos entre el Worker (que renderiza) y el panel
 * (que editará los contenidos en la Fase 8). Todo contenido es una lista de BLOQUES tipados:
 * no hay HTML libre, así una edición no puede romper el diseño ni inyectar código.
 */
import { z } from "zod";
import type { Gender } from "./constants";

const text = (max: number) => z.string().trim().min(1).max(max);
/** Enlaces permitidos: rutas internas, https, WhatsApp o mail. Nunca javascript: ni data:. */
export const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^\/(?!\/)/.test(u) || /^https:\/\//i.test(u) || /^mailto:/i.test(u), { message: "Enlace no permitido" });

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: text(160) }),
  z.object({ type: z.literal("paragraph"), text: text(4000) }),
  z.object({ type: z.literal("list"), items: z.array(text(300)).min(1).max(50) }),
  z.object({ type: z.literal("steps"), items: z.array(z.object({ title: text(120), text: text(600) })).min(1).max(20) }),
  z.object({ type: z.literal("callout"), text: text(1000) }),
  z.object({ type: z.literal("button"), label: text(80), url: safeUrl }),
  z.object({ type: z.literal("document"), label: text(160), url: safeUrl }),
]);
export type Block = z.infer<typeof blockSchema>;
export const blocksSchema = z.array(blockSchema).max(200);

/** Lee bloques guardados; un bloque inválido se descarta en vez de romper la página. */
export function parseBlocks(raw: string | null | undefined): Block[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((b) => {
    const r = blockSchema.safeParse(b);
    return r.success ? [r.data] : [];
  });
}

// ─────────────────────────── Modalidades de torneo ───────────────────────────
/** Según el reglamento publicado: Open 1000, Challenger 500, Satélite 100 y Master Final 2000. */
export const SERIES = ["open_1000", "challenger_500", "satelite_100", "master_2000", "otro"] as const;
export type Series = (typeof SERIES)[number];
export const SERIES_LABEL: Record<Series, string> = {
  open_1000: "Open 1000",
  challenger_500: "Challenger 500",
  satelite_100: "Satélite 100",
  master_2000: "Master Final 2000",
  otro: "Otro",
};
/** Segmento de URL para filtrar por modalidad (/torneos?modalidad=open-1000). */
export const SERIES_SLUG: Record<Series, string> = {
  open_1000: "open-1000",
  challenger_500: "challenger-500",
  satelite_100: "satelite-100",
  master_2000: "master-final-2000",
  otro: "otro",
};

// ─────────────────────────── Ajustes de la web ───────────────────────────
export interface SiteSettings {
  tagline: string;
  whatsapp: string; // sólo dígitos, con código de país (wa.me)
  whatsappMessage: string;
  instagram: string; // usuario, sin @
  venueName: string;
  address: string;
  mapLat: number | null;
  mapLng: number | null;
  announcementText: string;
  announcementUrl: string;
  activeGenders: Gender[];
}

export const SITE_SETTING_KEYS: Record<keyof SiteSettings, string> = {
  tagline: "site_tagline",
  whatsapp: "site_whatsapp",
  whatsappMessage: "site_whatsapp_message",
  instagram: "site_instagram",
  venueName: "site_venue_name",
  address: "site_address",
  mapLat: "site_map_lat",
  mapLng: "site_map_lng",
  announcementText: "site_announcement_text",
  announcementUrl: "site_announcement_url",
  activeGenders: "site_active_genders",
};

export function siteSettingsFrom(map: Map<string, string>): SiteSettings {
  const num = (k: string) => {
    const v = map.get(k);
    const n = v === undefined || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const genders = (map.get("site_active_genders") ?? "M").split(",").map((g) => g.trim()).filter((g): g is Gender => g === "M" || g === "F");
  return {
    tagline: map.get("site_tagline") ?? "",
    whatsapp: (map.get("site_whatsapp") ?? "").replace(/\D/g, ""),
    whatsappMessage: map.get("site_whatsapp_message") ?? "",
    instagram: (map.get("site_instagram") ?? "").replace(/^@/, ""),
    venueName: map.get("site_venue_name") ?? "",
    address: map.get("site_address") ?? "",
    mapLat: num("site_map_lat"),
    mapLng: num("site_map_lng"),
    announcementText: map.get("site_announcement_text") ?? "",
    announcementUrl: map.get("site_announcement_url") ?? "",
    activeGenders: genders.length ? genders : ["M"],
  };
}

export const siteSettingsSchema = z.object({
  tagline: z.string().trim().max(120),
  whatsapp: z.string().trim().regex(/^\+?[\d\s-]{0,20}$/, "Sólo números, con código de país (ej.: 5491112345678)").transform((v) => v.replace(/\D/g, "")),
  whatsappMessage: z.string().trim().max(300),
  instagram: z.string().trim().max(60).regex(/^@?[A-Za-z0-9._]*$/, "Usuario de Instagram inválido").transform((v) => v.replace(/^@/, "")),
  venueName: z.string().trim().max(120),
  address: z.string().trim().max(200),
  mapLat: z.number().min(-90).max(90).nullable(),
  mapLng: z.number().min(-180).max(180).nullable(),
  announcementText: z.string().trim().max(200),
  announcementUrl: z.union([safeUrl, z.literal("")]),
  activeGenders: z.array(z.enum(["M", "F"])).min(1, "Al menos una rama activa"),
});
export type SiteSettingsInput = z.input<typeof siteSettingsSchema>;

// ─────────────────────────── URLs amigables ───────────────────────────
export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** /torneos/p1-mallorca-1000-12: legible y estable (el número final es el id, el texto se ignora al buscar). */
export const tournamentPath = (t: { id: number; name: string }) => `/torneos/${slugify(t.name) || "torneo"}-${t.id}`;
export function tournamentIdFromSlug(slug: string): number | null {
  const m = /^(?:[a-z0-9-]*-)?(\d{1,9})$/.exec(slug);
  return m ? Number(m[1]) : null;
}

/** Enlace de WhatsApp con mensaje armado (inscripciones y consultas: decisión del 20/11/2026). */
export function whatsappUrl(phone: string, message?: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}
