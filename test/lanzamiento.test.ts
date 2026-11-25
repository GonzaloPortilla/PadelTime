/**
 * Fase 11 · Preparación del lanzamiento: redirecciones de la web anterior, archivos históricos de resultados,
 * SEO (robots, sitemap, títulos, descripciones, canonical, noindex del panel), rastreo de enlaces internos,
 * privacidad de datos personales, Damas fuera de la web y entorno de prueba.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { publicApp } from "../worker/public/app";
import { Client, createUser, loggedInAdmin, ORIGIN, rawFetch } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PNG_1X1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const PRIVATE = { email: "privado.jugador@example.com", phone: "11-5555-0101", doc: "30111222", notes: "nota interna confidencial" };

async function upload(c: Client, body: Uint8Array, type: string, name: string) {
  const res = await rawFetch("/api/media", { method: "POST", headers: { origin: ORIGIN, cookie: c.cookie, "content-type": type, "x-file-name": encodeURIComponent(name) }, body });
  return (await res.json()) as Json;
}

/** Datos públicos de demostración: torneo largo con dos categorías, ranking acreditado, Damas histórica. */
async function demoSite() {
  const { client } = await loggedInAdmin();
  const c5 = (await client.post("/api/categories", { name: "C5", gender: "M", level: 5 })).json.item;
  const c6 = (await client.post("/api/categories", { name: "C6", gender: "M", level: 6 })).json.item;
  const d6 = (await client.post("/api/categories", { name: "D6", gender: "F", level: 6 })).json.item;
  const season = (await client.post("/api/seasons", { name: "Temporada 2026", year: 2026, startDate: "2026-01-01", endDate: "2026-12-31" })).json.item;
  await client.patch(`/api/seasons/${season.id}/status`, { status: "activa" });
  const ev = (await client.post("/api/events", { seasonId: season.id, name: "Paris Major 2000", startDate: "2026-03-01", endDate: "2026-04-30", publicVisible: true, competitions: [{ categoryId: c5.id }, { categoryId: c6.id }] })).json.item;
  const t5 = ev.tournaments[0];
  const players: Json[] = [];
  for (let i = 0; i < 2; i++) {
    players.push((await client.post("/api/players", { firstName: `Ana${i}`, lastName: "Pública", gender: "M", mainCategoryId: c5.id, email: i === 0 ? PRIVATE.email : null, phone: i === 0 ? PRIVATE.phone : null, documentNumber: i === 0 ? PRIVATE.doc : null, notes: PRIVATE.notes })).json.item);
  }
  const team = ((await client.post(`/api/tournaments/${t5.id}/teams`, { player1Id: players[0]!.id, player2Id: players[1]!.id })).json.items as Json[])[0]!;
  const stages = (await client.get(`/api/tournaments/${t5.id}/scoring`)).json.item.stages as Json[];
  await client.put(`/api/tournaments/${t5.id}/results`, { results: [{ teamId: team.id, stageId: stages[0]!.id }] });
  await client.patch(`/api/tournaments/${t5.id}/status`, { status: "en_curso" });
  const p = (await client.get(`/api/tournaments/${t5.id}/preview`)).json;
  expect((await client.post(`/api/tournaments/${t5.id}/credits`, { previewHash: p.previewHash })).status).toBe(201);
  // Damas: dato histórico, publicado por error, que la web no debe mostrar.
  const damas = (await client.post("/api/tournaments", { seasonId: season.id, name: "Damas Histórico", type: "americano", categoryId: d6.id, startDate: "2026-02-01", publicVisible: true })).json.item;
  return { client, season, c5, c6, d6, ev, t5, damas, players };
}

async function get(path: string) {
  const res = await rawFetch(path, { redirect: "manual" });
  return { res, status: res.status, html: await res.text(), location: res.headers.get("location") };
}

