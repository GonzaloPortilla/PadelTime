# Puesta en producción de Padel Time

Esta guía cubre la publicación en Cloudflare (plan gratuito, USD 0 por mes). Ninguno de estos pasos se ejecutó todavía: **la app no está publicada** hasta que alguien con la cuenta de Cloudflare de Padel Time siga estos pasos. Se recomienda publicar primero el **entorno de prueba** (sección 12). El resumen de lanzamiento está en [`PRODUCCION.md`](PRODUCCION.md).

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

Copiá el `database_id` que aparece y pegalo en `wrangler.jsonc`, en lugar de `00000000-0000-0000-0000-000000000000`.

Creá también el espacio para las fotos y documentos de la web (Workers KV, gratis hasta 1 GB y sin tarjeta):

```bash
npx wrangler kv namespace create MEDIA
```

Copiá el `id` que devuelve y pegalo en `wrangler.jsonc`, en `kv_namespaces`, en lugar de `00000000000000000000000000000000`. Comprobá la configuración:

```bash
npm run preflight
```

Tiene que responder `✓ Configuración lista para producción`.

## 5. Publicar

```bash
npm run deploy
```

Este comando hace, en orden:

1. Revisa la configuración (`preflight`): rechaza ID de ejemplo y, en el entorno de prueba, que apunte a la base o a los archivos de producción.
2. Verifica los tipos y compila la app **para el entorno pedido** (producción o prueba), y confirma que la compilación quedó para ese entorno.
3. Aplica las **migraciones** pendientes a la base de ese entorno. Las migraciones 0001–0010 sólo agregan o reacomodan estructuras y copian datos: nunca borran información. Cloudflare recuerda cuáles ya se aplicaron.
4. Publica el Worker y los archivos de la app.

Si un paso falla, no se publica nada nuevo y la versión anterior sigue en línea (`scripts/deploy.mjs`).

La primera vez Wrangler puede pedir que elijas un subdominio `workers.dev` para la cuenta. La app queda en `https://padel-time.<subdominio>.workers.dev`.

## 6. Crear el primer administrador

```bash
npm run user:create -- --username admin --name "Nombre Apellido" --remote
```

Pide la contraseña sin mostrarla (mínimo 10 caracteres). Después:

1. Ingresá al panel en `https://padel-time.<subdominio>.workers.dev/admin` con ese usuario. La raíz (`/`) es la web pública.
2. Desde **Usuarios**, creá las cuentas del resto de los organizadores (rol *organizador*, o *admin* para quien también vaya a gestionar usuarios, respaldos y la publicación web).

## 7. Verificación después de publicar

| Comprobación | Cómo |
|---|---|
| La API responde | Abrí `https://padel-time.<subdominio>.workers.dev/api/health`: debe mostrar `{"ok":true}`. |
| Ingreso | Entrá con el administrador. Probá una contraseña incorrecta: debe rechazarla. |
| Datos iniciales | Creá categorías (por ejemplo 4ta Caballeros) y una temporada, y activala. |
| Web pública | Abrí `/`, `/torneos`, `/rankings` y `/reglamentos` sin iniciar sesión. Con la base vacía, torneos y rankings muestran estados vacíos. `/publico` sigue funcionando para los iframes de Google Sites. |
| Panel protegido | Abrí `/admin` en una ventana privada: tiene que pedir usuario y contraseña. |
| Celular | Abrí la app en el teléfono, ingresá y recorré el menú. |
| Respaldo | Desde **Respaldo**, descargá el primer respaldo y guardalo. |

Si había rankings anteriores, importalos desde **Importar rankings** (ver el manual de operación) y recién después pegá las direcciones públicas en Google Sites, siguiendo `docs/PUBLICACION.md`.

## 8. Dominio propio padeltime.com.ar

Paso a paso, verificación y vuelta atrás en [`DOMINIO.md`](DOMINIO.md). **No se hace sin tu autorización:** implica cambiar los DNS del dominio de Padel Time.

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

