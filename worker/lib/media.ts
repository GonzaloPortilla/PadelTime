/**
 * Archivos de la web (imágenes y PDF). Los bytes se guardan en Workers KV (1 GB gratis, sin tarjeta);
 * en D1 sólo queda la ficha (tabla media). Todo acceso pasa por MediaStore: para usar Cloudflare R2
 * en el futuro alcanza con otra implementación de esta interfaz.
 */

export interface StoredFile { body: ReadableStream | ArrayBuffer; mime: string; filename: string }

export interface MediaStore {
  put(key: string, data: ArrayBuffer, meta: { mime: string; filename: string }): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
}

export function kvMediaStore(kv: KVNamespace): MediaStore {
  return {
    async put(key, data, meta) {
      await kv.put(key, data, { metadata: meta });
    },
    async get(key) {
      const r = await kv.getWithMetadata<{ mime: string; filename: string }>(key, "arrayBuffer");
      if (!r.value || !r.metadata) return null;
      return { body: r.value, mime: r.metadata.mime, filename: r.metadata.filename };
    },
    async delete(key) {
      await kv.delete(key);
    },
  };
}

export const mediaStore = (env: Env): MediaStore => kvMediaStore(env.MEDIA);

// ─────────────────────────── Validación ───────────────────────────
/** Formatos permitidos. Sin SVG ni HTML (pueden contener scripts). */
export const ALLOWED: Record<string, { kind: "imagen" | "documento"; ext: string; max: number; magic: (b: Uint8Array) => boolean }> = {
  "image/webp": { kind: "imagen", ext: "webp", max: 5 * 1024 * 1024, magic: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  "image/jpeg": { kind: "imagen", ext: "jpg", max: 5 * 1024 * 1024, magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { kind: "imagen", ext: "png", max: 5 * 1024 * 1024, magic: (b) => b[0] === 0x89 && ascii(b, 1, 4) === "PNG" },
  "application/pdf": { kind: "documento", ext: "pdf", max: 10 * 1024 * 1024, magic: (b) => ascii(b, 0, 5) === "%PDF-" },
};

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to));
}

/** Nombre de archivo seguro (sin rutas, sin caracteres raros) y con la extensión correcta. */
export function safeFilename(name: string, ext: string): string {
  const base = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "archivo"}.${ext}`;
}

/** Cabeceras para servir un archivo: caché larga (los archivos nunca cambian) y aislado del resto del sitio. */
export function mediaHeaders(file: { mime: string; filename: string }): Record<string, string> {
  return {
    "Content-Type": file.mime,
    "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    // Aun si un archivo intentara ejecutar código (p. ej., un PDF manipulado), queda aislado.
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
