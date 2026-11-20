import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { strFromU8, unzipSync } from "fflate";
import { Client, loggedInAdmin, rawFetch, seedBasics } from "./helpers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function scenario() {
  const { client } = await loggedInAdmin();
  const base = await seedBasics(client);
  await client.patch(`/api/seasons/${base.season.id}/status`, { status: "activa" });
  const mk = async (firstName: string, lastName: string, extra: Json = {}) =>
    (await client.post("/api/players", { firstName, lastName, gender: "M", mainCategoryId: base.cab4.id, ...extra })).json.item as Json;
  const a = await mk("Nicolás", "Salas", { documentNumber: "30111222", phone: "351555000", email: "nico@example.com", notes: "nota privada" });
  const b = await mk("Milton", "Ahumada");
  const c = await mk("Leo", "Mosquera", { nickname: "Leíto" });
  const d = await mk("Timo", "Mosquera");
  const t = (await client.post("/api/tournaments", { seasonId: base.season.id, name: "Torneo Apertura", type: "largo", categoryId: base.cab4.id, startDate: "2026-03-01", endDate: "2026-03-30" })).json.item;
  await client.patch(`/api/tournaments/${t.id}/status`, { status: "en_curso" });
  const ab = (await client.post(`/api/tournaments/${t.id}/teams`, { player1Id: a.id, player2Id: b.id })).json.items as Json[];
  const cd = (await client.post(`/api/tournaments/${t.id}/teams`, { player1Id: c.id, player2Id: d.id })).json.items as Json[];
  const scoring = (await client.get(`/api/tournaments/${t.id}/scoring`)).json.item;
  const stage = (label: string) => scoring.stages.find((s: Json) => s.label === label).id;
  const teamOf = (list: Json[], pid: number) => list.find((x) => x.players.some((p: Json) => p.id === pid))!.id;
  await client.put(`/api/tournaments/${t.id}/results`, {
    results: [
      { teamId: teamOf(ab, a.id), stageId: stage("Campeón"), matchesPlayed: 3, matchesWon: 3 },
      { teamId: teamOf(cd, c.id), stageId: stage("Finalista"), matchesPlayed: 3, matchesWon: 2 },
    ],
  });
  return { client, ...base, a, b, c, d, t };
}

async function credit(client: Client, tid: number) {
  const preview = (await client.get(`/api/tournaments/${tid}/preview`)).json;
  const r = await client.post(`/api/tournaments/${tid}/credits`, { previewHash: preview.previewHash });
  if (r.status !== 201) throw new Error(JSON.stringify(r.json));
  return r.json;
}

const page = async (path: string, headers: Record<string, string> = {}) => {
  const res = await rawFetch(path, { headers });
  return { res, html: await res.text() };
};

