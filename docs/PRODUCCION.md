# Informe de preparación para producción

**Fecha:** 25/11/2026 · **Rama:** `fase11-lanzamiento` · **Estado: lista para publicar, a la espera de tus autorizaciones.**

No se publicó nada, no se tocó el dominio ni los DNS, y no se modificó la web actual.

## 1. Resultado

| Objetivo | Estado |
|---|---|
| Web pública libre | ✔ Sin inicio de sesión, indexable, con SEO (títulos, descripciones, canonical, sitemap, robots) y redirecciones 301 desde la web anterior |
| Panel administrativo protegido | ✔ Usuario y contraseña, roles, bloqueo por intentos, `noindex`, sin registro público |
| Gestión de contenidos sin programación | ✔ Páginas, novedades, multimedia, patrocinadores, calendario, datos de la web y redirecciones |
| Fixtures de torneos largos | ✔ Torneos con varias categorías, grupos, partidos, programación, retiros |
| Resultados y posiciones automáticas | ✔ Tablas, desempates configurables, Copa de Oro y Plata, BYE, conflictos sin sobrescrituras |
| Rankings automatizados | ✔ Del fixture a las posiciones finales, la distribución de puntos, la acreditación y el ranking anual, con correcciones transaccionales |
| Satélites con carga de resultados finales | ✔ Cuadro final por imagen o a mano y acreditación, sin fixture |
| Sin sección activa de Damas | ✔ Fuera de la web y de las altas nuevas; datos históricos conservados |
| Costo mensual cero | ✔ Todo en el plan gratuito de Cloudflare (límites y riesgos en `COSTOS.md`) |
| Pruebas | ✔ 272/272 de integración y 40/40 de navegador (PC y celular); 0 vulnerabilidades. Lo no probado está en `INFORME_PRUEBAS.md`. |

## 2. Documentación entregada

| # | Documento | Archivo |
|---|---|---|
| 1 | Manual del organizador | [`MANUAL.md`](MANUAL.md) |
| 2 | Manual de administración de contenidos | [`CMS.md`](CMS.md) |
| 3 | Guía de actualización de fixtures | [`FIXTURES.md`](FIXTURES.md) |
| 4 | Guía de acreditación de puntos | [`ACREDITACION.md`](ACREDITACION.md) |
| 5 | Guía de correcciones | [`CORRECCIONES.md`](CORRECCIONES.md) |
| 6 | Guía de respaldos | [`RESPALDO.md`](RESPALDO.md) |
| 7 | Instrucciones de despliegue (incluye entorno de prueba y recuperación ante fallas) | [`DESPLIEGUE.md`](DESPLIEGUE.md) |
| 8 | Guía de configuración del dominio | [`DOMINIO.md`](DOMINIO.md) |
| 9 | Auditoría e inventario de contenido pendiente de migrar | [`MIGRACION_CONTENIDOS.md`](MIGRACION_CONTENIDOS.md) |
| 10 | Informe de pruebas y limitaciones | [`INFORME_PRUEBAS.md`](INFORME_PRUEBAS.md) · [`LIMITACIONES.md`](LIMITACIONES.md) |
| — | Costos e infraestructura | [`COSTOS.md`](COSTOS.md) |

## 3. Pasos exactos para publicar

Todos los comandos se ejecutan en PowerShell, en la carpeta del proyecto. Los marcados con 🔐 requieren tu **autorización** o la del titular de la cuenta o del dominio.

### Paso 1 — Preparar la compu (una vez)

```bash
npm install
```

```bash
npm test
```

Tiene que terminar con todas las pruebas en verde.

### Paso 2 — 🔐 Cuenta de Cloudflare

1. Crear (o usar) la cuenta de Cloudflare de Padel Time, con un correo de la organización y verificación en dos pasos. **Plan Free, sin tarjeta.**
2. Iniciar sesión desde la compu:

```bash
npx wrangler login
```

### Paso 3 — 🔐 Entorno de prueba (datos de demostración)

```bash
npx wrangler d1 create padel-time-prueba
```

```bash
npx wrangler kv namespace create MEDIA --env prueba
```

Pegá los dos ID en `wrangler.jsonc`, sección `env.prueba`. Después:

```bash
npm run deploy:prueba
```

```bash
npm run user:create -- --username admin --name "Tu Nombre" --remote --env prueba
```

```bash
npm run demo:prueba -- --url https://padel-time-prueba.<subdominio>.workers.dev --usuario admin
```

Verificación:

```bash
npm run check:links -- https://padel-time-prueba.<subdominio>.workers.dev --legacy
```

En `https://padel-time-prueba.<subdominio>.workers.dev/admin` recorré el circuito, desde la PC y desde el celular:

1. **Torneos → Nuevo torneo** con dos categorías.
2. Inscribir parejas, armar grupos y cargar resultados.
3. Armar Copa de Oro / Plata, pasar a **Puntos**, **Acreditar** y verificar el ranking en la web.
4. Corregir un resultado y confirmar la corrección.
5. **Contenidos web:** editar una página, publicarla y verla.
6. **Respaldo:** descargar el `.sql` y el `.zip`.

La web de prueba muestra la franja «Entorno de prueba» y no aparece en Google.

### Paso 4 — 🔐 Producción en la dirección provisoria (`workers.dev`)

