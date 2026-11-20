# Padel Time

Aplicación web para gestionar los torneos y rankings de Padel Time: jugadores, categorías y divisiones, temporadas y torneos (largos y americanos). La usan sólo los organizadores, desde la compu o el celular, y los datos quedan centralizados en la nube.

**Costo operativo mensual: USD 0.** Corre íntegramente en el plan gratuito de Cloudflare (Workers + D1 + Static Assets), sin servicios pagos.

> Estado: **Fase 4 (migración de rankings existentes y publicación web)**.

---

## Funcionalidades de la Fase 1

| Módulo | Qué hace |
|---|---|
| **Autenticación** | Ingreso con usuario y contraseña, sin registro público. Sesiones seguras con cookie HttpOnly, bloqueo por intentos fallidos y cambio de contraseña. |
| **Usuarios** | Los administradores crean, editan y desactivan organizadores y les resetean la contraseña. |
| **Panel** | Jugadores activos por rama, avance de la temporada activa, torneos en curso y próximos, jugadores por categoría y actividad reciente. |
| **Jugadores** | Alta, edición, búsqueda (sin importar acentos ni mayúsculas, también por DNI o código), filtros, desactivación y reactivación. Cada jugador tiene un **código interno único** (`J-00001`), así que se admiten homónimos y el sistema avisa cuando ya existe alguien con el mismo nombre. Historial de cambios de categoría (alta, ascenso, descenso, manual). |
| **Categorías y divisiones** | Categorías independientes para Caballeros y Damas, ordenadas por nivel, con divisiones opcionales (A/B, Oro/Plata…). |
| **Temporadas** | Temporadas anuales con estados *planificada → activa → cerrada*. Sólo puede haber una activa. Una temporada cerrada queda de sólo lectura. |
| **Torneos** | Nombre, tipo (largo/americano), temporada, categoría, división, fechas, sede y estado (*programado, en curso, finalizado, cancelado*) con transiciones controladas. |

### Fase 2: puntuación y rankings

| Módulo | Qué hace |
|---|---|
| **Plantillas de puntuación** | Tablas reutilizables con instancias (campeón, finalista, semifinal, cuartos, octavos y las que quieras agregar), puntos, cupo de parejas por instancia y bonificaciones opcionales (por participar, por partido jugado o ganado). Cada tipo de torneo puede tener una plantilla predeterminada. |
| **Puntuación por torneo** | Al crear un torneo se copia la plantilla de su tipo. Esa copia se puede editar sólo para ese torneo, o reemplazar por otra plantilla. Opción de reglamento acumulativo (suma de fases) para casos especiales. |
| **Parejas y resultados** | Inscripción de parejas con un buscador de jugadores (y alta de jugadores nuevos sin salir del formulario). Carga manual de la instancia final alcanzada y de los partidos jugados y ganados, con puntos calculados en vivo y control de cupos. Es la alternativa completa al reconocimiento automático de imágenes. |
| **Previsualización** | Antes de confirmar se ven todos los jugadores, la categoría principal donde suma cada uno, los puntos por instancia, la bonificación y el total. Los errores (parejas sin instancia, cupos excedidos, datos inconsistentes) impiden confirmar. |
| **Acreditación** | Sólo se acredita cuando un organizador confirma. Un torneo nunca se acredita dos veces. |
| **Correcciones** | Si cambian los resultados después de acreditar, se ven las diferencias por jugador y se confirma una corrección con motivo. Se reemplaza la versión anterior y queda todo el historial. |
| **Reversión y anulación** | Revertir deja los puntos del torneo en cero; anular además cancela el torneo. Los ajustes manuales (bonificaciones o sanciones con motivo) también se pueden anular. |
| **Rankings** | Por temporada, categoría principal y división, con reglas de desempate configurables por temporada. Los empates que persisten comparten posición. Cada temporada arranca de cero y las anteriores se conservan. |
| **Historial de puntos** | En la ficha de cada jugador: totales por temporada y categoría, y todos sus movimientos. |
| **Registro de movimientos** | El libro completo de puntos, inmutable y filtrable, para auditoría. |
| **Exportación** | Ranking actual en CSV o Excel, o la temporada completa en un Excel con una hoja por categoría. |

### Fase 3: importación de cuadros por imagen

