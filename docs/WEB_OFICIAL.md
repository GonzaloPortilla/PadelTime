# Padel Time · Ampliación a web oficial (Fase 6: auditoría y plan)

Documento de arquitectura para convertir la app de gestión de Padel Time en la web oficial (`www.padeltime.com.ar`), con un panel de administración de contenidos.

En esta fase **no se agregó ninguna funcionalidad visible**: sólo hay análisis, plan y la preparación técnica mínima (sección 9).

Documentos relacionados:

- Inventario de la web anterior: [`docs/web-anterior/INVENTARIO.md`](web-anterior/INVENTARIO.md) y [`inventario-paginas.csv`](web-anterior/inventario-paginas.csv).
- Arquitectura técnica detallada de la app: [`docs/ARQUITECTURA.md`](ARQUITECTURA.md).

---

## 0. Punto de partida y seguridad del proyecto

| Verificación | Resultado (20/11/2026) |
|---|---|
| Estado de Git | Limpio, sin cambios sin guardar. `main` igual a `origin/main` (commit `4b2ef00`, Fase 5B). |
| Punto de restauración | Etiqueta **`v5b-estable`** sobre `4b2ef00`. Para volver: `git checkout v5b-estable`. |
| Rama de trabajo | **`fase6-web-oficial`** (creada desde `main`). `main` queda intacta. |
| Tipos (`npm run typecheck`) | Sin errores. |
| Pruebas automáticas (`npm test`) | **172/172** en 13 archivos. |
| Pruebas de navegador (`npm run test:e2e`) | **25/26** en la primera corrida. Falló el circuito en celular por un selector de prueba ambiguo: `getByLabel("Puntos")` a veces encontraba primero una casilla cuyo texto también dice "puntos". Era un defecto de la prueba, no de la app; corregido con `exact: true` (también en `phase2.spec.ts`). Después, **26/26**. |
| Datos productivos | No se tocaron. La app no está publicada y la web actual de Google Sites no se modificó. |

---

## 1. Arquitectura actual

```
                         Un único Cloudflare Worker (plan gratuito)
┌──────────────────────────────────────────────────────────────────────────┐
│  Archivos estáticos (gratis, ilimitados)                                │
│   └─ SPA React del panel  →  /, /jugadores, /torneos, /rankings, …       │
│                                                                          │
│  Código del Worker (sólo para estas rutas: run_worker_first)             │
│   ├─ /api/*        API JSON (Hono) con sesión, CSRF, roles, auditoría    │
│   ├─ /publico/*    Rankings públicos: HTML generado en el servidor,      │
│   │                caché versionada, incrustable en Google Sites         │
│   └─ cron diario   limpieza de sesiones                                  │
│                                                                          │
│  D1 (SQLite)  ←  única base: 20 tablas, migraciones 0001–0004            │
└──────────────────────────────────────────────────────────────────────────┘
```

| Capa | Contenido | Tamaño |
|---|---|---|
| `src/` | Panel de administración (React 19, React Router, TanStack Query, Tailwind 4 con la identidad de Padel Time). Lector de cuadros por imagen (OCR en el navegador). Asistente de importación de Excel/CSV. | 64 archivos, ~9.300 líneas |
| `worker/` | API (`routes/`, 16 módulos), librerías de sesión, contraseñas, límite de intentos, errores, validación y auditoría (`lib/`), y la vista pública (`public/`). | 33 archivos (~4.200 líneas, sin el `.d.ts` generado) |
| `shared/` | Lógica común: esquemas Zod, tipos, motor de puntuación puro, nombres, exportación CSV/XLSX, respaldo. | 9 archivos, ~1.700 líneas |
| `migrations/` | 0001 esquema · 0002 puntuación y ledger · 0003 importación de cuadros · 0004 rankings importados y publicación. | 4 archivos |
| `test/`, `e2e/` | 172 pruebas de integración en `workerd` con D1 real. 26 de navegador en escritorio y Pixel 7. | |

### Rutas actuales

| Tipo | Rutas |
|---|---|
| **Públicas (sin sesión)** | `/publico` (índice de rankings) · `/publico/ranking/:temporada\|actual/:categoría[/:división]` (con descarga `?descargar=xlsx\|csv` y modo incrustado `?embed=1`) · `/publico/jugadores?q=` · `/publico/jugador/:código` · `/ingresar` (pantalla de ingreso del panel) · `/api/auth/login`, `/api/health` |
| **Panel (SPA, con sesión)** | `/` (panel) · `/jugadores[/:id]` · `/torneos[/:id]` · `/rankings` · `/importar-rankings` · `/publicacion` · `/puntuacion` · `/movimientos` · `/temporadas` · `/categorias` · `/cuenta` · solo admin: `/usuarios`, `/respaldo` |
| **API (con sesión)** | `/api/users` (admin) · `categories`, `divisions` · `players` · `seasons` · `tournaments` (parejas, resultados, puntuación, previsualización, acreditación, corrección, reversión, importación de cuadros) · `teams` · `scoring-templates` · `rankings` · `movements` · `dashboard` · `ranking-imports` · `publication` (configuración: admin) · `backup` (admin) |

