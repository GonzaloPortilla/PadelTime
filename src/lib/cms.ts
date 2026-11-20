import type { ContentStatus, PageContent, PostContent } from "@shared/site";
import { ApiError, api } from "@/lib/api";

export interface MediaItem {
  id: string; kind: "imagen" | "documento"; mime: string; bytes: number; width: number | null; height: number | null;
  filename: string; title: string; alt: string | null; createdAt: string; createdByName: string | null; url: string; usedIn?: string[];
}

export interface ContentDetail<T> {
  id: number; slug: string; systemKey: string | null; status: ContentStatus; version: number;
  published: T | null; draft: T | null; hasDraft: boolean; archivable: boolean;
  updatedAt: string; updatedByName: string | null; publishedAt: string | null; publishedByName: string | null;
}
export type PageDetail = ContentDetail<PageContent>;
export type PostDetail = ContentDetail<PostContent>;

export interface Revision { id: number; version: number; action: string; createdAt: string; byName: string | null }

export const REVISION_LABEL: Record<string, string> = {
  creacion: "Creación", borrador: "Borrador guardado", publicacion: "Publicación", archivo: "Ocultada", desarchivo: "Vuelta a mostrar",
  descarte: "Borrador descartado", restauracion: "Versión recuperada (como borrador)",
};

export const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;

// ─────────────────────────── Subida de archivos ───────────────────────────
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 1920;
export const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Optimiza una imagen en el navegador: máximo 1920 px, WebP (o JPEG/PNG si el navegador no lo soporta)
 * y sin metadatos (EXIF con ubicación GPS, etc.). Devuelve el archivo listo para subir.
 */
export async function optimizeImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encode = (type: string, quality?: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  let blob = await encode("image/webp", 0.82);
  if (!blob || blob.type !== "image/webp") blob = await encode(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  // Si la optimización no achica el archivo (imagen ya liviana), se sube el original.
  if (blob.size >= file.size && IMAGE_TYPES.includes(file.type) && scale === 1) return { blob: file, width, height };
  return { blob, width, height };
}

export interface UploadResult { item: MediaItem; duplicate: boolean }

/** Sube una imagen (optimizada) o un PDF. Si el mismo archivo ya está en la biblioteca, devuelve el existente. */
export async function uploadFile(file: File): Promise<UploadResult> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf && !IMAGE_TYPES.includes(file.type)) throw new Error(`"${file.name}": formato no permitido. Subí JPG, PNG, WebP o PDF.`);
  if (isPdf && file.size > 10 * 1024 * 1024) throw new Error(`"${file.name}" supera los 10 MB permitidos para documentos.`);
  if (!isPdf && file.size > 25 * 1024 * 1024) throw new Error(`"${file.name}" es demasiado grande (máximo 25 MB antes de optimizar).`);
  let body: Blob = file;
  let width: number | null = null;
  let height: number | null = null;
  if (!isPdf) ({ blob: body, width, height } = await optimizeImage(file));
  const bytes = await body.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const existing = await api.get<{ item: MediaItem | null }>(`/media/check?sha256=${sha256}`);
  if (existing.item) return { item: existing.item, duplicate: true };
  const res = await fetch("/api/media", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": isPdf ? "application/pdf" : body.type,
      "X-File-Name": encodeURIComponent(file.name),
      "X-Sha256": sha256,
      ...(width ? { "X-Width": String(width), "X-Height": String(height) } : {}),
    },
    body: bytes,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `Error ${res.status}`, data?.error?.fields ?? {});
  return data as UploadResult;
}