| Módulo | Qué hace |
|---|---|
| **Importar cuadro** | Se sube una captura o foto del cuadro (desde la compu o el celular). Se puede rotar, enderezar, recortar y ajustar el contraste. |
| **Reconocimiento gratuito** | Tesseract.js corre en el navegador, sin APIs pagas y sin enviar la imagen a ningún servidor. Detecta la estructura del cuadro por colores, lee nombres, resultados e indicadores celda por celda, y endereza y normaliza la imagen automáticamente. |
| **Interpretación** | Identifica rondas, parejas que avanzan y ganadores, combinando resultado, avance de ronda e indicador. Deduce la instancia final de cada pareja (y los partidos jugados y ganados) sin exigir cargar partido por partido. Detecta ambigüedades, duplicados e inconsistencias y nunca inventa datos ilegibles. |
| **Revisión** | Todo es editable, con la miniatura de la imagen original junto a cada dato y la interpretación recalculada en vivo. Se puede armar el cuadro a mano si la imagen no sirve. |
| **Jugadores** | Vinculación con jugadores existentes por normalización y coincidencia aproximada (acentos, diminutivos, errores de OCR). Los desconocidos se proponen para crear y sólo se crean con confirmación. |
| **Confirmación** | Lista completa de jugadores, instancias y puntos antes de importar. Importar guarda parejas e instancias y deja un registro auditable; **no acredita puntos**: eso sigue requiriendo la confirmación en Acreditación. |

Hay más detalle, con resultados medidos y limitaciones, en [`docs/OCR.md`](docs/OCR.md).

### Fase 4: migración de rankings y publicación web

| Módulo | Qué hace |
|---|---|
| **Importar rankings** | Lee Excel (.xlsx, también los descargados de Google Sheets) y CSV en el navegador: detecta separador, codificación, fila de títulos y hojas. Si cada hoja es una categoría, importa varias a la vez. |
| **Asistente de mapeo** | Sugiere qué columna es jugador (o nombre y apellido), puntos, categoría, división, temporada y posición. Categoría, división y temporada pueden salir de una columna, del nombre de la hoja o elegirse una vez para todo el archivo. Reconoce “C6”, “6ta”, “Sexta” o “6°”, y años como “2025”. Si hay columnas por torneo, usa la del total. |
| **Normalización y duplicados** | Cruza los nombres con los jugadores registrados sin importar acentos, mayúsculas, el formato “Apellido, Nombre” ni diminutivos. Señala homónimos (hay que elegir), nombres casi iguales dentro del archivo y un mismo jugador dos veces en un ranking. Los no registrados se proponen para crear. |
| **Vista previa y confirmación** | La base verifica todo antes de guardar: rankings afectados, puntos ya cargados, temporadas cerradas, jugadores en otra categoría y homónimos. Muestra la lista completa y la importación requiere confirmar explícitamente. |
| **Saldo inicial importado** | Cada fila se registra en el libro de movimientos como “Saldo inicial importado”. No se crean torneos ni resultados históricos. En el ranking aparece en su propia columna. |
| **Sin duplicar y reversible** | Un mismo archivo, o el mismo contenido en otro formato, no se puede importar dos veces, ni un jugador recibir dos saldos en el mismo ranking (lo garantiza un índice único en la base). Cada importación se revierte completa con contraasientos, motivo y registro de auditoría. |
| **Páginas públicas** | `/publico`: rankings por temporada, categoría y división; buscador de jugadores e historial torneo por torneo. Son de sólo lectura, funcionan en el celular, usan modo incrustado (`?embed=1`) y permiten descargar en Excel/CSV. No exponen datos privados. |
| **Actualización automática** | La vista pública se regenera sola al acreditar, corregir, revertir o importar. Usa una caché versionada por triggers y no hace falta tocar Google Sites. |
| **Publicación web** | Panel con el enlace de cada ranking (incluido “temporada vigente”, que pasa solo de año), código para incrustar, instrucciones y configuración. |

La integración con Google Sites está explicada paso a paso en [`docs/PUBLICACION.md`](docs/PUBLICACION.md).

---

## Stack

