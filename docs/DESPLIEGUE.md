# Puesta en producción de Padel Time

Esta guía cubre la publicación en Cloudflare (plan gratuito, USD 0 por mes). Ninguno de estos pasos se ejecutó todavía: **la app no está publicada** hasta que alguien con la cuenta de Cloudflare de Padel Time siga estos pasos.

Los comandos funcionan igual en PowerShell (Windows), macOS y Linux, desde la carpeta del proyecto.

---

## 1. Qué se necesita

| Requisito | Detalle |
|---|---|
| Cuenta de Cloudflare | Gratuita. Conviene crearla con un correo de Padel Time (no personal), para que no dependa de una sola persona. Activá la verificación en dos pasos. |
| Node.js 20 o superior | El mismo que se usa para el desarrollo local. |
| El proyecto | Con `npm install` hecho y las pruebas en verde (`npm test`). |

No hace falta tarjeta de crédito. El plan gratuito no factura excedentes: si se supera un límite diario, Cloudflare frena las operaciones hasta las 00:00 UTC (21:00 de Argentina) y no cobra nada.

## 2. Configuración del entorno productivo

Toda la configuración está en `wrangler.jsonc`:

| Clave | Valor de producción | Para qué sirve |
|---|---|---|
| `name` | `padel-time` | Nombre del Worker. Define la dirección `padel-time.<subdominio>.workers.dev`. |
| `d1_databases[0].database_id` | El ID que devuelve `wrangler d1 create` (paso 4) | La base de datos de producción. **Obligatorio**: `npm run deploy` se niega a publicar con el ID de ejemplo. |
| `vars.SESSION_TTL_DAYS` | `30` | Días que dura una sesión sin uso. |
| `vars.PBKDF2_ITERATIONS` | `30000` | Costo del cifrado de contraseñas. No subirlo en el plan gratuito (límite de 10 ms de CPU). |
| `vars.PUBLIC_FRAME_ANCESTORS` | `https://sites.google.com https://*.googleusercontent.com https://www.padeltime.com.ar https://padeltime.com.ar` | Sitios que pueden incrustar los rankings públicos. |
| `triggers.crons` | `["17 6 * * *"]` | Limpieza diaria de sesiones vencidas (03:17 de Argentina). |

### Variables y secretos

- **No hay secretos que cargar.** La app no usa claves de servicios externos: las sesiones se guardan en la propia base y las contraseñas se cifran con PBKDF2.
- Las tres variables de la tabla no son confidenciales y viajan en `wrangler.jsonc`.
- Lo único confidencial es:
  - la **sesión de Cloudflare** de quien publica (`npx wrangler login`, se guarda en su compu);
  - la **contraseña del primer administrador**, que se escribe por consola y nunca se guarda en un archivo.
- Si en el futuro se automatiza el despliegue (por ejemplo, con GitHub Actions), el único secreto será un `CLOUDFLARE_API_TOKEN` con permisos de *Workers* y *D1*, guardado en los secretos del repositorio. Nunca debe quedar escrito en el código.

## 3. Iniciar sesión en Cloudflare

```bash
npx wrangler login
```

Se abre el navegador para autorizar. Para verificar con qué cuenta quedó:

```bash
npx wrangler whoami
```

## 4. Crear la base de datos de producción (una sola vez)

```bash
npx wrangler d1 create padel-time
```

Copiá el `database_id` que aparece y pegalo en `wrangler.jsonc`, en lugar de `00000000-0000-0000-0000-000000000000`. Comprobá la configuración:

```bash
npm run preflight
```

Tiene que responder `✓ Configuración lista para producción`.

## 5. Publicar

```bash
npm run deploy
```

Este comando hace, en orden:

1. Revisa la configuración (`preflight`).
2. Compila la app (`build`) y verifica los tipos.
3. Aplica las **migraciones** pendientes a la base de producción (`wrangler d1 migrations apply DB --remote`). Las migraciones sólo agregan tablas, columnas e índices: nunca borran datos. Cloudflare recuerda cuáles ya se aplicaron.
4. Publica el Worker y los archivos de la app (`wrangler deploy`).