describe("redirecciones desde la web anterior (Google Sites)", () => {
  it("las direcciones viejas llevan con 301 a su equivalente; las nuevas no se tocan", async () => {
    const home = await get("/p%C3%A1gina-principal");
    expect(home.status).toBe(301);
    expect(home.location).toBe("/");
    expect((await get("/qatar-major-2000/c5/fixture")).location).toBe("/torneos?estado=historial");
    expect((await get("/qatar-major-2000/d6/fixture")).location).toBe("/torneos?estado=historial"); // Damas: sin página propia
    expect((await get("/rankings-2025/c6/")).location).toBe("/rankings");
    expect((await get("/sat%C3%A9lites-1000-2025/lisboa")).location).toBe("/torneos?estado=historial");
    expect((await get("/calendario-2026")).location).toBe("/calendario");
    expect((await get("/reglamentos")).status).toBe(200); // misma dirección en la web nueva
    expect((await get("/no-existe-nunca")).status).toBe(404);
    expect((await get("/qatar-major-20000")).status).toBe(404); // el prefijo exige separador "/"
  });

  it("un administrador las edita (p. ej. hacia el torneo ya cargado); un organizador no", async () => {
    const { client, t5 } = await demoSite();
    const list = (await client.get("/api/redirects")).json.items as Json[];
    expect(list.length).toBe(15);
    const paris = list.find((r) => r.fromPath === "/paris-major-2000")!;
    const target = `/torneos/paris-major-2000-${t5.id}`;
    expect((await client.put(`/api/redirects/${paris.id}`, { fromPath: "/paris-major-2000", toPath: target, prefix: true })).status).toBe(200);
    expect((await get("/paris-major-2000/c5/tabla")).location).toBe(target);
    // Destinos externos o rutas internas del sistema: rechazados (no se puede usar como redirección abierta).
    expect((await client.post("/api/redirects", { fromPath: "/x", toPath: "https://otro-sitio.com" })).status).toBe(400);
    expect((await client.post("/api/redirects", { fromPath: "/x", toPath: "//otro-sitio.com" })).status).toBe(400);
    expect((await client.post("/api/redirects", { fromPath: "/admin", toPath: "/" })).status).toBe(400);
    expect((await client.post("/api/redirects", { fromPath: "/Paris-Major-2000/", toPath: "/" })).status).toBe(409); // ya existe (se normaliza)
    await createUser("orga", "clave-segura-456", "organizador");
    const org = new Client();
    await org.login("orga", "clave-segura-456");
    expect((await org.get("/api/redirects")).status).toBe(200);
    expect((await org.post("/api/redirects", { fromPath: "/y", toPath: "/" })).status).toBe(403);
  });
});

describe("archivos históricos de resultados", () => {
  it("se adjunta la imagen de un cuadro a una categoría y se muestra en su página, sin inventar datos", async () => {
    const { client, t5 } = await demoSite();
    const img = await upload(client, PNG_1X1, "image/png", "cuadro-c5.png");
    expect(img.item.id).toBeTruthy();
    const bad = await client.put(`/api/tournaments/${t5.id}/files`, { files: [{ mediaId: "00000000-0000-0000-0000-000000000000", label: "X" }] });
    expect(bad.status).toBe(400);
    const ok = await client.put(`/api/tournaments/${t5.id}/files`, { files: [{ mediaId: img.item.id, label: "Copa de Oro" }] });
    expect(ok.status).toBe(200);
    expect(ok.json.item.resultFiles).toEqual([{ mediaId: img.item.id, label: "Copa de Oro" }]);
    const page = await get(`/torneos/paris-major-2000-${t5.id}`);
    expect(page.html).toContain("Resultados (archivo)");
    expect(page.html).toContain(`/media/${img.item.id}/`);
    expect(page.html).toContain("Copa de Oro");
    // Un archivo en uso no se puede borrar y figura dónde se usa.
    const lib = (await client.get("/api/media")).json.items as Json[];
    expect(lib.find((m) => m.id === img.item.id)!.usedIn).toEqual(["Torneo: Paris Major 2000 (C5)"]);
    expect((await client.delete(`/api/media/${img.item.id}`)).status).toBe(409);
    // No genera movimientos de puntos.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM point_movements WHERE tournament_id = ? AND kind <> 'acreditacion'").bind(t5.id).first("n")).toBe(0);
  });
});