Detalle actualizado, con los límites vigentes del plan gratuito, en [`COSTOS.md`](COSTOS.md).

## 11. Recuperar el servicio si un despliegue falla

| Problema | Qué hacer |
|---|---|
| `npm run deploy` falla **antes** de publicar (preflight, build o tipos) | No se publicó nada: la versión anterior sigue en línea. Corregí el error y repetí. |
| Falla al aplicar migraciones | Cloudflare aplica cada migración en una transacción: la que falló no deja cambios a medias y la versión anterior sigue funcionando con la base. Revisá el mensaje y repetí. |
| La versión nueva se publicó pero anda mal | `npx wrangler rollback` vuelve al código anterior en segundos. Las migraciones sólo agregan estructuras, así que el código anterior funciona con la base nueva. |
| Se dañaron datos (por ejemplo, una importación equivocada) | Primero, revertirla desde la app (importaciones y acreditaciones se revierten). Si no alcanza: **Time Travel** de D1, últimos 7 días (`docs/RESPALDO.md`, caso B). |
| Se perdieron archivos de la web (fotos o PDF) | Restaurar el último `.zip` de multimedia con `node scripts/restore-media.mjs` (`docs/RESPALDO.md`). |
| Cloudflare caído | Esperar. Los datos no se pierden. Ver `docs/RESPALDO.md`, "Ante una falla de Cloudflare". |
| El dominio no carga después del cambio de DNS | Volver atrás según `docs/DOMINIO.md`, paso 6: la web anterior de Google Sites sigue intacta. |

**Regla de oro antes de cada despliegue:** descargar el respaldo (`.sql` y multimedia `.zip`) y probar primero en el entorno de prueba.

## 12. Entorno de prueba independiente

Mismo código, **otro Worker, otra base y otro espacio de archivos**:

- dirección `https://padel-time-prueba.<subdominio>.workers.dev`;
- franja visible «Entorno de prueba · Datos de demostración»;
- `robots.txt` bloquea todo y las páginas no se indexan.

Los datos de demostración nunca se mezclan con los reales. El control previo (`npm run preflight:prueba`) rechaza el despliegue si el entorno de prueba apunta a la base o a los archivos de producción.

```bash
npx wrangler d1 create padel-time-prueba
```

```bash
npx wrangler kv namespace create MEDIA --env prueba
```

Pegá los dos ID en `wrangler.jsonc`, sección `env.prueba`, en lugar de `11111111…`. Después:

```bash
npm run deploy:prueba
```

```bash
npm run user:create -- --username admin --name "Admin Prueba" --remote --env prueba
```

La contraseña se pide por consola: no queda en el código, en Git ni en el historial. Después se cargan los datos de demostración, que son **todos ficticios**:

```bash
npm run demo:prueba -- --url https://padel-time-prueba.<subdominio>.workers.dev --usuario admin
```

`demo:prueba` usa la API como un organizador y carga:
- un torneo largo con C5 (terminado, con Copa de Oro y Plata y puntos acreditados), C6 (grupos en curso) y C7 (grupos armados);
- un Satélite con su cuadro final acreditado;
- un próximo torneo con la inscripción abierta;
- una novedad.

Se niega a correr si la dirección no muestra la franja «Entorno de prueba», y no duplica nada si se corre dos veces. Para verificar la web publicada:

```bash
npm run check:links -- https://padel-time-prueba.<subdominio>.workers.dev --legacy
```

**Actualizar la versión de prueba** después de hacer cambios: `npm run deploy:prueba`. Aplica las migraciones nuevas y conserva los datos cargados.

**Desactivar el entorno de prueba** al terminar la evaluación. Producción no se ve afectada:

```bash
npx wrangler delete --name padel-time-prueba
```

```bash
npx wrangler d1 delete padel-time-prueba
```

```bash
npx wrangler kv namespace delete --namespace-id <ID de KV de prueba>
```

También se puede hacer desde el panel de Cloudflare, en *Workers & Pages*, *D1* y *KV*.
