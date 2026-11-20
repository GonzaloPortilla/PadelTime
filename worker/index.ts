import { app } from "./app";
import { publicApp } from "./public/app";

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Vista pública de sólo lectura (sin sesión ni acceso a la API administrativa).
    if (pathname === "/publico" || pathname.startsWith("/publico/")) return publicApp.fetch(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