La primera vez Wrangler puede pedir que elijas un subdominio `workers.dev` para la cuenta. La app queda en `https://padel-time.<subdominio>.workers.dev`.

## 6. Crear el primer administrador

```bash
npm run user:create -- --username admin --name "Nombre Apellido" --remote
```

Pide la contraseña sin mostrarla (mínimo 10 caracteres). Después:

1. Ingresá a la app con ese usuario.
2. Desde **Usuarios**, creá las cuentas del resto de los organizadores (rol *organizador*, o *admin* para quien también vaya a gestionar usuarios, respaldos y la publicación web).

## 7. Verificación después de publicar

| Comprobación | Cómo |
|---|---|
| La API responde | Abrí `https://padel-time.<subdominio>.workers.dev/api/health`: debe mostrar `{"ok":true}`. |
| Ingreso | Entrá con el administrador. Probá una contraseña incorrecta: debe rechazarla. |
| Datos iniciales | Creá categorías (por ejemplo 4ta Caballeros) y una temporada, y activala. |
| Rankings públicos | Abrí `/publico`. Con la base vacía muestra que todavía no hay rankings. |
| Celular | Abrí la app en el teléfono, ingresá y recorré el menú. |
| Respaldo | Desde **Respaldo**, descargá el primer respaldo y guardalo. |

Si había rankings anteriores, importalos desde **Importar rankings** (ver el manual de operación) y recién después pegá las direcciones públicas en Google Sites, siguiendo `docs/PUBLICACION.md`.

## 8. Dominio propio (opcional, también gratis)

La dirección `workers.dev` funciona sin costo. Si se quiere algo como `rankings.padeltime.com.ar`:

- El dominio tiene que estar gestionado por Cloudflare (los DNS se pueden mover sin costo).
- Se agrega desde el panel de Cloudflare: *Workers & Pages → padel-time → Settings → Domains & Routes → Add → Custom domain*.
- **No lo hice ni lo hago sin tu autorización:** implica cambiar la configuración DNS del dominio de Padel Time.

Con dominio propio, la caché de las páginas públicas también se aprovecha en la red de Cloudflare.

## 9. Actualizar a una versión nueva

1. Descargá un **respaldo** desde la app (o `npm run db:backup:remote`).
2. Reemplazá la carpeta del proyecto por la nueva, conservando tu `wrangler.jsonc` con el `database_id` real, o volvé a pegar el ID.
3. `npm install` y `npm test`.
4. `npm run deploy`. Las migraciones nuevas se aplican solas.

### Volver a la versión anterior

Cloudflare guarda las versiones publicadas:

```bash
npx wrangler rollback
```

El código vuelve atrás pero la base no. Por eso cada migración es compatible hacia atrás: sólo agrega estructuras.

## 10. Costos y límites

Uso esperado con 2–3 organizadores y visitas públicas moderadas (detalle en el README, sección *Límites del plan gratuito*):

| Recurso | Límite gratis | Uso estimado |
|---|---|---|
| Solicitudes al Worker | 100.000 por día | Unos cientos por día de organizadores, más una por cada visita a un ranking público. |
| Archivos de la app | Ilimitados | No consumen solicitudes. |
| D1: lecturas | 5 millones de filas por día | Muy por debajo. |
| D1: escrituras | 100.000 filas por día | Muy por debajo. Una acreditación de 32 jugadores escribe unas 40 filas. |
| D1: almacenamiento | 5 GB | Años de datos ocupan pocos MB. |
| Tareas programadas | 5 por cuenta | Se usa 1. |
| Time Travel (recuperación) | 7 días | Incluido. |

Nada de esto genera cargos. Si un día se superara el límite de solicitudes (por ejemplo, por un pico de visitas públicas), la app y los rankings dejan de responder hasta las 21:00 de Argentina y se recuperan solos.