describe("SEO e indexación", () => {
  it("robots.txt, sitemap, títulos, descripciones y canonical en las páginas públicas", async () => {
    const { t5, c5, season } = await demoSite();
    const robots = await get("/robots.txt");
    expect(robots.html).toContain("Disallow: /admin");
    expect(robots.html).toContain("Disallow: /api/");
    expect(robots.html).toMatch(/Sitemap: http:\/\/localhost\/sitemap\.xml/);
    const sitemap = (await get("/sitemap.xml")).html;
    for (const path of ["/", "/torneos", "/rankings", "/calendario", "/reglamentos", "/contacto", `/torneos/paris-major-2000-${t5.id}`, `/rankings/${season.id}/${c5.id}`]) {
      expect(sitemap).toContain(`<loc>http://localhost${path}</loc>`);
    }
    expect(sitemap).not.toContain("/admin");
    expect(sitemap).not.toContain("damas-historico");
    for (const path of ["/", "/torneos", "/rankings", "/calendario", "/reglamentos", "/liga", "/contacto", "/novedades", `/torneos/paris-major-2000-${t5.id}`]) {
      const { status, html, res } = await get(path);
      expect(status, path).toBe(200);
      expect(html, path).toMatch(/<title>[^<]{5,}<\/title>/);
      expect(html, path).toMatch(/<meta name="description" content="[^"]{20,}"/);
      expect(html, path).toMatch(/<link rel="canonical" href="http:\/\/localhost\//);
      expect(html, path).not.toContain('content="noindex');
      expect(res.headers.get("x-robots-tag"), path).toBeNull();
      expect(html, path).toContain('lang="es-AR"');
    }
  });

  it("la API no se indexa ni entrega datos sin sesión (el panel se verifica en la prueba de navegador)", async () => {
    const api = await rawFetch("/api/health");
    expect(api.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await rawFetch("/api/players")).status).toBe(401); // sin sesión, ningún dato
  });
});

describe("rastreo de enlaces internos y privacidad", () => {
  it("todos los enlaces internos de la web responden, y ninguna página expone datos personales ni Damas", async () => {
    const { t5, damas } = await demoSite();
    const seen = new Map<string, number>();
    const queue = ["/"];
    const pages: string[] = [];
    while (queue.length && seen.size < 120) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      const { status, html, location } = await get(path);
      seen.set(path, status);
      if (status === 301 && location) { queue.push(location); continue; }
      pages.push(html);
      for (const m of html.matchAll(/href="(\/[^"#]*)"/g)) {
        const href = m[1]!.replace(/&amp;/g, "&");
        if (/^\/(admin|media|pub|brand|web|assets)(\/|$)|\.(css|js|png|svg|webmanifest|ico|xml|txt)$/.test(href)) continue;
        if (/[?&](formato|format)=/.test(href)) continue; // descargas CSV / Excel
        if (!seen.has(href)) queue.push(href);
      }
    }
    const broken = [...seen].filter(([, s]) => s !== 200 && s !== 301);
    expect(broken).toEqual([]);
    expect(seen.size).toBeGreaterThan(20);
    expect(seen.has(`/torneos/paris-major-2000-${t5.id}`)).toBe(true);
    const all = pages.join("\n");
    for (const secret of Object.values(PRIVATE)) expect(all).not.toContain(secret);
    expect(all).not.toContain("Damas Histórico");
    expect(all).not.toContain(`-${damas.id}"`);
    // Damas tampoco responde por dirección directa.
    expect((await get(`/torneos/damas-historico-${damas.id}`)).status).toBe(404);
  });
});

describe("entorno de prueba", () => {
  it("con ENVIRONMENT = prueba la web muestra la franja, no se indexa y robots.txt bloquea todo", async () => {
    const testEnv = { ...env, ENVIRONMENT: "prueba" } as Env;
    const home = await publicApp.fetch(new Request("http://localhost/"), testEnv, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    const html = await home.text();
    expect(home.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(html).toContain("Entorno de prueba · Datos de demostración");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    const robots = await publicApp.fetch(new Request("http://localhost/robots.txt"), testEnv, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
    // Producción, sin cambios.
    const prod = await get("/");
    expect(prod.html).not.toContain("Entorno de prueba");
  });
});