### Autenticación, seguridad y permisos (revisado)

| Aspecto | Estado | Para la web oficial |
|---|---|---|
| Cuentas | Sin registro público. Las crea un admin o el script de terminal. | Se mantiene. El público **no** tiene cuentas. |
| Contraseñas | PBKDF2-SHA256, 30.000 iteraciones (calibrado a 10 ms de CPU). | Se mantiene. |
| Sesiones | Cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`. En la base se guarda sólo el hash. Duran 30 días y se cierran al cambiar la contraseña o desactivar al usuario. | Se mantiene. La cookie seguirá atada al dominio exacto. |
| Fuerza bruta | 5 fallos en 15 minutos bloquean al usuario y la IP. | Se mantiene. |
| CSRF | Mismo `Origin` + JSON obligatorio + `SameSite=Strict`. | Los formularios públicos (contacto e inscripción) necesitan su propia protección: Turnstile y límite por IP. |
| Roles | `admin` y `organizador`. Admin: usuarios, publicación, respaldo, reapertura de temporadas. | Se agrega un rol **`editor`** (sólo contenidos) y permisos por módulo (sección 5). |
| Cabeceras | CSP estricta en el panel; CSP propia de la vista pública con `frame-ancestors` para Google Sites; HSTS; `nosniff`. | La web pública necesitará una CSP que admita el mapa (Google Maps) y quizás videos incrustados. Se definirá en Fase 7. |
| Datos personales | La vista pública nunca muestra DNI, teléfono, email ni notas. | Las inscripciones y los mensajes de contacto suman datos personales: acceso sólo desde el panel y aviso de privacidad (Ley 25.326). |

---

## 2. Arquitectura propuesta

Se mantiene **un solo Worker, una sola base y USD 0**. Se reparten las rutas:

```
www.padeltime.com.ar
├─ /                      ┐
├─ /torneos/…             │  WEB PÚBLICA: HTML generado en el Worker (sin JavaScript obligatorio)
├─ /rankings/…            │  · rápida en celulares, indexable por Google
├─ /calendario            │  · caché versionada (como /publico hoy): sólo se recalcula al cambiar algo
├─ /reglamentos           │  · plantillas con escape automático (worker/public/html.ts)
├─ /novedades/…           │
├─ /contacto, /inscripcion│
├─ /<página del CMS>      ┘
├─ /media/<id>               Imágenes y documentos (servidos desde KV, con caché larga)
├─ /publico/…                Se conserva: redirige a las rutas nuevas (los iframes ya pegados siguen andando)
├─ /admin/…               ►  PANEL: la misma SPA de hoy, movida bajo /admin
└─ /api/…                 ►  API: la misma de hoy + módulos nuevos (contenidos, fixtures, inscripciones)
```

### Decisiones y motivos

1. **Web pública generada en el servidor, no en la SPA.** El código de `/publico` (plantilla `h` con escape, `layout()`, CSS de la marca y caché por versión) ya resuelve lo difícil. Una SPA pública pesaría unos 130 KB antes de mostrar nada y Google la indexa peor. Con HTML del Worker, cada página pesa unos pocos KB y funciona sin JavaScript.
2. **El panel se muda a `/admin`.** Libera la raíz para la web. Es un cambio de configuración: el `basename` de React Router, las rutas de assets y `run_worker_first`. Las direcciones viejas del panel (`/torneos/12`, …) redirigen a `/admin/…` para no romper marcadores.
3. **Imágenes y documentos en Workers KV.** D1 gratis tiene 500 MB por base y 2 MB por archivo. KV gratis da 1 GB, archivos de hasta 25 MB, 100.000 lecturas y 1000 escrituras por día, y **no pide tarjeta**. En D1 queda sólo la ficha de cada archivo (nombre, tipo, tamaño, texto alternativo). Las imágenes se comprimen en el navegador antes de subirlas (WebP de ~1600 px, unos 200 KB): entran miles. Si más adelante se quiere más espacio, R2 da 10 GB gratis pero exige registrar una tarjeta. El código aislará el almacenamiento detrás de una interfaz para poder cambiar de uno a otro sin tocar el resto.
4. **El CMS es un módulo del panel, no un producto externo.** Un CMS externo (WordPress, un CMS "headless" en otro servicio) implicaría otro hosting, otro login y, casi siempre, costo. Dentro de la app se reutilizan la sesión, los roles, la auditoría, el respaldo y el diseño.
5. **Contenido por bloques, no HTML libre.** Cada página es una lista de bloques tipados: título, texto con formato básico (negrita, listas, enlaces), imagen, galería, botón, documento, mapa, ranking, fixture, aviso. Se guardan como JSON validado con Zod y se renderizan con escape. Evita la inyección de código y que una edición rompa el diseño.
6. **Fixtures de torneos largos con estructura propia:** fases, grupos, partidos y llaves. Al cerrarse, cada pareja recibe su instancia (Campeón, Finalista…) y se acredita con el **motor actual**, sin cambios. Los Satélites y Americanos siguen como hoy: sólo resultado final.
7. **Damas, discontinuado:** un ajuste `ramas_activas = M`. Oculta Damas de la web pública y de los formularios de alta. Los datos y el motor de puntuación no se tocan (sección 6).

### Límites gratuitos de Cloudflare para los módulos nuevos

Verificados el 20/11/2026 en la documentación oficial. Hay que revisarlos de nuevo antes de publicar.

| Recurso | Límite gratuito | Uso estimado con la web oficial | Riesgo |
|---|---|---|---|
| Solicitudes al Worker | 100.000 por día | Cada visita a una página pública es 1 solicitud. Una imagen servida desde `/media` es otra. Con dominio propio, la caché de Cloudflare absorbe las imágenes y las páginas repetidas. | **Medio**: es el límite que se alcanzaría primero si hubiera picos de miles de visitas. Mitigación: caché, imágenes con `Cache-Control` largo y páginas livianas. |
| CPU por solicitud | 10 ms | Generar una página HTML con plantillas lleva ~1–3 ms. Las páginas en caché, casi 0. | Bajo. |
| D1: almacenamiento | **500 MB por base** (5 GB por cuenta) | Contenidos, torneos, partidos e inscripciones: pocos MB por año. | Bajo, si las imágenes no van en D1. |
| D1: lecturas y escrituras | 5 millones y 100.000 filas por día | Muy por debajo. | Bajo. |
| KV: almacenamiento | 1 GB | ~5.000 imágenes comprimidas. | Bajo. |
| KV: escrituras | 1000 por día | Cada archivo subido es 1 escritura. | Bajo para el uso de 2–3 organizadores. |
| KV: lecturas | 100.000 por día | Con caché en Cloudflare, sólo la primera vista de cada imagen lee KV. | Bajo. |
| Turnstile (antispam de formularios) | Gratuito | Formularios de contacto e inscripción. | Bajo. |
| Cron Triggers | 5 por cuenta | Se usa 1. | Bajo. |
| Archivos estáticos | Ilimitados y gratis | Panel y CSS/JS de la web. | Nulo. |
| Correo saliente | **No hay envío gratuito general** | Avisos de inscripción: se ven en el panel. Opción a evaluar en la Fase 10: Cloudflare Email Routing envía sin costo a direcciones verificadas, pero requiere el dominio en Cloudflare. | Medio: hay que decidir el canal de aviso. |

---

## 3. Inventario de la web anterior (resumen)

Detalle completo en [`docs/web-anterior/INVENTARIO.md`](web-anterior/INVENTARIO.md). Resumen:

- **268 páginas**: 61 son sólo índices; el resto, fixtures (36), resultados (35), tablas de posiciones (37), Copa de Oro (28), Copa de Plata (24), resultados de Satélites (19), rankings (17), portada, reglamentos, calendario, un cuadro final y una página vacía.
- **Sin funciones propias.** Todo el contenido de torneos, rankings y calendario son **imágenes** de planillas. Lo único interactivo:
  - "ANOTATE!", que abre WhatsApp;
  - un Google Forms de contacto (nombre, correo, teléfono, comentarios);
  - un mapa de Google de la sede;
  - el enlace a Instagram.
- **Texto real:** sólo el reglamento (tipos de torneo, formatos, puntos y horarios) y el bloque informativo de la portada.
- **Cancha abierta, Liga y Premios** aparecen como viñetas de la portada, sin páginas ni contenido.
- 53 páginas son de Damas.

| Sección de la web anterior | En la nueva web |
|---|---|
| Portada (comunidad, sede, flyers, "¿De qué se trata?") | Página de inicio editable por bloques, con próximos torneos y novedades automáticas. |
| Barra "Próximo torneo… ANOTATE!" | Aviso destacado editable, con enlace a la inscripción o a WhatsApp. |
| Torneo → categoría → fixture / resultados / tabla / copas | Página de torneo con pestañas por categoría: fixture, resultados y tabla **calculados desde los partidos cargados**, y llaves de Copa de Oro y Plata. |
| Satélites (un resultado por americano) | Página del americano con el resultado final (instancias y puntos), desde el módulo actual. |
| Rankings 2025/2026 (imágenes) | Rankings reales por temporada y categoría (ya existen en `/publico`), integrados a la web, con buscador e historial. |
| Ranking general (vacía) | Se elimina, o se reemplaza por el índice de rankings. |
| Calendario (imágenes) | Calendario generado desde las fechas de torneos y partidos, más eventos manuales (canchas abiertas, cena de fin de año). |
| Reglamentos | Página del CMS con el texto actual y, opcionalmente, el PDF descargable. |
| Cancha abierta · Liga · Premios | Páginas del CMS. **El contenido lo tienen que proveer los organizadores**: hoy no existe en la web. |
| Formulario de Google | Formulario de contacto propio, con antispam y bandeja en el panel. |
| ANOTATE! (WhatsApp) | Formulario de inscripción por torneo y categoría, con bandeja en el panel. WhatsApp sigue como alternativa. |
| Mapa de la sede | Bloque "mapa" en la página de sede o contacto. |
| Damas | No se publica. |

---

## 4. Componentes que se reutilizan

| Componente actual | Dónde está | Reutilización en la web oficial |
|---|---|---|
| Sesión, contraseñas, límite de intentos, CSRF | `worker/lib/session.ts`, `password.ts`, `rate-limit.ts`, `app.ts` | Login del panel tal cual. `rate-limit` también para los formularios públicos. |
| Roles y auditoría | `users`, `audit_log`, `auditStmt` | Se agrega el rol `editor`. Toda edición de contenido queda auditada. |
| Plantillas HTML con escape (`h`, `Raw`) | `worker/public/html.ts` | Base de todas las páginas públicas. |
| Layout público, CSS de marca, fuentes propias | `worker/public/pages.ts`, `public/pub/` | Se extiende a la web completa: menú, pie y bloques. |
| Caché versionada (`public_version` + triggers + ETag 304) | `worker/public/app.ts`, migración 0004 | Mismo mecanismo para toda la web: una edición publicada incrementa la versión. |
| Rankings públicos, buscador, historial, descargas | `worker/public/data.ts`, `pages.ts` | Pasan a `/rankings/…` (se mantienen `/publico/…` como redirección). |
| Motor de puntuación, acreditación, correcciones, ledger | `shared/scoring.ts`, `worker/routes/credits.ts` | **Sin cambios.** Los fixtures sólo alimentan `tournament_teams.stage_id`. |
| Torneos, parejas, categorías, divisiones, temporadas | rutas y tablas actuales | Se amplían con datos públicos (sección 5). C6 1 / C6 2 se modelan como **divisiones**, que ya existen. |
| Importación de cuadros por imagen (OCR) | `src/ocr/`, `worker/routes/imports.ts` | Sigue sirviendo para Satélites y para cargar llaves. |
| Importación de Excel/CSV | `src/rankingImport/` | Para cargar rankings 2025/2026 desde las planillas originales, si las tienen. |
| Exportación CSV/XLSX | `shared/export.ts` | Exportar inscripciones y fixtures. |
| Respaldo y restauración | `shared/backup.ts`, `worker/routes/backup.ts` | Se agregan las tablas nuevas a `BACKUP_TABLES`. Los archivos de KV necesitan su propio respaldo (sección 7). |
| Sistema de diseño (tokens, `Logo`, `Card`, `Modal`, `Button`, …) | `src/index.css`, `src/components/` | Panel de contenidos con el mismo estilo. |
| Pruebas (`workerd` + D1, Playwright escritorio/celular) | `test/`, `e2e/` | Misma estrategia para cada módulo nuevo. |

---

## 5. Nuevas entidades de base de datos

Todas en migraciones **aditivas** (0005 en adelante): sólo `CREATE TABLE`, `ALTER TABLE … ADD COLUMN` e índices. Nunca `DROP` ni `UPDATE` masivos sobre datos existentes.

### 5.1 Contenidos (CMS)

| Tabla | Campos principales | Notas |
|---|---|---|
| `site_settings` | clave/valor: nombre, eslogan, WhatsApp, Instagram, correo, dirección y coordenadas de la sede, aviso destacado (texto, enlace, vigencia), **`active_genders`** | Puede reutilizar `app_settings` (ya existe, con triggers de versión pública). |
| `pages` | `slug` único, `title`, `summary`, `blocks` (JSON validado), `status` (borrador/publicada), `published_at`, `seo_title`, `seo_description`, `og_media_id`, `sort_order`, `system_key` (inicio, reglamentos, contacto…) | Las páginas de sistema no se pueden borrar. |
| `page_revisions` | `page_id`, `blocks`, `title`, `created_by`, `created_at` | Historial: se puede volver a una versión anterior. |
| `menu_items` | `label`, `target` (página, torneo, ranking, URL), `parent_id`, `sort_order`, `visible` | Menú editable de hasta dos niveles. |
| `posts` (novedades) | `slug`, `title`, `excerpt`, `blocks`, `cover_media_id`, `status`, `published_at`, `tournament_id` opcional, `pinned` | Noticias y flyers. |
| `media` | `id` (UUID), `kind` (imagen/documento), `storage_key` (KV), `mime`, `bytes`, `width`, `height`, `alt`, `title`, `sha256`, `uploaded_by` | Sólo los datos del archivo: el contenido está en KV. Con `sha256` no se sube dos veces el mismo archivo. |
| `events` (calendario) | `title`, `kind` (cancha abierta, evento, cierre de inscripción…), `starts_at`, `ends_at`, `location`, `tournament_id` opcional, `public` | Los torneos y partidos aparecen solos en el calendario; esta tabla es para lo demás. |

### 5.2 Torneos públicos y fixtures

| Tabla o columna | Campos principales | Notas |
|---|---|---|
| `tournaments` (columnas nuevas) | `slug`, `series` (open_1000, challenger_500, satelite_100, master_2000, otro), `format` (`largo_fixture`/`americano`), `public_visible`, `description_blocks`, `poster_media_id`, `registration_open`, `registration_deadline`, `registration_fee`, `prize_info` | `format` decide si el torneo tiene fixture. Los existentes quedan con `public_visible = 0` hasta revisarlos: nada se publica solo. |
| `tournament_phases` | `tournament_id`, `division_id` (o categoría), `kind` (grupos, copa_oro, copa_plata, llave, cruces_master), `name`, `sort_order`, `rules` (JSON: puntos por partido ganado, desempates) | Por categoría o subdivisión (C6 1 / C6 2). |
| `phase_groups` | `phase_id`, `name` (Grupo A…), `sort_order` | |
| `group_teams` | `group_id`, `team_id`, `seed` | Las parejas son las mismas `tournament_teams`. |
| `matches` | `phase_id`, `group_id`, `round` (fecha 1, cuartos…), `bracket_slot`, `team1_id`, `team2_id`, `scheduled_at`, `court`, `status` (programado, jugado, suspendido, w.o.), `sets` (JSON validado), `winner_team_id`, `next_match_id` / `next_slot` (para las llaves), `updated_by` | Índices por fase, fecha y pareja. |
| (calculado, no tabla) | Tabla de posiciones | Se calcula desde `matches` con una función pura en `shared/` (como el motor de puntuación) y se prueba por separado. |

Relación con lo existente: al cerrar un torneo con fixture, la última fase alcanzada por cada pareja se traduce a su **instancia** (`tournament_teams.stage_id`). La acreditación, la corrección y la reversión siguen usando el código actual, sin modificaciones.

### 5.3 Inscripciones y contacto

| Tabla | Campos principales | Notas |
|---|---|---|
| `registrations` | `tournament_id`, `category_id`, `player1_name`, `player1_phone`, `player2_name`, `player2_phone`, `email`, `comments`, `status` (nueva, confirmada, en espera, rechazada), `player1_id`/`player2_id` (vinculación posterior), `ip_hash`, `created_at` | Desde el panel se vincula con jugadores existentes y se crea la pareja con un clic. |
| `contact_messages` | `name`, `email`, `phone`, `message`, `status`, `ip_hash`, `created_at` | Reemplaza al Google Forms. |

Las tablas nuevas se suman a `BACKUP_TABLES` y a los triggers de `public_version` cuando corresponda.

---

## 6. Estrategia de migración sin pérdida de datos

### 6.1 Base de datos

1. **Sólo migraciones aditivas** (0005, 0006, …), cada una con su prueba de "migrar una base con datos de la fase anterior y verificar que todo sigue igual". Los conteos y la suma del ledger tienen que dar lo mismo antes y después.
2. **El registro de puntos no se toca:** `point_movements` es inmutable por triggers, y ninguna migración lo modifica.
3. **Respaldo obligatorio** (pantalla **Respaldo** o `npm run db:backup:remote`) antes de aplicar cada migración en producción. Además, Time Travel permite volver hasta 7 días atrás.
4. **Valores por defecto seguros:** las columnas nuevas de `tournaments` nacen con `public_visible = 0`. Nada aparece en la web sin que un organizador lo publique.

### 6.2 Damas (discontinuado, sin borrar)

- Ajuste `active_genders = ["M"]`.
- **Se oculta:**
  - en la web pública: rankings, torneos y buscador;
  - en los formularios de alta: nuevas categorías, jugadores y torneos de Damas.
- **Se conserva:**
  - las categorías, jugadores, torneos, acreditaciones y movimientos existentes;
  - los rankings históricos, visibles en el panel;
  - las correcciones de torneos históricos de Damas, que se podrán hacer si alguna vez hace falta;
  - el motor de puntuación, que no cambia.
- Es reversible: volver a habilitar Damas es un cambio de ajuste.

### 6.3 Contenido de la web anterior (Google Sites)

| Contenido | Cómo se migra |
|---|---|
| Reglamento y textos de la portada | Se copian como páginas del CMS. Son textos de Padel Time y se transcriben sin cambios. |
| Fixtures, resultados, tablas y rankings **2025** (imágenes) | **Archivo histórico.** Las imágenes originales se suben a la galería de cada torneo 2025, con autorización del dueño del sitio, sin reinterpretarlas. Volver a tipear partidos ya jugados no tiene sentido. |
| Rankings **2026** vigentes | Desde las **planillas originales** (las imágenes salen de planillas de Google), con el importador de Excel ya existente. Si no hay planillas, se reconstruyen con un ajuste inicial por jugador, como en la Fase 4. |
| Torneos 2026 en curso (Paris Major 2000, …) | Se cargan como torneos con fixture a partir de la Fase 9. Mientras tanto, siguen en Google Sites. |
| Flyers e imágenes de la portada | Se suben a la galería con autorización. |
| Google Forms y mapa | Se reemplazan por formulario propio y bloque de mapa. Las respuestas viejas quedan en la cuenta de Google del dueño. |

### 6.4 Cambio de dominio (al final, con autorización)

1. La nueva web se prueba completa en `padel-time.<subdominio>.workers.dev`, mientras Google Sites sigue siendo la web oficial.
2. **Tabla de redirecciones:** las 268 direcciones de Google Sites (el inventario CSV) se redirigen con código 301 a su equivalente nuevo, para no perder enlaces compartidos ni posicionamiento en Google. Ejemplo: `/rankings-2026/caballeros-2026/c6` → `/rankings/2026/c6`.
3. **Sólo con autorización explícita del dueño del dominio:** mover los DNS de `padeltime.com.ar` a Cloudflare (gratis) y asociar el dominio al Worker. Antes, se anotan los registros actuales (correo incluido, si lo hubiera) para no cortar nada.
4. El sitio de Google se conserva sin publicar durante un tiempo, como respaldo.

---

## 7. Riesgos técnicos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| 1 | **Límite de 100.000 solicitudes por día** ante un pico de visitas públicas | Baja | Alto (la web dejaría de responder hasta las 21:00) | Caché en Cloudflare con dominio propio, `ETag`/304, imágenes con caché larga, páginas livianas sin JavaScript. Monitorear con las métricas gratuitas del panel de Cloudflare. |
| 2 | **Almacenamiento de imágenes** (D1 500 MB, KV 1 GB, R2 con tarjeta) | Media | Medio | KV con compresión en el navegador y deduplicación por `sha256`. Interfaz de almacenamiento intercambiable para pasar a R2 si se decide. |
| 3 | **Respaldo de archivos de KV** (el respaldo `.sql` no los incluye) | Media | Medio | Exportación de la galería a `.zip` desde el panel (paginada) y `wrangler kv` documentado. Además, se conservan los originales que suben los organizadores. |
| 4 | **Mudar el panel a `/admin`** rompe marcadores y direcciones guardadas | Alta | Bajo | Redirecciones automáticas de las rutas viejas y pruebas de navegador de cada redirección. |
| 5 | **Inyección de código (XSS)** desde el CMS | Media | Alto | Bloques tipados validados con Zod, sin HTML libre, escape en todas las plantillas, CSP estricta y pruebas de escape (ya existe el patrón). |
| 6 | **Spam en formularios públicos** | Alta | Medio | Turnstile (gratis), límite por IP, campo trampa y moderación en el panel. |
| 7 | **Datos personales** de inscripciones y contacto | Media | Alto | Sólo en el panel, nunca en páginas públicas. Hash de IP en lugar de la IP. Política de privacidad. Borrado de mensajes viejos opcional. |
| 8 | **CPU de 10 ms** al calcular tablas o llaves de categorías grandes | Baja | Medio | Cálculo puro y eficiente, cacheado por versión. Medición en las pruebas. |
| 9 | **Fixtures con reglas particulares** (Master: 1.º A vs 4.º B; C6 dividida; empates) | Alta | Medio | Desempates configurables por fase. Generador de cruces con edición manual de cada partido. Pruebas con los formatos reales del reglamento. |
| 10 | **Conflictos de edición simultánea** de resultados de partidos | Media | Bajo | Control de versión por partido (rechazar si cambió desde que se abrió) y auditoría. |
| 11 | **Cambio de DNS** (posible corte de la web o del correo del dominio) | Baja | Alto | Inventario previo de registros, cambio en horario de bajo uso, Google Sites como plan B, y sólo con autorización. |
| 12 | **SEO:** pérdida de posicionamiento al cambiar direcciones | Media | Medio | Redirecciones 301 completas, `sitemap.xml`, títulos y descripciones por página. |
| 13 | **Contenido faltante** (Premios, Liga, Cancha abierta no existen hoy) | Alta | Medio | Las páginas se crean vacías en borrador. Los organizadores aportan los textos y nada vacío se publica. |
| 14 | **Dependencia de una sola cuenta** (Cloudflare, Google) | Media | Alto | Cuenta de Cloudflare con correo institucional y 2FA. Respaldos fuera de Cloudflare. |
| 15 | **Regresiones** en lo que ya funciona | Media | Alto | Ningún módulo nuevo modifica el motor de puntuación. Las 172 + 26 pruebas corren en cada fase y se suman pruebas nuevas por módulo. |

---

## 8. Plan detallado de las Fases 7 a 11

Cada fase:

- se hace en su rama;
- arranca con un punto de restauración (etiqueta);
- ejecuta las pruebas existentes antes y después;
- termina con documentación y un informe;
- **no se despliega sin autorización.**

### Fase 7 · Fundaciones de la web pública

Objetivo: tener la estructura de la web oficial funcionando con contenido fijo, sin CMS todavía.

1. **Reparto de rutas:**
   - panel a `/admin` (con `basename` de React Router y redirecciones desde las rutas viejas);
   - web pública en la raíz;
   - `/publico/*`, que sigue funcionando y redirige a las rutas nuevas.
2. **Base de la web pública** sobre `worker/public`:
   - layout con menú, pie, aviso destacado, enlaces a WhatsApp e Instagram;
   - versión de celular con menú desplegable;
   - CSP propia, `sitemap.xml` y `robots.txt` para la web pública (el panel sigue `noindex`).
3. **`active_genders` = M:** Damas oculta en la web pública y en los formularios de alta. Pruebas de que los datos históricos y el ranking interno siguen intactos.
4. **Páginas con contenido real ya disponible:**
   - inicio con próximos torneos y rankings destacados;
   - rankings integrados, reutilizando `/publico`;
   - reglamentos (texto actual);
   - sede con mapa;
   - contacto con enlaces a WhatsApp e Instagram.
5. **Migración 0005:** `site_settings` sobre `app_settings`, columnas públicas de `tournaments` (`slug`, `series`, `format`, `public_visible`…).
6. **Pruebas:** rutas, redirecciones, ocultamiento de Damas, celular sin desbordes, escape, caché.

### Fase 8 · Gestor de contenidos (CMS)

1. Migración 0006: `pages`, `page_revisions`, `menu_items`, `posts`, `media`, `events`.
2. **Almacenamiento de archivos en KV** (binding nuevo, gratis), detrás de una interfaz `MediaStore`. Ruta `/media/:id` con caché larga y tipos de archivo permitidos.
3. **Editor de páginas por bloques** en el panel: agregar, reordenar, vista previa, borrador o publicada, historial de versiones y volver atrás.
4. **Biblioteca de medios:**
   - subida con compresión y redimensionado en el navegador;
   - texto alternativo obligatorio para imágenes;
   - documentos PDF (reglamentos);
   - detección de duplicados.
5. **Novedades** (con portada, destacado y torneo asociado), **menú editable**, **aviso destacado** con vigencia y **calendario de eventos manuales**.
6. Rol **`editor`** (sólo contenidos) y auditoría de cada publicación.
7. Seguridad: validación Zod de bloques, escape y pruebas de inyección. Las tablas nuevas entran en el respaldo; exportación de la galería.

### Fase 9 · Torneos públicos y fixtures de torneos largos

1. Migración 0007: `tournament_phases`, `phase_groups`, `group_teams`, `matches`.
2. **Motor puro de fixtures** en `shared/`, con pruebas exhaustivas:
   - todos contra todos (con fechas y horarios por día de la categoría);
   - tablas de posiciones con desempates configurables;
   - Copa de Oro y Copa de Plata (llaves de eliminación directa);
   - cruces del Master (1.º A vs 4.º B, 2.º vs 3.º);
   - subdivisiones (C6 1 / C6 2).
3. **Panel:**
   - armado de grupos;
   - generación del fixture con edición manual;
   - carga de resultados por partido (sets), también desde el celular;
   - w.o. y suspendidos;
   - control de edición simultánea.
4. **Cierre del torneo:** traducción automática de la fase alcanzada a la instancia de puntuación y paso a la **acreditación existente** (previsualizar → confirmar). El motor no se modifica.
5. **Web pública:**
   - página de cada torneo con pestañas por categoría (fixture, resultados, tabla, copas);
   - "fecha de hoy";
   - calendario automático;
   - Satélites/Americanos con su resultado final (módulo actual, sin fixture).
6. Pruebas con los formatos reales del reglamento: Open 1000, Challenger 500, Master Final 2000.

### Fase 10 · Inscripciones, contacto, histórico y redirecciones

1. Migración 0008: `registrations`, `contact_messages`.
2. **Formularios públicos:**
   - inscripción por torneo y categoría (pareja, teléfonos, comentarios);
   - contacto;
   - antispam con Turnstile, límite por IP, campo trampa y aviso de privacidad.
3. **Bandeja en el panel:** confirmar, poner en espera o rechazar; vincular con jugadores; crear la pareja en el torneo con un clic; exportar a Excel.
4. **Avisos a los organizadores:** contador en el panel. Decidir si además se usa correo (Email Routing de Cloudflare, gratis hacia direcciones verificadas y con el dominio en Cloudflare) o se mantiene WhatsApp.
5. **Histórico 2025:** galerías de imágenes por torneo, con autorización. **Rankings 2026:** desde las planillas originales con el importador existente.
6. **Redirecciones 301** de las 268 direcciones de Google Sites, generadas desde el inventario CSV y con prueba automática de cada una.
7. **SEO:** títulos, descripciones, Open Graph para compartir en WhatsApp e Instagram, y `sitemap.xml` completo.

### Fase 11 · Calidad, carga de contenido y salida a producción

1. **Auditoría integral:** seguridad (cabeceras, permisos por rol, inyección, formularios), accesibilidad (contraste, teclado, textos alternativos), rendimiento (peso de páginas, Lighthouse en celular) y pruebas de punta a punta de todos los flujos.
2. **Carga de contenido real** con los organizadores: textos de Premios, Liga y Cancha abierta, imágenes, torneos en curso.
3. **Ensayo de recuperación:** restaurar base y galería en un entorno de prueba.
4. **Manual de operación ampliado:** contenidos, fixtures e inscripciones.
5. **Salida a producción, sólo con autorización:**
   - despliegue;
   - pruebas en `workers.dev`;
   - inventario de DNS;
   - cambio de dominio;
   - verificación de redirecciones;
   - Google Sites archivado como plan B.
6. Seguimiento de las primeras semanas: uso de solicitudes, errores y espacio en KV.

---

## 9. Preparación técnica hecha en esta fase

Sólo lo indispensable y sin cambios visibles:

| Cambio | Motivo |
|---|---|
| Etiqueta `v5b-estable` y rama `fase6-web-oficial` | Punto de restauración y trabajo aislado. |
| `e2e/circuit.ts` y `e2e/phase2.spec.ts`: `getByLabel("Puntos", { exact: true })` | La prueba del circuito en celular fallaba de forma intermitente por un selector ambiguo. Defecto de la prueba, no de la app. |
| README y `docs/DESPLIEGUE.md`: D1 gratis = **500 MB por base** (antes decía 5 GB) | Dato corregido con la documentación oficial vigente. Es clave para decidir dónde guardar imágenes. |
| `docs/WEB_OFICIAL.md`, `docs/web-anterior/INVENTARIO.md`, `docs/web-anterior/inventario-paginas.csv` | Entregables de la fase. |

No hay migraciones nuevas ni cambios en el código de la app: el esquema y el comportamiento son idénticos a la Fase 5B.

## 10. Decisiones pendientes para los organizadores

1. **Almacenamiento de imágenes:**
   - **KV** (1 GB, sin tarjeta), recomendado para empezar;
   - **R2** (10 GB, requiere registrar una tarjeta en Cloudflare aunque no se cobre dentro del límite).
2. **Avisos de inscripción:** sólo en el panel, por correo (requiere el dominio en Cloudflare) o por WhatsApp manual.
3. **Contenido de Premios, Liga y Cancha abierta:** hoy no existe en la web; hay que redactarlo.
4. **Planillas originales** de los rankings y fixtures 2026: con ellas, la migración es exacta.
5. **Autorización y acceso** para usar las imágenes de Google Sites y, al final, para cambiar los DNS del dominio.
