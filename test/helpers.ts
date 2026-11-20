import { env, exports } from "cloudflare:workers";
import { hashPassword } from "../worker/lib/password";

export const ORIGIN = "http://localhost";

export async function createUser(username = "admin", password = "clave-segura-123", role: "admin" | "organizador" = "admin") {
  const hash = await hashPassword(password, 1000);
  const row = await env.DB.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(username, username.toUpperCase(), hash, role)
    .first<{ id: number }>();
  return { id: row!.id, username, password };
}

export function rawFetch(path: string, init: RequestInit = {}) {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
}

/** Cliente con cookie de sesión. */
export class Client {
  cookie = "";

  async request(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await rawFetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const [pair] = setCookie.split(";");
      this.cookie = pair!.endsWith("=") ? "" : pair!;
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = text ? JSON.parse(text) : null;
    return { status: res.status, json, headers: res.headers };
  }
  get(path: string) { return this.request("GET", path); }
  post(path: string, body?: unknown) { return this.request("POST", path, body ?? {}); }
  put(path: string, body: unknown) { return this.request("PUT", path, body); }
  patch(path: string, body: unknown) { return this.request("PATCH", path, body); }
  delete(path: string) { return this.request("DELETE", path); }

  async login(username: string, password: string) {
    return this.post("/api/auth/login", { username, password });
  }
}

export async function loggedInAdmin() {
  const user = await createUser();
  const client = new Client();
  const res = await client.login(user.username, user.password);
  if (res.status !== 200) throw new Error(`login falló: ${JSON.stringify(res.json)}`);
  return { client, user };
}

export async function seedBasics(client: Client) {
  const cab4 = (await client.post("/api/categories", { name: "4ta", gender: "M", level: 4 })).json.item;
  const cab5 = (await client.post("/api/categories", { name: "5ta", gender: "M", level: 5 })).json.item;
  const dam4 = (await client.post("/api/categories", { name: "4ta", gender: "F", level: 4 })).json.item;
  const season = (await client.post("/api/seasons", { name: "Temporada 2026", year: 2026, startDate: "2026-01-01", endDate: "2026-12-31" })).json.item;
  return { cab4, cab5, dam4, season };
}
