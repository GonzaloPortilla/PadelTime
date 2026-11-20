import { app } from "./app";
import { publicApp } from "./public/app";
import { cleanupExpired } from "./lib/maintenance";

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Vista pública de sólo lectura (sin sesión ni acceso a la API administrativa).
    if (pathname === "/publico" || pathname.startsWith("/publico/")) return publicApp.fetch(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
  // Tarea diaria (Cron Trigger, incluido en el plan gratuito): limpia datos temporales.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupExpired(env.DB));
  },
} satisfies ExportedHandler<Env>;