describe("páginas públicas de rankings", () => {
  it("muestran el ranking sin sesión y sin datos privados", async () => {
    const s = await scenario();
    await credit(s.client, s.t.id);
    const { res, html } = await page(`/publico/ranking/${s.season.id}/${s.cab4.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(html).toContain("Ranking 4ta Caballeros");
    expect(html).toContain("Salas, Nicolás");
    expect(html).toContain("Mosquera, Leo");
    // Campeones (100 pts, empatados) antes que los finalistas.
    expect(html.indexOf("Salas, Nicolás")).toBeLessThan(html.indexOf("Mosquera, Leo"));
    expect(html.indexOf("Ahumada, Milton")).toBeLessThan(html.indexOf("Mosquera, Timo"));
    // Nada privado.
    for (const secret of ["30111222", "351555000", "nico@example.com", "nota privada"]) expect(html).not.toContain(secret);
    // No toca la API administrativa ni requiere cookie.
    expect(html).not.toContain("/api/");
  });

  it("permiten incrustarse en Google Sites y en el dominio propio (frame-ancestors), sin X-Frame-Options", async () => {
    const s = await scenario();
    await credit(s.client, s.t.id);
    const { res } = await page(`/publico/ranking/${s.season.id}/${s.cab4.id}?embed=1`);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-ancestors 'self' https://sites.google.com https://*.googleusercontent.com https://www.padeltime.com.ar");
    expect(csp).toContain("script-src 'self'");
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    // La app administrativa sigue sin poder incrustarse.
    const api = await rawFetch("/api/health");
    expect(api.headers.get("x-frame-options")).toBe("DENY");
  });

  it("el modo incrustado oculta la navegación y conserva el parámetro en los enlaces", async () => {
    const s = await scenario();
    await credit(s.client, s.t.id);
    const { html } = await page(`/publico/ranking/${s.season.id}/${s.cab4.id}?embed=1`);
    expect(html).toContain('class="embed"');
    expect(html).not.toContain('class="top"');
    expect(html).toContain(`/publico/jugador/${s.a.code}?embed=1`);
    expect(html).toMatch(/target="_blank"[^>]*>Ver en Padel Time/);
  });

  it("se actualizan automáticamente al acreditar y al revertir (caché versionada + ETag)", async () => {
    const s = await scenario();
    const path = `/publico/ranking/actual/${s.cab4.id}`;
    const before = await page(path);
    expect(before.html).toContain("Todavía no hay puntos");
    const etag1 = before.res.headers.get("etag")!;
    // Mientras no cambia nada, el navegador recibe 304.
    expect((await rawFetch(path, { headers: { "if-none-match": etag1 } })).status).toBe(304);

    await credit(s.client, s.t.id);
    const after = await page(path);
    expect(after.res.headers.get("etag")).not.toBe(etag1);
    expect(after.html).toContain("Salas, Nicolás");
    expect(after.html).toMatch(/>100</);
    expect((await rawFetch(path, { headers: { "if-none-match": etag1 } })).status).toBe(200);

    const rev = await s.client.post(`/api/tournaments/${s.t.id}/credits/revert`, { reason: "Error de carga" });
    expect(rev.status).toBe(200);
    const reverted = await page(path);
    expect(reverted.html).not.toContain("Salas, Nicolás");
  });

  it("también se actualizan al importar saldos iniciales y al renombrar un jugador", async () => {
    const s = await scenario();
    const imp = await s.client.post("/api/ranking-imports", {
      fileName: "r.csv", fileHash: "c".repeat(64), rows: [
        { rowNumber: 2, sourceName: "SALAS NICOLAS", playerId: s.a.id, seasonId: s.season.id, categoryId: s.cab4.id, points: 77 },
      ],
    });
    expect(imp.status).toBe(201);
    const path = `/publico/ranking/${s.season.id}/${s.cab4.id}`;
    expect((await page(path)).html).toContain(">77<");
    await s.client.put(`/api/players/${s.a.id}`, { firstName: "Nico", lastName: "Salas", gender: "M", mainCategoryId: s.cab4.id });
    expect((await page(path)).html).toContain("Salas, Nico<");
  });

  it("índice, otras categorías y temporada 'actual'", async () => {
    const s = await scenario();
    await credit(s.client, s.t.id);
    const idx = await page("/publico");
    expect(idx.res.status).toBe(200);
    expect(idx.html).toContain("Temporada 2026");
    expect(idx.html).toContain(`/publico/ranking/${s.season.id}/${s.cab4.id}`);
    const actual = await page(`/publico/ranking/actual/${s.cab4.id}`);
    expect(actual.html).toContain("Salas, Nicolás");
  });

  it("descarga Excel y CSV del ranking (alternativa a incrustar)", async () => {
    const s = await scenario();
    await credit(s.client, s.t.id);
    const x = await rawFetch(`/publico/ranking/${s.season.id}/${s.cab4.id}?descargar=xlsx`);
    expect(x.status).toBe(200);
    expect(x.headers.get("content-disposition")).toMatch(/attachment; filename="ranking-4ta-caballeros-temporada-2026\.xlsx"/);
    const files = unzipSync(new Uint8Array(await x.arrayBuffer()));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("Salas");
    expect(sheet).toContain("Saldo inicial");
    const c = await rawFetch(`/publico/ranking/${s.season.id}/${s.cab4.id}?descargar=csv`);
    const csv = await c.text();
    expect(csv).toContain("Posición;Jugador");
    expect(csv).toContain("Salas, Nicolás");
    expect(csv).not.toContain("30111222");
  });

  it("buscador e historial de jugador: sólo por nombre, nunca por documento", async () => {
    const s = await scenario();
    await credit(s.client, s.t.id);
    const found = await page("/publico/jugadores?q=mosquera");
    expect(found.html).toContain("Mosquera, Leo");
    expect(found.html).toContain("Mosquera, Timo");
    expect(found.html).not.toContain("Salas");
    const byNick = await page("/publico/jugadores?q=leito");
    expect(byNick.html).toContain("Mosquera, Leo");
    const byDoc = await page("/publico/jugadores?q=30111222");
    expect(byDoc.html).not.toContain("Salas");

    const p = await page(`/publico/jugador/${s.a.code}`);
    expect(p.res.status).toBe(200);
    expect(p.html).toContain("Nicolás Salas");
    expect(p.html).toContain("Torneo Apertura");
    expect(p.html).toContain("con Milton Ahumada");
    expect(p.html).toMatch(/<b>1=?°<\/b> de 4/);
    for (const secret of ["30111222", "351555000", "nico@example.com", "nota privada"]) expect(p.html).not.toContain(secret);
  });

  it("el historial no expone motivos de ajustes y muestra el saldo inicial", async () => {
    const s = await scenario();
    await s.client.post("/api/movements/adjustments", { playerId: s.a.id, seasonId: s.season.id, points: -5, reason: "Sanción por conducta (interno)" });
    await s.client.post("/api/ranking-imports", { fileName: "r.csv", fileHash: "d".repeat(64), rows: [{ rowNumber: 2, sourceName: "SALAS", playerId: s.a.id, seasonId: s.season.id, categoryId: s.cab4.id, points: 40 }] });
    const p = await page(`/publico/jugador/${s.a.code}`);
    expect(p.html).toContain("Saldo inicial importado");
    expect(p.html).toContain("Ajuste de puntos");
    expect(p.html).not.toContain("Sanción por conducta");
    expect(p.html).toContain("35 pts");
  });

  it("respetan la configuración: publicación desactivada, historial oculto y temporadas ocultas", async () => {
    const s = await scenario();
    await credit(s.client, s.t.id);
    const path = `/publico/ranking/${s.season.id}/${s.cab4.id}`;
    const off = await s.client.put("/api/publication/settings", { enabled: false, showHistory: true, title: "Padel Time", hiddenSeasonIds: [] });
    expect(off.status).toBe(200);
    const disabled = await page(path);
    expect(disabled.res.status).toBe(404);
    expect(disabled.html).toContain("no disponible");

    await s.client.put("/api/publication/settings", { enabled: true, showHistory: false, title: "Rankings Padel Time", hiddenSeasonIds: [] });
    const r = await page(path);
    expect(r.html).toContain("Rankings Padel Time");
    expect(r.html).not.toContain("/publico/jugador/");
    expect((await page(`/publico/jugador/${s.a.code}`)).res.status).toBe(404);

    await s.client.put("/api/publication/settings", { enabled: true, showHistory: true, title: "Padel Time", hiddenSeasonIds: [s.season.id] });
    expect((await page(path)).res.status).toBe(404);
    expect((await page("/publico")).html).not.toContain(path);
  });

  it("escapan el HTML de los nombres", async () => {
    const s = await scenario();
    const evil = (await env.DB.prepare("INSERT INTO players (first_name, last_name, gender, main_category_id, search_text) VALUES ('<script>alert(1)</script>', 'X\"><img src=x>', 'M', ?, 'x') RETURNING id").bind(s.cab4.id).first<{ id: number }>())!;
    const ri = await s.client.post("/api/ranking-imports", { fileName: "r.csv", fileHash: "e".repeat(64), rows: [{ rowNumber: 2, sourceName: "x", playerId: evil.id, seasonId: s.season.id, categoryId: s.cab4.id, points: 3 }] });
    expect(ri.status, JSON.stringify(ri.json)).toBe(201);
    const { html } = await page(`/publico/ranking/${s.season.id}/${s.cab4.id}`);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain('"><img');
    expect(html).toContain("&lt;script&gt;");
  });

  it("devuelven 404 amigable para rankings inexistentes y no exponen la API", async () => {
    await scenario();
    expect((await page("/publico/ranking/999/999")).res.status).toBe(404);
    expect((await page("/publico/jugador/J-99999")).res.status).toBe(404);
    expect((await page("/publico/jugador/abc")).res.status).toBe(404);
    expect((await page("/publico/cualquier-cosa")).res.status).toBe(404);
  });

  it("el panel de publicación lista los enlaces y sólo un admin cambia la configuración", async () => {
    const s = await scenario();
    await credit(s.client, s.t.id);
    const o = (await s.client.get("/api/publication")).json;
    expect(o.settings).toMatchObject({ enabled: true, showHistory: true, title: "Padel Time" });
    expect(o.links).toEqual([expect.objectContaining({ seasonId: s.season.id, categoryId: s.cab4.id, players: 4, path: `/publico/ranking/${s.season.id}/${s.cab4.id}` })]);
    await s.client.post("/api/users", { username: "orga", displayName: "Orga", password: "clave-segura-456", role: "organizador" });
    const orga = new Client();
    await orga.login("orga", "clave-segura-456");
    expect((await orga.get("/api/publication")).status).toBe(200);
    expect((await orga.put("/api/publication/settings", { enabled: false, showHistory: true, title: "x", hiddenSeasonIds: [] })).status).toBe(403);
  });
});
