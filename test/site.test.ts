/**
 * Fase 7 · Web pública oficial: rutas sin sesión, privacidad, Damas oculta, torneos publicables,
 * contenidos reales, SEO, compatibilidad de enlaces y protección del panel.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Client, createUser, loggedInAdmin, rawFetch, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const get = async (path: string) => {
  const res = await rawFetch(path, { redirect: "manual" });
  return { res, html: await res.text() };
};

const PUBLIC_ROUTES = ["/", "/torneos", "/torneos?estado=en-curso", "/torneos?estado=finalizados", "/torneos?estado=historial", "/rankings",
  "/calendario", "/calendario?mes=2026-03", "/reglamentos", "/liga", "/cancha-abierta", "/premios", "/contacto", "/novedades"];

async function setup() {
  const { client } = await loggedInAdmin();
  const base = await seedBasics(client); // 4ta y 5ta Caballeros, 4ta Damas, Temporada 2026
  await client.patch(`/api/seasons/${base.season.id}/status`, { status: "activa" });
  const mk = async (firstName: string, lastName: string, gender = "M", categoryId = base.cab4.id, extra: Json = {}) =>
    (await client.post("/api/players", { firstName, lastName, gender, mainCategoryId: categoryId, ...extra })).json.item as Json;
  const tournament = async (over: Json = {}) => {
    const r = await client.post("/api/tournaments", {
      seasonId: base.season.id, name: "Open de Primavera", type: "largo", categoryId: base.cab4.id, divisionId: null,
      startDate: "2026-11-25", endDate: "2026-12-20", venue: "Las Vías", notes: "NOTA INTERNA SECRETA", ...over,
    });
    if (r.status !== 201) throw new Error(JSON.stringify(r.json));
    return r.json.item as Json;
  };
  return { client, ...base, mk, tournament };
}

describe("web pública · acceso libre", () => {
  it("todas las secciones responden sin sesión, indexables y con metadatos", async () => {
    await setup();
    for (const path of PUBLIC_ROUTES) {
      const { res, html } = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain("text/html");
      expect(res.headers.get("x-robots-tag"), path).toBeNull();
      // Fase 11: los meses del calendario distintos del actual son navegación (no se indexan, se siguen).
      if (path.includes("mes=")) expect(html, path).toContain('<meta name="robots" content="noindex, follow">');
      else expect(html, path).not.toMatch(/noindex/);
      expect(html, path).toMatch(/<title>[^<]+<\/title>/);
      expect(html, path).toMatch(/<meta name="description" content="[^"]{10,}">/);
      expect(html, path).toContain('<link rel="canonical" href="http://localhost/');
      expect(html, path).toContain('property="og:title"');
      expect(html, path).toContain('href="/admin"'); // acceso de organizadores en el pie
    }
  });

  it("páginas inexistentes devuelven 404 con el diseño de la web", async () => {
    await setup();
    for (const path of ["/no-existe", "/torneos/nada-999", "/novedades/nada", "/rankings/999/999"]) {
      const { res, html } = await get(path);
      expect(res.status, path).toBe(404);
      expect(html, path).toContain("PADEL <b>TIME</b>");
    }
  });

  it("robots.txt y sitemap.xml permiten indexar la web y excluyen el panel", async () => {
    const s = await setup();
    const t = await s.tournament({ publicVisible: true });
    const robots = await (await rawFetch("/robots.txt")).text();
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Sitemap: http://localhost/sitemap.xml");
    const sitemap = await get("/sitemap.xml");
    expect(sitemap.res.headers.get("content-type")).toContain("xml");
    expect(sitemap.html).toContain("<loc>http://localhost/reglamentos</loc>");
    expect(sitemap.html).toContain(`<loc>http://localhost/torneos/open-de-primavera-${t.id}</loc>`);
  });
});

describe("web pública · panel protegido y compatibilidad", () => {
  it("la API sigue exigiendo sesión y las direcciones viejas del panel redirigen a /admin", async () => {
    await setup();
    expect((await rawFetch("/api/players")).status).toBe(401);
    expect((await rawFetch("/api/site")).status).toBe(401);
    for (const [from, to] of [["/jugadores", "/admin/jugadores"], ["/jugadores/3", "/admin/jugadores/3"], ["/ingresar", "/admin/ingresar"],
      ["/temporadas", "/admin/temporadas"], ["/usuarios", "/admin/usuarios"], ["/torneos/7?tab=importar", "/admin/torneos/7?tab=importar"]] as const) {
      const res = await rawFetch(from, { redirect: "manual" });
      expect(res.status, from).toBe(301);
      expect(res.headers.get("location"), from).toBe(`http://localhost${to}`);
    }
  });

  it("los enlaces públicos anteriores (/publico) siguen funcionando, también incrustados en Google Sites", async () => {
    await setup();
    const idx = await get("/publico");
    expect(idx.res.status).toBe(200);
    const embed = await get("/publico?embed=1");
    expect(embed.res.headers.get("x-robots-tag")).toBe("noindex");
    expect(embed.res.headers.get("content-security-policy")).toContain("frame-ancestors 'self' https://sites.google.com");
    expect(embed.html).not.toContain('class="nav');
  });
});

describe("web pública · torneos", () => {
  it("un torneo no aparece hasta que se publica; publicado se ve en inicio, torneos, calendario y su página", async () => {
    const s = await setup();
    const t = await s.tournament();
    expect((await get("/torneos")).html).not.toContain("Open de Primavera");
    expect((await get(`/torneos/open-de-primavera-${t.id}`)).res.status).toBe(404);

    await s.client.put(`/api/tournaments/${t.id}`, { ...t, publicVisible: true, series: "open_1000", registrationOpen: true, prizeInfo: "Paletas para los campeones", publicDescription: "Martes desde las 21 h." });
    const home = await get("/");
    expect(home.html).toContain("Open de Primavera");
    expect(home.html).toContain(`href="/torneos/open-de-primavera-${t.id}"`);
    expect((await get("/torneos")).html).toContain("Open de Primavera");
    expect((await get("/torneos?modalidad=open-1000")).html).toContain("Open de Primavera");
    expect((await get("/torneos?modalidad=satelite-100")).html).not.toContain("Open de Primavera");
    expect((await get("/calendario?mes=2026-11")).html).toContain("Open de Primavera");
    expect((await get("/premios")).html).toContain("Paletas para los campeones");

    const page = await get(`/torneos/open-de-primavera-${t.id}`);
    expect(page.res.status).toBe(200);
    expect(page.html).toContain("Martes desde las 21 h.");
    expect(page.html).toContain("https://wa.me/5491124065574?text=");
    expect(page.html).toContain('"@type":"SportsEvent"');
    expect(page.html).not.toContain("NOTA INTERNA SECRETA");
    // Una dirección con el texto viejo o incompleto redirige a la canónica.
    const old = await get(`/torneos/primavera-${t.id}`);
    expect(old.res.status).toBe(301);
    expect(old.res.headers.get("location")).toBe(`/torneos/open-de-primavera-${t.id}`);
  });

  it("muestra el resultado final acreditado con nombres, sin datos privados", async () => {
    const s = await setup();
    const a = await s.mk("Nicolás", "Salas", "M", s.cab4.id, { documentNumber: "30111222", phone: "1144445555", email: "privado@ejemplo.com", notes: "nota privada" });
    const b = await s.mk("Milton", "Ahumada");
    const t = await s.tournament({ publicVisible: true, startDate: "2026-04-01", endDate: "2026-04-30" });
    await s.client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
    const team = (await s.client.post(`/api/tournaments/${t.id}/teams`, { player1Id: a.id, player2Id: b.id })).json.items[0];
    const enCurso = await get(`/torneos/open-de-primavera-${t.id}`);
    expect(enCurso.html).toContain("Parejas inscriptas (1)");
    expect(enCurso.html).toContain("Nicolás Salas / Milton Ahumada");
    const sc = (await s.client.get(`/api/tournaments/${t.id}/scoring`)).json.item;
    await s.client.put(`/api/tournaments/${t.id}/results`, { results: [{ teamId: team.id, stageId: sc.stages[0].id, matchesPlayed: 0, matchesWon: 0 }] });
    const preview = (await s.client.get(`/api/tournaments/${t.id}/preview`)).json;
    expect((await s.client.post(`/api/tournaments/${t.id}/credits`, { previewHash: preview.previewHash })).status).toBe(201);
    const page = await get(`/torneos/open-de-primavera-${t.id}`);
    expect(page.html).toContain("Resultado final");
    expect(page.html).toContain("Campeón");
    expect(page.html).toMatch(/>\s*100\s*</);
    for (const secret of ["30111222", "1144445555", "privado@ejemplo.com", "nota privada"]) expect(page.html).not.toContain(secret);
    expect((await get("/torneos?estado=finalizados")).html).toContain("Open de Primavera");
  });

  it("escapa nombres con HTML y oculta los cancelados de próximos", async () => {
    const s = await setup();
    const t = await s.tournament({ name: "<script>alert(1)</script> Copa", publicVisible: true });
    const list = await get("/torneos");
    expect(list.html).not.toContain("<script>alert(1)</script>");
    expect(list.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Copa");
    await s.client.patch(`/api/tournaments/${t.id}/status`, { status: "cancelado" });
    expect((await get("/torneos")).html).not.toContain("Copa");
    expect((await get("/torneos?estado=historial")).html).toContain("Cancelado");
  });
});

describe("web pública · Damas discontinuada", () => {
  it("no muestra torneos, rankings ni jugadores de Damas, pero conserva sus datos; reactivarla los vuelve a mostrar", async () => {
    const s = await setup();
    const ana = await s.mk("Ana", "Pérez", "F", s.dam4.id);
    const t = await s.tournament({ name: "Americano Damas", type: "americano", categoryId: s.dam4.id, startDate: "2026-12-01", publicVisible: true });
    await s.client.post("/api/movements/adjustments", { playerId: ana.id, seasonId: s.season.id, points: 50, reason: "Histórico" });

    expect((await get("/torneos")).html).not.toContain("Americano Damas");
    expect((await get(`/torneos/americano-damas-${t.id}`)).res.status).toBe(404);
    expect((await get("/rankings")).html).not.toContain("Damas");
    expect((await get(`/rankings/${s.season.id}/${s.dam4.id}`)).res.status).toBe(404);
    expect((await get(`/publico/ranking/${s.season.id}/${s.dam4.id}`)).res.status).toBe(404);
    expect((await get("/rankings/jugadores?q=perez")).html).not.toContain("Ana");
    expect((await get(`/rankings/jugador/${ana.code}`)).res.status).toBe(404);
    // Los datos siguen intactos y visibles en el panel.
    expect((await s.client.get(`/api/rankings?seasonId=${s.season.id}&categoryId=${s.dam4.id}`)).json.rows[0].points).toBe(50);

    const site = (await s.client.get("/api/site")).json.settings;
    expect(site.activeGenders).toEqual(["M"]);
    expect((await s.client.put("/api/site", { ...site, activeGenders: ["M", "F"] })).status).toBe(200);
    expect((await get(`/rankings/${s.season.id}/${s.dam4.id}`)).res.status).toBe(200);
    expect((await get("/torneos")).html).toContain("Americano Damas");
  });
});

describe("web pública · contenidos y datos configurables", () => {
  it("reglamentos, liga, cancha abierta y premios muestran el contenido publicado en la web oficial (sin Damas)", async () => {
    await setup();
    const reg = (await get("/reglamentos")).html;
    for (const text of ["Jornadas de evaluación y emparejamiento", "Open 1000", "Challenger 500", "Satélite 100", "Master Final 2000",
      "Caballeros: siempre desde 21:00 en adelante. Lunes C8, Martes C5, Miércoles C7, Jueves C6."]) expect(reg).toContain(text);
    expect(reg).not.toContain("Damas:");
    expect(reg).toContain("data-print");
    const liga = (await get("/liga")).html;
    expect(liga).toContain("Satélites (americanos), se definen en el día y te permiten sumar (menos que los largos).");
    expect((await get("/cancha-abierta")).html).toContain("haber sido evaluado por nuestros veedores");
    expect((await get("/premios")).html).toContain("la entrega de premios");
    const inicio = (await get("/")).html;
    expect(inicio).toContain("¿De qué se trata el circuito Padel Time?");
    expect(inicio).toContain("Sin novedades publicadas");
  });

  it("contacto y avisos los edita un organizador; las ramas activas sólo un administrador; se reflejan al instante", async () => {
    const s = await setup();
    await createUser("orga", "clave-segura-456", "organizador");
    const org = new Client();
    await org.login("orga", "clave-segura-456");
    const site = (await org.get("/api/site")).json.settings;
    expect(site).toMatchObject({ whatsapp: "5491124065574", instagram: "padeltimeok", venueName: "Las Vías Padel Center" });
    expect((await org.put("/api/site", { ...site, activeGenders: ["M", "F"] })).status).toBe(403);
    expect((await s.client.put("/api/site", { ...site, announcementUrl: "javascript:alert(1)" })).status).toBe(400);
    const ok = await org.put("/api/site", { ...site, announcementText: "Próximo torneo: Portugal P2 360", announcementUrl: "/torneos", whatsapp: "+54 9 11 2222-3333" });
    expect(ok.status).toBe(200);
    expect(ok.json.settings.whatsapp).toBe("5491122223333");
    const home = (await get("/")).html;
    expect(home).toContain("Próximo torneo: Portugal P2 360");
    expect(home).toContain("https://wa.me/5491122223333");
  });

  it("las novedades publicadas aparecen en inicio; los borradores no", async () => {
    await setup();
    await env.DB.prepare("INSERT INTO site_posts (slug, title, excerpt, status, published_at) VALUES ('abierta', 'Inscripción abierta', 'Ya podés anotarte', 'publicada', '2026-01-01T00:00:00Z'), ('borrador', 'Texto en borrador', NULL, 'borrador', NULL)").run();
    const home = (await get("/")).html;
    expect(home).toContain("Inscripción abierta");
    expect(home).not.toContain("Texto en borrador");
    expect((await get("/novedades/abierta")).res.status).toBe(200);
    expect((await get("/novedades/borrador")).res.status).toBe(404);
  });
});