```bash
npx wrangler d1 create padel-time
```

```bash
npx wrangler kv namespace create MEDIA
```

Pegá los dos ID en `wrangler.jsonc` (sección principal). Después:

```bash
npm run deploy
```

```bash
npm run user:create -- --username admin --name "Tu Nombre" --remote
```

> **Atención — datos reales:** desde este paso, lo que publiques es visible en `https://padel-time.<subdominio>.workers.dev`. Hasta el lanzamiento podés dejar los rankings ocultos (**Publicación web → desactivar**) y los torneos sin marcar «Publicar en la web».

### Paso 5 — Cargar los datos reales (desde el panel de producción)

1. **Usuarios:** cuentas de los organizadores.
2. **Categorías:** C4/5 a C9 Caballeros y las divisiones que correspondan (C6 → 1 y 2, si se usan).
3. **Temporadas:** crear la 2026 y activarla. Si se cargan torneos de 2025, crear la 2025.
4. **Importar rankings:** las planillas 2026 que entregaste. Están fuera del repositorio porque tienen nombres de personas.
5. **Datos de la web:** WhatsApp definitivo, Instagram, sede y aviso destacado.
6. **Torneos en curso y próximos**, con sus categorías (por ejemplo, Paris Major 2000).
7. **Torneos históricos** con sus fechas reales, y las imágenes de la web anterior con `scripts/migrar-web-anterior.mjs` (`MIGRACION_CONTENIDOS.md`, sección 3).
8. **Redirecciones:** apuntar la dirección vieja de cada torneo cargado a su página nueva.
9. **Respaldo:** descargar el primer respaldo (`.sql` y `.zip`).

Lo que falta que entregue la organización está en `MIGRACION_CONTENIDOS.md`, sección 4.

### Paso 6 — 🔐 Lanzamiento con el dominio padeltime.com.ar

**Sólo con tu confirmación expresa.** Seguir [`DOMINIO.md`](DOMINIO.md):

1. Agregar el dominio a Cloudflare.
2. 🔐 El titular cambia los DNS en NIC Argentina.
3. Activar `routes` en `wrangler.jsonc` y correr `npm run deploy`. El certificado HTTPS es automático.
4. Verificar:

   ```bash
   npm run check:links -- https://www.padeltime.com.ar --legacy
   ```

5. Enviar el sitemap a Google Search Console.

**Vuelta atrás:** `DOMINIO.md`, paso 6. Google Sites queda intacto.

### Paso 7 — Operación

- **Respaldo semanal** (`.sql` y `.zip`) desde **Respaldo**.
- **Una vez por mes:** mirar las métricas de uso en Cloudflare (`COSTOS.md`).
- **Antes de cada actualización:** respaldo, después `npm run deploy:prueba`, y recién entonces `npm run deploy`.

## 4. Autorizaciones que necesito de vos

| # | Autorización | Para qué | Riesgo |
|---|---|---|---|
| 1 | Usar o crear la cuenta de Cloudflare de Padel Time (plan Free) | Publicar | Ninguno: sin tarjeta, sin costo |
| 2 | Publicar el **entorno de prueba** | Probar en Internet con datos ficticios | Ninguno: no se indexa, separado de producción |
| 3 | Publicar **producción en `workers.dev`** y cargar datos reales | Dejar todo listo antes del cambio de dominio | Lo publicado es visible en esa dirección (se controla con «Publicar en la web») |
| 4 | **Cambiar el dominio** (DNS en NIC Argentina, lo hace el titular) | Reemplazar Google Sites | Bajo, reversible en minutos (`DOMINIO.md`, paso 6) |
| 5 | Información y archivos pendientes | Completar el contenido | `MIGRACION_CONTENIDOS.md`, sección 4 |

## 5. Cambios de esta fase (resumen técnico)

- **Migración 0010:**
  - archivos de resultados por categoría (`tournaments.result_files`);
  - redirecciones (`site_redirects`) sembradas con las 15 secciones de la web anterior.
- **Panel:**
  - tarjeta **Archivos de resultados** en cada categoría;
  - **Contenidos web → Redirecciones**.
- **Web:**
  - sección "Resultados (archivo)";
  - redirecciones 301 sólo hacia direcciones de la propia web, consultadas únicamente cuando la página no existe;
  - calendario acotado, y los meses que no son el actual no se indexan.
- **SEO y seguridad:**
  - `X-Robots-Tag: noindex` en toda la API;
  - fotos con caché de Cloudflare (dominio propio) y purga al borrar.
- **Entorno de prueba:**
  - `env.prueba` en `wrangler.jsonc`, `ENVIRONMENT=prueba` (franja, `noindex`, `robots.txt` bloqueado);
  - `npm run deploy:prueba`, `npm run demo:prueba` (datos ficticios por la API, `scripts/cargar-demo.mjs`).
- **Scripts:**
  - `scripts/deploy.mjs`: despliegue con verificación de entorno;
  - `scripts/check-links.mjs`: verificador de enlaces y de direcciones viejas;
  - `scripts/migrar-web-anterior.mjs`: descarga, plantilla y subida de imágenes históricas.
- **Componentes estables sin cambios:** motor de puntos, acreditación, reconocimiento de cuadros, importación de rankings y autenticación. No se borró ningún dato ni se actualizaron dependencias.
