/**
 * Fase 8 · Gestor de contenidos: borrador → vista previa → publicación, historial, concurrencia,
 * permisos, multimedia (validación, duplicados, borrado seguro) y seguridad (XSS).
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Client, createUser, loggedInAdmin, ORIGIN, rawFetch } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PNG_1X1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const pub = async (path: string) => {
  const res = await rawFetch(path, { redirect: "manual" });
  return { res, html: await res.text() };
};

async function organizer(name = "orga") {
  await createUser(name, "clave-segura-456", "organizador");
  const c = new Client();
  await c.login(name, "clave-segura-456");
  return c;
}

async function pageBySlug(c: Client, slug: string) {
  const list = (await c.get("/api/cms/pages")).json.items as Json[];
  const row = list.find((p) => p.slug === slug)!;
  return (await c.get(`/api/cms/pages/${row.id}`)).json.item as Json;
}

async function upload(c: Client, body: Uint8Array, type: string, name: string, extra: Record<string, string> = {}) {
  const res = await rawFetch("/api/media", {
    method: "POST",
    headers: { origin: ORIGIN, cookie: c.cookie, "content-type": type, "x-file-name": encodeURIComponent(name), ...extra },
    body,
  });
  return { status: res.status, json: (await res.json()) as Json };
}

const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("CMS · circuito de publicación", () => {
  it("borrador → vista previa → publicar → visible en la web, con historial", async () => {
    const { client } = await loggedInAdmin();
    const org = await organizer();
    const page = await pageBySlug(org, "liga");
    const content = { ...page.published, blocks: [...page.published.blocks, { type: "paragraph", text: "La liga **2027** arranca en marzo." }] };

    const draft = await org.put(`/api/cms/pages/${page.id}/draft`, { version: page.version, content });
    expect(draft.status).toBe(200);
    expect(draft.json.item).toMatchObject({ status: "publicada", hasDraft: true, version: page.version + 1 });
    // El borrador NO se ve en la web.
    expect((await pub("/liga")).html).not.toContain("arranca en marzo");

    // Vista previa: sólo con sesión, con el diseño real y marcada como vista previa.
    expect((await rawFetch(`/api/cms/pages/${page.id}/preview`)).status).toBe(401);
    const preview = await rawFetch(`/api/cms/pages/${page.id}/preview`, { headers: { cookie: org.cookie } });
    const previewHtml = await preview.text();
    expect(preview.status).toBe(200);
    expect(preview.headers.get("x-robots-tag")).toBe("noindex");
    expect(previewHtml).toContain("Vista previa");
    expect(previewHtml).toContain("La liga <strong>2027</strong> arranca en marzo.");

    const published = await org.post(`/api/cms/pages/${page.id}/publish`, { version: draft.json.item.version });
    expect(published.status).toBe(200);
    expect(published.json.item).toMatchObject({ status: "publicada", hasDraft: false, publishedByName: "ORGA" });
    expect((await pub("/liga")).html).toContain("La liga <strong>2027</strong> arranca en marzo.");

    const revs = (await client.get(`/api/cms/pages/${page.id}/revisions`)).json.items as Json[];
    expect(revs.map((r) => r.action).slice(0, 2)).toEqual(["publicacion", "borrador"]);
    expect(revs[0]!.byName).toBe("ORGA");
    const audit = await env.DB.prepare("SELECT summary FROM audit_log WHERE action = 'publicar'").all<{ summary: string }>();
    expect(audit.results.some((r) => r.summary.includes("Liga"))).toBe(true);
  });

  it("recupera una versión anterior como borrador y descarta borradores", async () => {
    const { client } = await loggedInAdmin();
    let page = await pageBySlug(client, "premios");
    const original = page.published;
    const v1 = await client.post(`/api/cms/pages/${page.id}/publish`, { version: page.version, content: { ...original, blocks: [{ type: "paragraph", text: "Texto nuevo de premios" }] } });
    expect((await pub("/premios")).html).toContain("Texto nuevo de premios");
    const revs = (await client.get(`/api/cms/pages/${page.id}/revisions`)).json.items as Json[];
    expect(revs).toHaveLength(1);
    // No hay revisión del contenido sembrado: se recupera desde la primera publicación... o del original guardado en un borrador.
    const draft = await client.put(`/api/cms/pages/${page.id}/draft`, { version: v1.json.item.version, content: original });
    const restoreFrom = (await client.get(`/api/cms/pages/${page.id}/revisions`)).json.items.find((r: Json) => r.action === "publicacion");
    const restored = await client.post(`/api/cms/pages/${page.id}/restore`, { version: draft.json.item.version, revisionId: restoreFrom.id });
    expect(restored.status).toBe(200);
    expect(restored.json.item.draft.blocks[0].text).toBe("Texto nuevo de premios");
    const discarded = await client.post(`/api/cms/pages/${page.id}/discard`, { version: restored.json.item.version });
    expect(discarded.json.item.hasDraft).toBe(false);
    page = discarded.json.item;
    expect(page.published.blocks[0].text).toBe("Texto nuevo de premios");
  });

  it("ocultar una página la quita de la web y del menú; las páginas estructurales no se pueden ocultar", async () => {
    const { client } = await loggedInAdmin();
    const liga = await pageBySlug(client, "liga");
    const archived = await client.post(`/api/cms/pages/${liga.id}/archive`, { version: liga.version });
    expect(archived.json.item.status).toBe("archivada");
    expect((await pub("/liga")).res.status).toBe(404);
    expect((await pub("/")).html).not.toContain('href="/liga"');
    const back = await client.post(`/api/cms/pages/${liga.id}/unarchive`, { version: archived.json.item.version });
    expect(back.json.item.status).toBe("publicada");
    expect((await pub("/liga")).res.status).toBe(200);
    const inicio = await pageBySlug(client, "inicio");
    expect((await client.post(`/api/cms/pages/${inicio.id}/archive`, { version: inicio.version })).status).toBe(409);
  });
});

describe("CMS · edición simultánea", () => {
  it("si otro organizador guardó antes, el segundo recibe 409 con nombre y no se pisa nada", async () => {
    const { client } = await loggedInAdmin();
    const org = await organizer();
    const a = await pageBySlug(client, "reglamentos");
    const b = await pageBySlug(org, "reglamentos");
    expect((await org.put(`/api/cms/pages/${b.id}/draft`, { version: b.version, content: { ...b.published, title: "Reglamento (Orga)" } })).status).toBe(200);
    const late = await client.put(`/api/cms/pages/${a.id}/draft`, { version: a.version, content: { ...a.published, title: "Reglamento (Admin)" } });
    expect(late.status).toBe(409);
    expect(late.json.error.message).toContain("ORGA guardó cambios");
    const now = await pageBySlug(client, "reglamentos");
    expect(now.draft.title).toBe("Reglamento (Orga)");
    expect((await client.post(`/api/cms/pages/${a.id}/publish`, { version: a.version, content: a.published })).status).toBe(409);
  });

  it("guardados en paralelo con la misma versión: sólo uno gana y el historial no registra el perdedor", async () => {
    const { client } = await loggedInAdmin();
    const org = await organizer();
    const p = await pageBySlug(client, "cancha-abierta");
    const [x, y] = await Promise.all([
      client.put(`/api/cms/pages/${p.id}/draft`, { version: p.version, content: { ...p.published, title: "A" } }),
      org.put(`/api/cms/pages/${p.id}/draft`, { version: p.version, content: { ...p.published, title: "B" } }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const revs = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_revisions WHERE entity = 'pagina' AND entity_id = ?").bind(p.id).first<{ n: number }>();
    expect(revs!.n).toBe(1);
  });

  it("los datos de la web también detectan cambios simultáneos", async () => {
    const { client } = await loggedInAdmin();
    const org = await organizer();
    const s1 = (await client.get("/api/site")).json.settings;
    const s2 = (await org.get("/api/site")).json.settings;
    expect((await client.put("/api/site", { ...s1, announcementText: "Aviso A" })).status).toBe(200);
    const late = await org.put("/api/site", { ...s2, announcementText: "Aviso B" });
    expect(late.status).toBe(409);
    expect((await client.get("/api/site")).json.settings.announcementText).toBe("Aviso A");
  });
});

describe("CMS · seguridad del contenido", () => {
  it("el texto enriquecido no permite HTML ni enlaces peligrosos", async () => {
    const { client } = await loggedInAdmin();
    const p = await pageBySlug(client, "liga");
    const evil = { ...p.published, blocks: [
      { type: "paragraph", text: "<script>alert(1)</script> [clic](javascript:alert(2)) [ok](https://padeltime.com.ar) <img src=x onerror=alert(3)>" },
      { type: "heading", text: "\"><svg onload=alert(4)>" },
    ] };
    expect((await client.post(`/api/cms/pages/${p.id}/publish`, { version: p.version, content: evil })).status).toBe(200);
    const html = (await pub("/liga")).html;
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<svg onload");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('<a href="https://padeltime.com.ar" target="_blank" rel="noopener">ok</a>');
    // Botones y enlaces con esquemas peligrosos se rechazan al validar.
    const p2 = await pageBySlug(client, "liga");
    for (const block of [{ type: "button", label: "x", url: "javascript:alert(1)" }, { type: "button", label: "x", url: "//evil.com" }, { type: "document", label: "x", url: "data:text/html,x" }]) {
      const r = await client.put(`/api/cms/pages/${p2.id}/draft`, { version: p2.version, content: { ...p2.published, blocks: [block] } });
      expect(r.status, JSON.stringify(block)).toBe(400);
    }
  });
});

describe("CMS · novedades", () => {
  it("se crean como borrador, se publican, se ocultan; sólo un admin las borra", async () => {
    const { client } = await loggedInAdmin();
    const org = await organizer();
    const created = await org.post("/api/cms/posts", { content: { title: "Abren inscripciones Open 1000", excerpt: "Hasta el viernes", blocks: [{ type: "paragraph", text: "Escribinos por WhatsApp." }] } });
    expect(created.status).toBe(201);
    const post = created.json.item;
    expect(post).toMatchObject({ status: "borrador", slug: "abren-inscripciones-open-1000" });
    expect((await pub("/")).html).not.toContain("Abren inscripciones");
    expect((await pub(`/novedades/${post.slug}`)).res.status).toBe(404);
    const p = await org.post(`/api/cms/posts/${post.id}/publish`, { version: post.version });
    expect(p.status).toBe(200);
    expect((await pub("/")).html).toContain("Abren inscripciones Open 1000");
    expect((await pub(`/novedades/${post.slug}`)).html).toContain("Escribinos por WhatsApp.");
    const hidden = await org.post(`/api/cms/posts/${post.id}/archive`, { version: p.json.item.version });
    expect(hidden.json.item.status).toBe("archivada");
    expect((await pub(`/novedades/${post.slug}`)).res.status).toBe(404);
    expect((await org.delete(`/api/cms/posts/${post.id}`)).status).toBe(403);
    expect((await client.delete(`/api/cms/posts/${post.id}`)).status).toBe(200);
    const dup = await org.post("/api/cms/posts", { content: { title: "Abren inscripciones Open 1000", blocks: [] } });
    const dup2 = await org.post("/api/cms/posts", { content: { title: "Abren inscripciones Open 1000", blocks: [] } });
    expect(dup2.json.item.slug).not.toBe(dup.json.item.slug);
  });
});

describe("CMS · multimedia", () => {
  it("valida formato, contenido real y tamaño; sin sesión no se puede subir", async () => {
    const { client } = await loggedInAdmin();
    expect((await upload(new Client(), PNG_1X1, "image/png", "a.png")).status).toBe(401);
    expect((await upload(client, new TextEncoder().encode("<svg onload=alert(1)>"), "image/svg+xml", "a.svg")).status).toBe(415);
    expect((await upload(client, new TextEncoder().encode("<html><script>alert(1)</script>"), "image/png", "falsa.png")).status).toBe(415);
    expect((await upload(client, new TextEncoder().encode("MZ executable"), "application/pdf", "virus.pdf")).status).toBe(415);
    expect((await upload(client, new Uint8Array(0), "image/png", "vacia.png")).status).toBe(400);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG_1X1.subarray(0, 8));
    expect((await upload(client, big, "image/png", "enorme.png")).status).toBe(413);
  });

  it("sube, evita duplicados, sirve el archivo aislado y sólo un admin borra archivos sin uso", async () => {
    const { client } = await loggedInAdmin();
    const org = await organizer();
    const hash = await sha(PNG_1X1);
    const first = await upload(org, PNG_1X1, "image/png", "Logo Club.png", { "x-sha256": hash, "x-width": "1", "x-height": "1" });
    expect(first.status).toBe(201);
    expect(first.json.item).toMatchObject({ kind: "imagen", filename: "Logo-Club.png", title: "Logo Club", width: 1 });
    const again = await upload(org, PNG_1X1, "image/png", "otra.png", { "x-sha256": hash });
    expect(again.json).toMatchObject({ duplicate: true, item: { id: first.json.item.id } });
    expect((await org.get(`/api/media/check?sha256=${hash}`)).json.item.id).toBe(first.json.item.id);

    const file = await rawFetch(first.json.item.url);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    expect(file.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG_1X1);

    // En uso (aunque sea en un borrador): no se puede borrar.
    const page = await pageBySlug(client, "liga");
    await client.put(`/api/cms/pages/${page.id}/draft`, { version: page.version, content: { ...page.published, blocks: [{ type: "image", mediaId: first.json.item.id, alt: "Logo" }] } });
    const lib = (await client.get("/api/media")).json.items as Json[];
    expect(lib.find((m) => m.id === first.json.item.id)!.usedIn).toEqual(["Página: Liga"]);
    expect((await org.delete(`/api/media/${first.json.item.id}`)).status).toBe(403);
    const blocked = await client.delete(`/api/media/${first.json.item.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.message).toContain("Página: Liga");
    // Sin uso: el admin lo borra y el archivo deja de servirse.
    const fresh = await pageBySlug(client, "liga");
    await client.post(`/api/cms/pages/${fresh.id}/discard`, { version: fresh.version });
    expect((await client.delete(`/api/media/${first.json.item.id}`)).status).toBe(200);
    expect((await rawFetch(first.json.item.url)).status).toBe(404);
    expect(await env.MEDIA.get(first.json.item.id)).toBeNull();
  });

  it("imágenes y PDF se muestran en las páginas publicadas", async () => {
    const { client } = await loggedInAdmin();
    const img = (await upload(client, PNG_1X1, "image/png", "cancha.png", { "x-width": "1", "x-height": "1" })).json.item;
    const pdf = (await upload(client, PDF, "application/pdf", "Reglamento 2026.pdf")).json.item;
    expect(pdf).toMatchObject({ kind: "documento", filename: "Reglamento-2026.pdf" });
    const page = await pageBySlug(client, "reglamentos");
    await client.post(`/api/cms/pages/${page.id}/publish`, { version: page.version, content: { ...page.published, blocks: [
      ...page.published.blocks,
      { type: "document", label: "Descargar el reglamento", mediaId: pdf.id },
      { type: "image", mediaId: img.id, alt: "La cancha", caption: "Sede" },
      { type: "gallery", mediaIds: [img.id] },
    ] } });
    const html = (await pub("/reglamentos")).html;
    expect(html).toContain(`href="/media/${pdf.id}/Reglamento-2026.pdf" download`);
    expect(html).toContain("Descargar el reglamento");
    expect(html).toContain(`<img src="/media/${img.id}/cancha.png" alt="La cancha"`);
    expect(html).toContain("<figcaption>Sede</figcaption>");
  });
});

describe("CMS · inicio, patrocinadores y calendario", () => {
  it("el orden y la visibilidad de los bloques del inicio se respetan en la web", async () => {
    const { client } = await loggedInAdmin();
    const home = await pageBySlug(client, "inicio");
    const blocks = home.published.blocks as Json[];
    expect(blocks[0]!.type).toBe("hero");
    const next = blocks.map((b) => (b.type === "section" && b.kind === "upcoming" ? { ...b, hidden: true } : b.type === "section" && b.kind === "venue" ? { ...b, title: "Nuestra sede" } : b));
    next[0] = { ...next[0], title: "Bienvenidos a Padel Time", buttons: [{ label: "Ver reglamento", url: "/reglamentos" }] };
    expect((await client.post(`/api/cms/pages/${home.id}/publish`, { version: home.version, content: { ...home.published, blocks: next } })).status).toBe(200);
    const html = (await pub("/")).html;
    expect(html).toContain("<h1>Bienvenidos a Padel Time</h1>");
    expect(html).toContain('href="/reglamentos">Ver reglamento</a>');
    expect(html).not.toContain("Próximos torneos</h2>");
    expect(html).toContain("Nuestra sede</h2>");
  });

  it("patrocinadores con logo de la biblioteca aparecen en el inicio", async () => {
    const { client } = await loggedInAdmin();
    const logo = (await upload(client, PNG_1X1, "image/png", "logo-sponsor.png")).json.item;
    expect((await client.post("/api/cms/sponsors", { name: "Paletas Pro", mediaId: "00000000-0000-0000-0000-000000000000", url: "https://ejemplo.com" })).status).toBe(400);
    expect((await client.post("/api/cms/sponsors", { name: "Paletas Pro", mediaId: logo.id, url: "javascript:x" })).status).toBe(400);
    expect((await client.post("/api/cms/sponsors", { name: "Paletas Pro", mediaId: logo.id, url: "https://ejemplo.com" })).status).toBe(201);
    const html = (await pub("/")).html;
    expect(html).toContain('href="https://ejemplo.com" target="_blank" rel="noopener sponsored"');
    expect(html).toContain(`src="/media/${logo.id}/logo-sponsor.png" alt="Paletas Pro"`);
    const s = (await client.get("/api/cms/sponsors")).json.items[0];
    expect((await client.put(`/api/cms/sponsors/${s.id}`, { name: "Paletas Pro 2", mediaId: logo.id, version: s.version })).status).toBe(200);
    expect((await client.put(`/api/cms/sponsors/${s.id}`, { name: "Otro", mediaId: logo.id, version: s.version })).status).toBe(409);
    expect((await client.delete(`/api/media/${logo.id}`)).status).toBe(409); // logo en uso
  });

  it("las canchas abiertas cargadas en el calendario aparecen en la web", async () => {
    const { client } = await loggedInAdmin();
    const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect((await client.post("/api/cms/events", { title: "Cancha abierta de evaluación", kind: "cancha_abierta", startsOn: date, startTime: "19:00", location: "Las Vías" })).status).toBe(201);
    expect((await client.post("/api/cms/events", { title: "Mal", kind: "evento", startsOn: date, endsOn: "2000-01-01" })).status).toBe(400);
    expect((await pub("/cancha-abierta")).html).toContain("Cancha abierta de evaluación");
    expect((await pub(`/calendario?mes=${date.slice(0, 7)}`)).html).toContain("Cancha abierta de evaluación");
    const ev = (await client.get("/api/cms/events")).json.items[0];
    expect((await client.put(`/api/cms/events/${ev.id}`, { ...ev, title: "Cancha abierta (cambio)", version: ev.version })).status).toBe(200);
    expect((await client.put(`/api/cms/events/${ev.id}`, { ...ev, version: ev.version })).status).toBe(409);
  });

  it("el aviso destacado respeta su fecha de vencimiento", async () => {
    const { client } = await loggedInAdmin();
    const s = (await client.get("/api/site")).json.settings;
    await client.put("/api/site", { ...s, announcementText: "Aviso vencido", announcementUntil: "2020-01-01" });
    expect((await pub("/")).html).not.toContain("Aviso vencido");
    const s2 = (await client.get("/api/site")).json.settings;
    await client.put("/api/site", { ...s2, announcementText: "Aviso vigente", announcementUntil: "2099-12-31" });
    expect((await pub("/")).html).toContain("Aviso vigente");
  });
});
