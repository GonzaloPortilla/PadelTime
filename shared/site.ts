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

export const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const mediaId = z.string().regex(MEDIA_ID, "Archivo inválido");
/** "whatsapp" = enlace de WhatsApp configurado en los datos de la web. */
export const linkUrl = z.union([safeUrl, z.literal("whatsapp")]);

/** Secciones automáticas del inicio: muestran datos de los módulos deportivos (no se duplican en el CMS). */
export const SECTION_KINDS = ["featured_tournament", "in_progress", "upcoming", "featured", "news", "rankings", "sponsors", "venue"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export const SECTION_LABEL: Record<SectionKind, string> = {
  featured_tournament: "Próximo torneo destacado",
  in_progress: "Torneos en curso",
  upcoming: "Próximos torneos",
  featured: "Torneos destacados",
  news: "Últimas novedades",
  rankings: "Rankings de la temporada",
  sponsors: "Patrocinadores",
  venue: "Sede",
};

/** Cualquier bloque puede ocultarse sin borrarlo. */
const hidden = { hidden: z.boolean().optional() };

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: text(160), ...hidden }),
  /** Texto con formato básico: **negrita**, *cursiva* y [enlace](https://…). Nunca HTML. */
  z.object({ type: z.literal("paragraph"), text: text(4000), ...hidden }),
  z.object({ type: z.literal("list"), items: z.array(text(300)).min(1).max(50), style: z.enum(["bullets", "pills"]).optional(), ...hidden }),
  z.object({ type: z.literal("steps"), items: z.array(z.object({ title: text(120), text: text(600) })).min(1).max(20), ...hidden }),
  z.object({ type: z.literal("callout"), text: text(1000), ...hidden }),
  z.object({ type: z.literal("button"), label: text(80), url: linkUrl, ...hidden }),
  z.object({
    type: z.literal("document"), label: text(160), url: safeUrl.optional(), mediaId: mediaId.optional(), ...hidden,
  }).refine((b) => !!b.url !== !!b.mediaId, { message: "Elegí un archivo o un enlace" }),
  z.object({ type: z.literal("image"), mediaId, alt: z.string().trim().max(200).optional(), caption: z.string().trim().max(300).optional(), ...hidden }),
  z.object({ type: z.literal("gallery"), mediaIds: z.array(mediaId).min(1).max(40), caption: z.string().trim().max(300).optional(), ...hidden }),
  z.object({
    type: z.literal("hero"), title: text(80), subtitle: z.string().trim().max(160).optional(), mediaId: mediaId.nullable().optional(),
    buttons: z.array(z.object({ label: text(60), url: linkUrl })).max(4), ...hidden,
  }),
  z.object({ type: z.literal("section"), kind: z.enum(SECTION_KINDS), title: text(80), tournamentId: z.number().int().positive().nullable().optional(), ...hidden }),
]);
export type Block = z.infer<typeof blockSchema>;
export const blocksSchema = z.array(blockSchema).max(200);

/** Archivos de la biblioteca usados por una lista de bloques (para precargar sus datos y saber si se pueden borrar). */
export function mediaIdsOf(blocks: Block[]): string[] {
  const ids = new Set<string>();
  for (const b of blocks) {
    if ((b.type === "image" || b.type === "hero" || b.type === "document") && b.mediaId) ids.add(b.mediaId);
    if (b.type === "gallery") b.mediaIds.forEach((i) => ids.add(i));
  }
  return [...ids];
}

// ─────────────────────────── Texto enriquecido (seguro por construcción) ───────────────────────────
export type Inline = { t: "text"; v: string } | { t: "b"; v: string } | { t: "i"; v: string } | { t: "a"; v: string; href: string };

const INLINE = /\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;

/**
 * Convierte **negrita**, *cursiva* y [texto](url) en segmentos. El resultado nunca contiene HTML:
 * cada segmento se escapa al dibujarlo y los enlaces sólo se aceptan si son internos, https o mailto.
 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    if (m.index! > last) out.push({ t: "text", v: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "i", v: m[2] });
    else if (safeUrl.safeParse(m[4]).success) out.push({ t: "a", v: m[3]!, href: m[4]! });
    else out.push({ t: "text", v: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

// ─────────────────────────── Estados y contenidos editables ───────────────────────────
export const CONTENT_STATUSES = ["borrador", "publicada", "archivada"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = { borrador: "Borrador", publicada: "Publicada", archivada: "Archivada (oculta)" };

const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const pageContentSchema = z.object({
  title: text(120),
  summary: optional(400),
  seoTitle: optional(120),
  seoDescription: optional(300),
  blocks: blocksSchema,
});
export type PageContent = z.infer<typeof pageContentSchema>;

export const postContentSchema = z.object({
  title: text(160),
  excerpt: optional(400),
  coverMediaId: mediaId.nullish().transform((v) => v ?? null),
  pinned: z.boolean().default(false),
  tournamentId: z.number().int().positive().nullish().transform((v) => v ?? null),
  blocks: blocksSchema,
});
export type PostContent = z.infer<typeof postContentSchema>;

/** Todo guardado lleva la versión que el organizador tenía abierta: si otro guardó antes, se rechaza (409). */
export const saveContentSchema = <S extends z.ZodTypeAny>(content: S) => z.object({ version: z.number().int().min(1), content });
export const versionOnlySchema = z.object({ version: z.number().int().min(1) });

export const sponsorSchema = z.object({
  name: text(120),
  mediaId,
  url: z.union([safeUrl, z.literal("")]).nullish().transform((v) => (v ? v : null)),
  active: z.boolean().default(true),
  version: z.number().int().min(1).optional(),
});

export const EVENT_KINDS = ["cancha_abierta", "evento", "inscripcion", "otro"] as const;
export const EVENT_KIND_LABEL: Record<(typeof EVENT_KINDS)[number], string> = { cancha_abierta: "Cancha abierta", evento: "Evento", inscripcion: "Cierre de inscripción", otro: "Otro" };
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
export const eventSchema = z
  .object({
    title: text(120),
    kind: z.enum(EVENT_KINDS),
    startsOn: isoDay,
    endsOn: isoDay.nullish().or(z.literal("")).transform((v) => (v ? v : null)),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)").nullish().or(z.literal("")).transform((v) => (v ? v : null)),
    location: optional(120),
    description: optional(500),
    public: z.boolean().default(true),
    version: z.number().int().min(1).optional(),
  })
  .refine((e) => !e.endsOn || e.endsOn >= e.startsOn, { message: "La fecha de fin debe ser posterior al inicio", path: ["endsOn"] });

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
  /** Último día en que se muestra el aviso (AAAA-MM-DD); vacío = sin vencimiento. */
  announcementUntil: string;
  /** Foto de la sede (biblioteca de medios); vacío = foto actual de la web oficial. */
  venueMediaId: string;
  activeGenders: Gender[];
  /** Control de edición simultánea. */
  version: number;
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
  announcementUntil: "site_announcement_until",
  venueMediaId: "site_venue_media_id",
  activeGenders: "site_active_genders",
  version: "site_settings_version",
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
    announcementUntil: map.get("site_announcement_until") ?? "",
    venueMediaId: map.get("site_venue_media_id") ?? "",
    activeGenders: genders.length ? genders : ["M"],
    version: Number(map.get("site_settings_version") ?? 1) || 1,
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
  announcementUntil: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"), z.literal("")]).default(""),
  venueMediaId: z.union([mediaId, z.literal("")]).default(""),
  activeGenders: z.array(z.enum(["M", "F"])).min(1, "Al menos una rama activa"),
  version: z.number().int().min(1),
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