- **Frontend:** React 19 + TypeScript + Vite 8 + Tailwind CSS 4, React Router, TanStack Query.
- **Backend:** Cloudflare Worker con [Hono](https://hono.dev) y validación con Zod. Los schemas se comparten con el frontend.
- **Base de datos:** Cloudflare D1 (SQLite) con migraciones versionadas.
- **OCR:** Tesseract.js 7 (WebAssembly en el navegador) con el modelo de español, servido desde el propio sitio.
- **Pruebas:** Vitest dentro del runtime real de Workers (`@cloudflare/vitest-plugin`) y Playwright para E2E.

Hay más detalle en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## Desarrollo local

Requisitos: Node.js 20 o superior.

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run db:seed:local
```

```bash
npm run user:create -- --username admin --name "Tu Nombre"
```

```bash
npm run dev
```

El tercer comando (datos de demostración) es opcional y se corre **una sola vez**: si lo repetís, da `UNIQUE constraint failed` porque los datos ya están cargados (no rompe nada). El cuarto pide la contraseña por consola, con un mínimo de 10 caracteres. Después abrí http://localhost:5173. Vite levanta el frontend y el Worker juntos, con una base D1 local en `.wrangler/state`.

### Actualizar una instalación existente

Cada fase agrega migraciones (`migrations/0002_…`, `0003_…`, `0004_…`). Sobre la carpeta actualizada corré:

```bash
npm install
```

```bash
npm run db:migrate:local
```

Tus jugadores, torneos y usuarios se conservan. `npm install` también copia a `public/ocr` los archivos del reconocimiento de imágenes (≈14 MB, no se versionan). Los torneos creados antes de la Fase 2 no tienen puntuación: abrí el torneo, entrá a **Puntuación** y aplicá una plantilla. En producción, la migración se aplica con `npm run db:migrate:remote`, o automáticamente con `npm run deploy`.

### Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Entorno de desarrollo (frontend + API + D1 local). |
| `npm run build` | Typecheck y build de producción. |
| `npm run preview` | Sirve el build de producción localmente con el runtime de Workers. |
| `npm test` | Tests unitarios y de integración (motor de puntuación, API, exportación, importación de rankings, páginas públicas). Corren en workerd con D1 real. |
| `npm run test:e2e` | Pruebas E2E con Playwright, en escritorio y celular, sobre una base aislada. Incluye el reconocimiento de la imagen de referencia y deja el reporte de precisión en `test-results/ocr-reporte.json`. |
| `npm run typecheck` | Verificación de tipos de todo el proyecto. |
| `npm run user:create -- …` | Crea un organizador o resetea su contraseña (ver más abajo). |
| `npm run db:migrate:local` / `db:migrate:remote` | Aplica migraciones a la base local o a producción. |
| `npm run cf-typegen` | Regenera los tipos de bindings del Worker. |

---

## Despliegue en Cloudflare (gratis)

1. Creá una cuenta gratuita en Cloudflare e iniciá sesión desde la terminal:
   ```bash
   npx wrangler login
   ```
2. Creá la base D1:
   ```bash
   npx wrangler d1 create padel-time
   ```
   Copiá el `database_id` que devuelve y pegalo en `wrangler.jsonc`, en lugar de `00000000-0000-0000-0000-000000000000`.
3. Hacé build, aplicá las migraciones en producción y publicá:
   ```bash
   npm run deploy
   ```
   La app queda en `https://padel-time.<tu-subdominio>.workers.dev`.
4. Creá el primer administrador en la base de producción:
   ```bash
   npm run user:create -- --username admin --name "Tu Nombre" --remote
   ```
5. Ingresá a la app y creá desde **Usuarios** las cuentas del resto de los organizadores.

### Gestión de usuarios desde la terminal

```bash
npm run user:create -- --username lucia --name "Lucía Gómez" --role organizador --remote
```

```bash
npm run user:create -- --username admin --reset --remote
```

El segundo comando resetea la contraseña de un usuario existente: también cierra sus sesiones y lo desbloquea. Para usarlo sin interacción, la contraseña se puede pasar en la variable `PADEL_PASSWORD`.

---

## Límites del plan gratuito (verificados en noviembre de 2026)

| Recurso | Límite gratuito | Uso esperado de Padel Time |
|---|---|---|
| Requests al Worker | 100.000/día | Cuentan las llamadas a `/api/*` y las visitas a las páginas públicas `/publico/*`. 2 o 3 organizadores generan unos cientos por día; cada visita pública suma 1. |
| Assets estáticos (la SPA) | Ilimitados y gratis | El frontend no consume requests del Worker. |
| CPU por request | 10 ms | Las consultas a D1 no cuentan como CPU. El hash de contraseñas está calibrado en ~6 ms (ver Seguridad). |
| D1 lecturas | 5 millones de filas/día | Muy por debajo. Una página pública en caché cuesta 2 lecturas. |
| D1 escrituras | 100.000 filas/día | Muy por debajo. Las sesiones se refrescan como máximo cada 12 h para ahorrar escrituras. |
| D1 almacenamiento | 5 GB | Años de datos ocupan pocos MB. |
| D1 consultas por request | 50 (y 100 parámetros por consulta) | Las acreditaciones, correcciones y cargas masivas usan una sola sentencia con `json_each`, sin importar el tamaño del torneo. Ninguna operación supera las ~15 consultas. |
| Tamaño del Worker | 3 MB | ~110 KB comprimido. |
| Assets estáticos | 25 MB por archivo, 20.000 archivos | 20 archivos; el mayor (motor de OCR) pesa ≈4 MB. El OCR no consume CPU del Worker: corre en el navegador. |

Si se supera un límite diario, Cloudflare **bloquea temporalmente** las operaciones hasta las 00:00 UTC. **No genera cargos**: el plan gratuito no tiene facturación por excedente.

---

## Seguridad

- **Sin registro público.** Las cuentas sólo las crea un administrador, desde la app o con el script de terminal.
- **Contraseñas:** PBKDF2-SHA256 con sal aleatoria por usuario, comparación en tiempo constante y un mínimo de 10 caracteres. Se usan 30.000 iteraciones para no exceder los 10 ms de CPU del plan gratuito (100.000 iteraciones tardaban ~20 ms y podían provocar el error 1102). Las iteraciones quedan guardadas en cada hash: si se pasa a un plan pago, alcanza con subir `PBKDF2_ITERATIONS` en `wrangler.jsonc` y cada hash se actualiza en el siguiente ingreso.
- **Fuerza bruta:** 5 intentos fallidos en 15 minutos bloquean el usuario y la IP durante 15 minutos. Los mensajes de error no revelan si el usuario existe.
- **Sesiones:** token aleatorio de 256 bits en una cookie `HttpOnly`, `Secure`, `SameSite=Strict` con prefijo `__Host-`. En la base se guarda sólo su SHA-256. Vencen tras 30 días sin uso. Cambiar la contraseña o desactivar un usuario cierra sus sesiones.
- **CSRF:** las operaciones de escritura exigen el mismo `Origin` y `Content-Type: application/json`, además de la cookie SameSite.
- **Cabeceras:** CSP estricta (`'wasm-unsafe-eval'` sólo para compilar el WebAssembly del OCR; sin scripts externos), `X-Frame-Options: DENY`, `nosniff`, `noindex`, y `no-store` en la API.
- **Vista pública:** `/publico/*` es una app aparte del panel. No lee cookies ni sesiones y sólo consulta datos publicables (nunca DNI, teléfono, email, notas ni motivos de ajustes). Escapa todo el HTML. Sólo permite que la incrusten Google Sites y el dominio propio (`frame-ancestors`, configurable en `PUBLIC_FRAME_ANCESTORS`). El buscador ignora términos con números para que no se pueda consultar por documento.
- **SQL:** todas las consultas son parametrizadas.

---

## Estructura

```
padel-time/
├── migrations/          Migraciones SQL de D1 (esquema versionado)
├── shared/              Código compartido front/back: constantes, schemas Zod, tipos, motor de puntuación (scoring.ts),
│                        nombres (names.ts), exportación CSV/XLSX (export.ts, rankingExport.ts)
├── worker/              API (Cloudflare Worker + Hono)
│   ├── app.ts           Middlewares (seguridad, CSRF, sesión) y montaje de rutas
│   ├── lib/             Contraseñas, sesiones, rate limit, errores, validación, auditoría, configuración pública
│   └── routes/          auth, users, categories, players, seasons, tournaments, dashboard,
│   │                    scoring (plantillas), teams, credits, rankings, movements, imports (cuadros),
│   │                    rankingImports (saldos iniciales), publication
│   └── public/          Vista pública de sólo lectura (/publico): datos, HTML con escape, caché versionada
├── src/                 Frontend React
│   ├── rankingImport/   Lectura de Excel/CSV (parse) y lógica del asistente de mapeo (mapping)
│   ├── ocr/             Reconocimiento: preprocesamiento (image), estructura (layout), Tesseract (recognize), interpretación (bracket)
│   ├── auth/            Contexto de sesión
│   ├── components/      UI reutilizable, layout y formularios
│   ├── hooks/ lib/      Datos (TanStack Query), cliente HTTP, formato es-AR, formularios
│   └── pages/           Pantallas (tournament/ = torneo y sus pestañas; tournament/import/ = cuadros; rankingImport/ = importar rankings)
├── public/              Favicon, manifest, _headers (CSP), robots.txt, pub/publico.js (filtro de la vista pública)
├── test/                Tests unitarios y de integración (Vitest + workerd + D1); fixtures/ = imagen de referencia y su lectura
├── e2e/                 Pruebas end-to-end (Playwright); fixtures/ = planilla de ranking de ejemplo
├── scripts/             create-user.mjs, copy-ocr-assets.mjs
├── seed/                Datos de demostración para desarrollo
└── docs/                ARQUITECTURA.md, OCR.md, PUBLICACION.md (Google Sites)
```
