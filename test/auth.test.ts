import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Client, createUser, loggedInAdmin, ORIGIN, rawFetch } from "./helpers";
import { hashPassword, verifyPassword, parseHash } from "../worker/lib/password";

describe("hash de contraseñas", () => {
  it("genera hashes con sal distinta y los verifica", async () => {
    const a = await hashPassword("una-clave-larga", 1000);
    const b = await hashPassword("una-clave-larga", 1000);
    expect(a).not.toBe(b);
    expect(a.startsWith("pbkdf2-sha256$1000$")).toBe(true);
    expect((await verifyPassword("una-clave-larga", a)).valid).toBe(true);
    expect((await verifyPassword("otra-clave", a)).valid).toBe(false);
  });

  it("rechaza hashes malformados sin lanzar", async () => {
    expect(parseHash("basura")).toBeNull();
    expect((await verifyPassword("x", "pbkdf2-sha256$abc$$")).valid).toBe(false);
  });

  it("funciona con las iteraciones de producción", async () => {
    const h = await hashPassword("clave-produccion", 30000);
    expect((await verifyPassword("clave-produccion", h)).valid).toBe(true);
  });
});

describe("autenticación", () => {
  it("exige sesión para la API", async () => {
    const res = await rawFetch("/api/players");
    expect(res.status).toBe(401);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("no_autenticado");
  });

  it("permite el health check sin sesión", async () => {
    expect((await rawFetch("/api/health")).status).toBe(200);
  });

  it("ingresa, consulta /me y sale", async () => {
    const user = await createUser("lucia", "clave-segura-123", "organizador");
    const client = new Client();
    const login = await client.login("LUCIA", user.password); // usuario sin distinguir mayúsculas
    expect(login.status).toBe(200);
    expect(login.json.user.username).toBe("lucia");
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect((await new Client().get("/api/auth/me")).json).toEqual({ user: null });
    expect(me.json.user.role).toBe("organizador");

    // El token se guarda hasheado: no aparece en la base.
    const token = client.cookie.split("=")[1]!;
    const stored = await env.DB.prepare("SELECT id FROM sessions").all<{ id: string }>();
    expect(stored.results.length).toBe(1);
    expect(stored.results[0]!.id).not.toBe(token);

    const saved = client.cookie;
    expect((await client.post("/api/auth/logout")).status).toBe(200);
    const c2 = new Client();
    c2.cookie = saved;
    expect((await c2.get("/api/auth/me")).json.user).toBeNull();
  });

  it("rechaza credenciales inválidas con mensaje genérico", async () => {
    await createUser("pedro");
    const client = new Client();
    const wrongPass = await client.login("pedro", "incorrecta-123");
    const noUser = await client.login("nadie", "incorrecta-123");
    expect(wrongPass.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPass.json.error.message).toBe(noUser.json.error.message);
  });

  it("no permite ingresar a usuarios desactivados", async () => {
    const user = await createUser("inactivo");
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(user.id).run();
    expect((await new Client().login(user.username, user.password)).status).toBe(401);
  });

  it("bloquea tras 5 intentos fallidos", async () => {
    const user = await createUser("ana");
    const client = new Client();
    for (let i = 0; i < 5; i++) expect((await client.login("ana", "mala-clave-xx")).status).toBe(401);
    const blocked = await client.login("ana", user.password);
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.message).toMatch(/Demasiados intentos/);
  });

  it("rechaza mutaciones sin Origin o de otro origen (CSRF)", async () => {
    const { client } = await loggedInAdmin();
    const noOrigin = await rawFetch("/api/categories", {
      method: "POST",
      headers: { cookie: client.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "X", gender: "M", level: 1 }),
    });
    expect(noOrigin.status).toBe(403);
    const evil = await client.request("POST", "/api/categories", { name: "X", gender: "M", level: 1 }, { origin: "https://malicioso.example" });
    expect(evil.status).toBe(403);
  });

  it("exige Content-Type JSON", async () => {
    const { client } = await loggedInAdmin();
    const res = await rawFetch("/api/categories", {
      method: "POST",
      headers: { cookie: client.cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: "name=X",
    });
    expect(res.status).toBe(415);
  });

  it("cambia la contraseña y cierra las otras sesiones", async () => {
    const user = await createUser("marta");
    const a = new Client();
    const b = new Client();
    await a.login("marta", user.password);
    await b.login("marta", user.password);
    const bad = await a.post("/api/auth/password", { currentPassword: "equivocada", newPassword: "nueva-clave-456" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields.currentPassword).toBeDefined();
    const short = await a.post("/api/auth/password", { currentPassword: user.password, newPassword: "corta" });
    expect(short.status).toBe(400);
    const ok = await a.post("/api/auth/password", { currentPassword: user.password, newPassword: "nueva-clave-456" });
    expect(ok.status).toBe(200);
    expect((await a.get("/api/auth/me")).json.user.username).toBe("marta");
    expect((await b.get("/api/auth/me")).json.user).toBeNull();
    expect((await new Client().login("marta", "nueva-clave-456")).status).toBe(200);
  });

  it("rehashea al ingresar si el hash tiene menos iteraciones que la configuración", async () => {
    // En tests PBKDF2_ITERATIONS = 1000; se crea un hash con 500.
    const hash = await hashPassword("clave-vieja-123", 500);
    await env.DB.prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('viejo', 'Viejo', ?)").bind(hash).run();
    expect((await new Client().login("viejo", "clave-vieja-123")).status).toBe(200);
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE username = 'viejo'").first<{ password_hash: string }>();
    expect(row!.password_hash.startsWith("pbkdf2-sha256$1000$")).toBe(true);
  });
});

describe("gestión de usuarios", () => {
  it("sólo los administradores gestionan usuarios", async () => {
    const org = await createUser("orga", "clave-segura-123", "organizador");
    const client = new Client();
    await client.login(org.username, org.password);
    expect((await client.get("/api/users")).status).toBe(403);
  });

  it("crea organizadores que luego pueden ingresar, y los desactiva", async () => {
    const { client } = await loggedInAdmin();
    const created = await client.post("/api/users", { username: "Nuevo.Org", displayName: "Nuevo", role: "organizador", password: "clave-inicial-1" });
    expect(created.status).toBe(201);
    expect(created.json.item.username).toBe("nuevo.org");
    const dup = await client.post("/api/users", { username: "nuevo.org", displayName: "Otro", role: "organizador", password: "clave-inicial-1" });
    expect(dup.status).toBe(409);

    const other = new Client();
    expect((await other.login("nuevo.org", "clave-inicial-1")).status).toBe(200);

    const id = created.json.item.id;
    const off = await client.put(`/api/users/${id}`, { displayName: "Nuevo", role: "organizador", active: false });
    expect(off.status).toBe(200);
    expect((await other.get("/api/auth/me")).json.user).toBeNull(); // sesiones cerradas
  });

  it("impide quedarse sin administradores o auto-desactivarse", async () => {
    const { client, user } = await loggedInAdmin();
    const res = await client.put(`/api/users/${user.id}`, { displayName: "Admin", role: "organizador", active: true });
    expect(res.status).toBe(400);
  });
});
