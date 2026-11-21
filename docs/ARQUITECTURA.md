# Arquitectura de Padel Time

## 1. Visión general

```
             Navegador (compu / celular)
                       │  HTTPS
                       ▼
      ┌─────────────── Cloudflare Worker "padel-time" ───────────────┐
      │                                                               │
      │  /*         → Static Assets (SPA React)   gratis, ilimitado   │
      │               (fallback a index.html para rutas del cliente)  │
      │                                                               │
      │  /api/*     → Worker (Hono)                                   │
      │               ├─ cabeceras de seguridad                       │
      │               ├─ chequeo de Origin (CSRF)                     │
      │               ├─ /api/auth/*  (login público)                 │
      │               ├─ sesión obligatoria para el resto             │
      │               └─ rutas de dominio ──────────────► D1 (SQLite) │
      └───────────────────────────────────────────────────────────────┘
```

Es un único Worker con **Static Assets** y `run_worker_first: ["/api/*"]`. Las pantallas de la SPA se sirven como assets gratuitos sin ejecutar el Worker, así que sólo las llamadas a la API consumen la cuota de 100.000 requests/día.

### Por qué esta arquitectura

| Decisión | Motivo |
|---|---|
| Worker único (assets + API) en lugar de Pages + Worker | Cloudflare recomienda Workers con Static Assets para proyectos nuevos. Un solo deploy, un solo dominio y cookies del mismo origen (no hace falta CORS). |
| Hono | Router liviano, pensado para Workers, con buen soporte de TypeScript. |
| Zod compartido en `shared/` | Las mismas reglas validan en el formulario y en la API. Los errores por campo vuelven del servidor con la misma forma. |
| D1 | SQL relacional con claves foráneas, transacciones (`batch`) y migraciones, todo gratis. Ideal para datos con integridad referencial como rankings. |
| TanStack Query | Caché, reintentos e invalidación de datos entre pantallas, para que los organizadores vean siempre datos frescos. |
| Sin ORM | Consultas SQL explícitas y parametrizadas. Menos peso en el Worker y control total del rendimiento. |

## 2. Modelo de datos

```
users ─┬─< sessions
       ├─< audit_log
       └─(created_by en varias tablas)

categories (gender M/F, level) ─┬─< divisions
                                ├─< players.main_category_id
                                └─< tournaments.category_id

players ─┬─< player_category_changes >── seasons
         └─< tournament_team_players

seasons ─< tournaments ─┬─< tournament_teams ─< tournament_team_players
                        └── divisions (opcional)
```

### Tablas de la Fase 1

| Tabla | Propósito |
|---|---|
| `users` | Organizadores (roles `admin` y `organizador`). |
| `sessions` | Sesiones activas. Guarda el SHA-256 del token. |
| `login_attempts` | Contadores para bloquear la fuerza bruta. |
| `audit_log` | Quién hizo qué y cuándo. Alimenta la "Actividad reciente". |
| `categories` | Categorías por rama (`M` caballeros, `F` damas). `level` ordena: 1 es la más alta. |
| `divisions` | Subdivisiones opcionales de una categoría. |
| `players` | Jugadores. `id` interno inmutable (`AUTOINCREMENT`: nunca se reutiliza). `code` legible `J-00001`, generado por trigger. `search_text` normalizado sin acentos para la búsqueda. `document_number` es único si se carga. |
| `player_category_changes` | Historial de categoría principal: alta, ascenso, descenso o cambio manual, con temporada, motivo y autor. |
| `seasons` | Temporadas anuales. Un índice único parcial garantiza **una sola temporada activa**. |
| `tournaments` | Torneos. `CHECK` en la base: un americano dura un solo día y la fecha de fin no puede ser anterior a la de inicio. |

### Preparado para las fases siguientes

- **Parejas fijas por torneo:** `tournament_teams` y `tournament_team_players` ya existen. `UNIQUE (tournament_id, player_id)` impide que un jugador figure dos veces en un torneo.
- **Puntos en la categoría principal:** al inscribirse se congela `ranking_category_id` con la categoría principal del jugador en ese momento. Así suma puntos en su ranking aunque juegue en otra categoría, y el dato histórico no cambia si después asciende.
- **Resultados y posiciones:** `tournament_teams.final_position` ya está previsto. Partidos, cuadros, tablas de puntos y rankings se agregarán con nuevas migraciones (`0002_…`) que referencian estas tablas.
- **Movimientos:** `player_category_changes` ya registra ascensos y descensos, con tipo y temporada.

### Reglas de integridad

- Los jugadores, categorías y usuarios **no se borran**: se desactivan. Se conserva la historia.
- Sólo se pueden eliminar registros nunca usados, para corregir errores de carga: una categoría sin jugadores ni torneos, una temporada sin torneos, un torneo programado o cancelado sin parejas.
- No se puede desactivar una categoría que es la principal de jugadores activos.
- La categoría principal de un jugador debe ser de su misma rama.
- Las fechas de un torneo deben caer dentro de su temporada. Las temporadas cerradas son de sólo lectura.
- Transiciones de estado de un torneo:
  `programado → en curso | cancelado`, `en curso → finalizado | programado | cancelado`, `finalizado → en curso` (reabrir), `cancelado → programado` (reprogramar).

## 2 bis. Motor de puntuación (Fase 2)

### Principio: un registro de movimientos como única fuente de verdad

```
 resultados de parejas ──► previsualización (shared/scoring.ts) ──► confirmación del organizador
                                                                       │  db.batch() atómico
                                                                       ▼
                    tournament_credits (versión N, "vigente")  +  point_movements (acreditación)
                                                                       │
            rankings  =  SUM(point_movements.points)  agrupado por temporada · categoría · jugador
```

- **`point_movements` es solo-agregar.** Dos triggers (`trg_movements_immutable_update/delete`) abortan cualquier `UPDATE` o `DELETE`. No existen totales guardados ni editables: cada ranking se calcula sumando movimientos.
- **Tipos de movimiento:** `acreditacion`, `reversion` (contraasiento de una acreditación), `ajuste` (manual, con motivo obligatorio) y `anulacion_ajuste`.
- **Contraasientos:** corregir o revertir nunca modifica lo registrado. Se inserta un movimiento con los puntos opuestos que apunta al original (`reverses_movement_id`, `UNIQUE`: nada se revierte dos veces).
- **`tournament_credits`:** cada confirmación crea una versión. Un índice único parcial (`WHERE status = 'vigente'`) garantiza **una sola acreditación vigente por torneo**, también frente a confirmaciones simultáneas.

### Flujos y garantías

| Operación | Sentencias del `batch` (todas o ninguna) | Garantías |
|---|---|---|
| **Acreditar** | crear la versión vigente · insertar todos los movimientos (una sentencia con `json_each`) · registrar la categoría acreditada en la inscripción · finalizar el torneo · auditoría | La huella SHA-256 de la previsualización que vio el organizador debe coincidir con los datos actuales (si algo cambió, se rechaza con 409). Con resultados idénticos a la versión vigente se rechaza: no hay doble acreditación. |
| **Corregir** | versión anterior → `reemplazada` (con motivo) · contraasiento de todos sus movimientos · nueva versión vigente · nuevos movimientos · auditoría | Motivo obligatorio. Se muestran las diferencias por jugador antes de confirmar. |
| **Revertir / anular** | versión → `revertida` · contraasiento · (anular: torneo → `cancelado`) · auditoría | Los puntos del torneo vuelven a cero. Se puede volver a acreditar (versión N+1). |
| **Ajuste manual** | movimiento `ajuste` · auditoría | Motivo obligatorio. Se acredita en la categoría principal actual. |
| **Anular ajuste** | movimiento `anulacion_ajuste` · auditoría | Sólo una vez por ajuste. |

Si dos organizadores confirman a la vez, el segundo `INSERT` de una versión vigente choca con el índice único y D1 deshace todo su `batch`. Los tests lo verifican con tres confirmaciones simultáneas.

### Reglas de cálculo (`shared/scoring.ts`, funciones puras y testeadas)

- **Misma puntuación para ambos integrantes:** se calcula por pareja y se replica a cada jugador.
- **Categoría principal:** cada movimiento se registra en la categoría principal del jugador **al momento de acreditar**. Si después cambia de categoría, lo ya acreditado queda donde estaba; las acreditaciones futuras van a la nueva.
- **Instancia final, sin sumar fases:** el campeón recibe los puntos de campeón. Sólo con `cumulative = 1` (reglamento especial explícito) se suman la instancia y todas las anteriores.
- **Bonificaciones opcionales:** por participar, por partido jugado y por partido ganado. Se aplican sólo si la pareja tiene una instancia cargada.
- **Validaciones que bloquean la confirmación:** pareja sin instancia o incompleta, cupo de una instancia excedido, partidos ganados mayores que jugados, jugador repetido o de otra rama.
- **Advertencias que no bloquean:** no hay campeón, hay jugadores inactivos.
- **División:** el movimiento lleva la división del torneo sólo si el torneo es de la misma categoría que la principal del jugador. El ranking por división filtra esos movimientos; los ajustes manuales cuentan sólo en el ranking general de la categoría.

### Rankings y desempates

- Puntos = suma de **todos** los movimientos de la temporada y la categoría. Las estadísticas de desempate (torneos, títulos, finales, semifinales, mejor torneo, partidos ganados) se calculan sólo sobre acreditaciones **vigentes**.
- Los criterios se configuran por temporada (`seasons.tiebreakers`, un arreglo JSON ordenado). Si después de aplicarlos todos sigue el empate, los jugadores comparten posición (formato 1, 2, 2, 4).
- Cada temporada arranca en cero porque los movimientos están ligados a una temporada. Las cerradas quedan de sólo lectura con su ranking intacto.

### Límites de D1 en el plan gratuito

Máximo 50 consultas por request y 100 parámetros por consulta. Todas las escrituras masivas (movimientos, contraasientos, carga de resultados, instancias) reciben los datos como **un único parámetro JSON** procesado con `json_each`. Así un torneo de 40 parejas (80 jugadores) se acredita con las mismas pocas sentencias que uno de 2; hay un test que lo verifica.

### Exportación

CSV (separador `;`, BOM UTF-8, protección contra inyección de fórmulas) y XLSX (Office Open XML, generado en el navegador con `fflate`: encabezado destacado, filtros, fila fija y una hoja por categoría). Se genera del lado del cliente para no consumir CPU del Worker.

## 2 ter. Importación de cuadros por imagen (Fase 3)

```
 imagen ─► [navegador] enderezado ─► estructura por colores ─► Tesseract por celda ─► interpretación del cuadro
                                                                                          │ revisión y correcciones
                                                                                          ▼
                       vinculación de jugadores (coincidencia aproximada) ─► confirmación de la lista completa
                                                                                          │ POST /tournaments/:id/import
                                                                                          ▼
                              parejas + instancias (batch atómico) + bracket_imports (auditoría)
                                                                                          │ (paso aparte, Fase 2)
                                                                                          ▼
                                             previsualización ─► confirmación ─► acreditación de puntos
```

- Todo el reconocimiento corre en el navegador (`src/ocr`): no consume CPU del Worker y la imagen no sale del dispositivo.
- `POST /api/tournaments/:id/import` valida jugadores (activos, de la rama, sin repetir), instancias y conflictos, y guarda en un único batch: las parejas se insertan con una marca temporal para vincular a sus integrantes vía `json_each`, y la marca se borra en el mismo batch. **No crea acreditaciones ni movimientos**; un test de integración lo verifica.
- `GET /api/players/directory?gender=` devuelve el directorio compacto para la vinculación aproximada (`shared/names.ts`).
- Tabla `bracket_imports` (migración 0003): registro de cada importación con origen, modo de lectura, correcciones, jugadores creados y advertencias aceptadas.
- Funcionamiento detallado, resultados medidos y limitaciones: [`docs/OCR.md`](OCR.md).

## 2 quater. Rankings importados y publicación (Fase 4)

```
Excel/CSV ─► lectura en el navegador (src/rankingImport/parse) ─► mapeo de columnas y valores ─► cotejo de jugadores
                                                                     (src/rankingImport/mapping, shared/names)
        ─► POST /api/ranking-imports/preview (valida contra la base, no escribe)
        ─► POST /api/ranking-imports (un solo batch) ─► point_movements: 'ajuste' + balance_import_id = "Saldo inicial importado"
                                                     └► trigger: app_settings.public_version + 1 ─► /publico/* se regenera
```

- **Sin resultados inventados:** el saldo es un movimiento `ajuste` vinculado a `ranking_imports` (`balance_import_id`), sin torneo ni acreditación. Los rankings lo suman como cualquier movimiento y lo muestran aparte (`initialBalance`). Los desempates siguen usando sólo acreditaciones vigentes.
- **Anti-duplicación en tres niveles:**
  1. Índices únicos parciales sobre `ranking_imports.file_hash` y `content_hash` (el contenido normalizado, independiente del formato) mientras la importación está vigente.
  2. `initial_balances` con índice único `(temporada, categoría, división, jugador) WHERE active = 1`.
  3. Validaciones de la vista previa, que también se repiten al confirmar.
- **Transacción única:** jugadores nuevos (con `players.import_ref` temporal e indexado para vincularlos a sus filas, limpiado en el mismo batch), alta en el historial de categorías, saldos, movimientos y auditoría. Todo usa `json_each`, así que la cantidad de consultas no depende del tamaño del archivo (máximo 3000 filas por importación).
- **Reversión:** contraasientos `anulacion_ajuste` para todos los saldos, `initial_balances.active = 0` y estado `revertida`. Los saldos importados no se pueden anular de a uno desde el libro.
- **Vista pública (`worker/public`):** es una app Hono aparte, despachada en `worker/index.ts` para `/publico*` (`run_worker_first`).
  - HTML generado en el servidor con escape automático (`h`), sin cookies, con CSP propia (`frame-ancestors` para Google Sites) y sin `X-Frame-Options`.
  - Caché: clave = URL + `public_version`, en memoria del isolate y en la Cache API, con `ETag` y respuesta 304. Triggers sobre movimientos, acreditaciones, jugadores, categorías, divisiones, temporadas, torneos y configuración incrementan la versión: la web nunca muestra datos viejos.
- Detalle de la integración con Google Sites: [`docs/PUBLICACION.md`](PUBLICACION.md).

## 2 quinquies. Producción (Fase 5B)

- **Categoría acreditada:** `buildPreview` toma, para cada jugador que ya recibió puntos en la acreditación vigente, la categoría de ese movimiento y no la principal actual. Una corrección nunca muda puntos históricos de ranking. Si cambió, se muestra el aviso `categoria_acreditada`.
- **Historial protegido:** no se borran temporadas, categorías ni divisiones con `point_movements` o `initial_balances`. No se cambia la rama de un jugador con parejas o movimientos. Reabrir una temporada cerrada exige rol admin.
- **Respaldo (`/api/backup`, sólo admin):** `POST /start` devuelve conteos y registra la descarga en la auditoría. `GET /:tabla?after=<rowid>` devuelve páginas de 1000 filas de una lista fija de tablas (`shared/backup.ts`). El navegador arma el `.sql` (`dumpHeader` + `dumpPage`, una sentencia por línea, saltos de línea codificados con `char(10)`), para no exceder los 10 ms de CPU por solicitud.
- **Restauración:** sobre una base nueva con migraciones. El encabezado vacía las tablas sembradas por migraciones (plantillas y configuración).
- **Cron diario** (`scheduled` en `worker/index.ts`, `worker/lib/maintenance.ts`): borra sesiones vencidas e intentos de ingreso de más de 24 h.
- **Tamaño de solicitudes:** 64 KB en general; 2 MB para la importación de rankings (`IMPORT_MAX_BODY_BYTES`).
- **Carga diferida:** las pantallas pesadas (torneo con OCR, importación, publicación, respaldo, rankings, plantillas, movimientos, usuarios) son chunks separados (`React.lazy`).

## 2 sexies. Web pública oficial (Fase 7)

Detalle en [`docs/WEB_PUBLICA.md`](WEB_PUBLICA.md). Resumen técnico:

- **Rutas** (`worker/index.ts`):
  - `/api` → API;
  - `/admin/*` → SPA del panel (`env.ASSETS`, React Router con `basename="/admin"`, CSP estricta y `noindex` por cabecera);
  - direcciones viejas del panel → 301 a `/admin`;
  - resto → `worker/public/app.ts`.

  `run_worker_first` excluye los estáticos (`/assets`, `/pub`, `/brand`, `/web`, `/ocr`).
- **Render:**
  - `worker/public/layout.ts`: cabecera, menú (PC y celular sin JS), pie y metadatos;
  - `site-pages.ts`: páginas y renderizador de bloques;
  - `site-data.ts`: consultas sólo publicables;
  - `pages.ts`: rankings existentes, con enlaces según el prefijo `/rankings` o `/publico`.

  El CSS es estático (`public/pub/site.css`).
- **Migración 0005:**
  - tablas `site_pages`, `site_posts` y `site_events`;
  - columnas públicas de `tournaments` (`public_visible` = 0 por defecto, `series`, `featured`, `registration_open`, `public_description`, `prize_info`);
  - ajustes `site_*` en `app_settings`;
  - triggers de `public_version`.
- **Modelos compartidos** (`shared/site.ts`): bloques (Zod), modalidades, ajustes, `tournamentPath` y `whatsappUrl`.
- **API nueva:** `GET /api/site` (con sesión) y `PUT /api/site` (admin). `tournamentSchema` acepta los campos públicos con valores por defecto.
- **Ramas activas:** `site_active_genders`, que filtran la web y las altas del panel. No se modifica ningún dato.

## 2 septies. Gestor de contenidos (Fase 8)

Detalle en [`docs/CMS.md`](CMS.md). Resumen técnico:

- **Migración 0006:**
  - `site_pages` y `site_posts` reconstruidas: estados borrador, publicada y archivada; columnas `draft`, `version` y `published_*`;
  - tablas `site_revisions`, `media` y `site_sponsors`;
  - versión en `site_events`;
  - inicio por bloques.
- **API:**
  - `/api/cms/*`: páginas, novedades, patrocinadores, eventos, historial y vista previa HTML;
  - `/api/media`: subida binaria validada, deduplicación SHA-256, uso y borrado seguro;
  - `/media/<id>` público, servido desde KV.
- **Concurrencia:** `UPDATE … WHERE version = ?`. El historial y la auditoría se condicionan con `changes() > 0`.
- **Render:** `worker/public/views.ts` arma cada página a partir de su contenido. Lo usan las rutas públicas y `preview.ts`, así la vista previa es idéntica a la web.
- **Almacenamiento:** binding KV `MEDIA` detrás de la interfaz `MediaStore` (cambiable a R2).

## 2 octies. Fixtures de torneos largos (Fase 9)

Detalle en [`docs/FIXTURES.md`](FIXTURES.md). Resumen técnico:

- **Migración 0007:**
  - `tournament_events` y `tournaments.event_id`: un evento agrupa torneos, uno por categoría;
  - `tournament_teams.withdrawn_*`;
  - `tournament_fixtures` (configuración JSON, `version`, `op_token`), `fixture_groups`, `fixture_group_teams`, `fixture_matches`, `fixture_match_history` y `fixture_publications`.
- **Motor puro (`shared/fixture.ts`):**
  - `checkScore`, `roundRobin` (círculo), `distributeGroups` (serpentina);
  - `groupStanding` (desempates configurables, mini-liga entre empatadas, orden manual);
  - `seedFromGroups` / `placeEntries` (siembra estándar, evita cruces del mismo grupo, BYE);
  - `syncBrackets`: avances automáticos sólo en partidos sin resultado y conflictos en los ya jugados;
  - `fixtureIssues` y `buildPublicFixture`.
- **Escrituras (`worker/routes/fixtures.ts`):** cada operación lee el estado, valida y escribe un lote. El primer `UPDATE` incrementa la versión del fixture sólo si no cambió y marca un `op_token`. Las demás sentencias llevan `EXISTS (… op_token = ?)`: si otro escribió en el medio, el lote no aplica nada.
- **Publicación:** se guarda una copia (`PublicFixture`) en `fixture_publications`, y un trigger invalida la caché pública. La web nunca lee el fixture en edición.
- **Restricciones:**
  - sólo `type = 'largo'` (409 para americanos);
  - una pareja en el fixture no cambia de jugadores ni se borra;
  - cupo opcional en el alta de parejas;
  - anular resultados es sólo para administradores.

## 3. API

Todas las respuestas son JSON. Los errores tienen la forma `{ error: { code, message, fields? } }`, con los mensajes en español.

| Método y ruta | Descripción |
|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/password` | Sesión |
| `GET/POST /api/users` · `PUT /api/users/:id` | Organizadores (sólo admin) |
| `GET /api/dashboard` | Datos del panel |
| `GET/POST /api/categories` · `GET/PUT/DELETE /api/categories/:id` · `PATCH …/:id/active` | Categorías |
| `POST /api/categories/:id/divisions` · `PUT/DELETE /api/divisions/:id` | Divisiones |
| `GET/POST /api/players` · `GET/PUT /api/players/:id` · `PATCH …/:id/active` · `GET /api/players/duplicates` | Jugadores |
| `GET/POST /api/seasons` · `GET/PUT/DELETE /api/seasons/:id` · `PATCH …/:id/status` | Temporadas |
| `GET/POST /api/tournaments` · `GET/PUT/DELETE /api/tournaments/:id` · `PATCH …/:id/status` | Torneos |
| `GET/POST /api/scoring-templates` · `GET/PUT/DELETE /api/scoring-templates/:id` | Plantillas de puntuación |
| `GET/PUT /api/tournaments/:id/scoring` · `POST …/scoring/apply-template` | Puntuación propia del torneo |
| `GET/POST /api/tournaments/:id/teams` · `PUT/DELETE /api/teams/:id` · `PUT /api/tournaments/:id/results` | Parejas y carga de resultados |
| `GET /api/tournaments/:id/preview` · `GET/POST …/credits` · `POST …/credits/revert` | Previsualización, acreditación, corrección y reversión |
| `GET /api/rankings` · `GET /api/rankings/season/:id` · `GET/PUT /api/rankings/tiebreakers/:seasonId` | Rankings y desempates |
| `GET /api/movements` · `POST /api/movements/adjustments` · `POST /api/movements/:id/annul` · `GET /api/players/:id/points` | Registro, ajustes e historial |
| `GET /api/players/directory` · `POST /api/tournaments/:id/import` · `GET /api/tournaments/:id/imports` | Importación de cuadros (Fase 3) |
| `POST /api/ranking-imports/preview` · `GET/POST /api/ranking-imports` · `GET /api/ranking-imports/:id` · `POST …/:id/revert` | Importación de rankings (Fase 4) |
| `GET /api/publication` · `PUT /api/publication/settings` (admin) | Publicación web |
| `POST /api/backup/start` · `GET /api/backup/:tabla?after=` | Respaldo paginado (sólo admin) |
| `GET /publico` · `/publico/ranking/:temporada\|actual/:categoría[/:división]` · `/publico/jugadores` · `/publico/jugador/:código` | Vista pública de sólo lectura (HTML) |

Cada escritura con efectos múltiples (por ejemplo, alta de jugador + historial + auditoría) se ejecuta en un `db.batch()`, que D1 aplica como una transacción.

## 4. Seguridad y límites de CPU

El plan gratuito permite **10 ms de CPU por request**. Lo único costoso en CPU es el hash de contraseñas:

| PBKDF2-SHA256 | CPU medido |
|---|---|
| 100.000 iteraciones (máximo de Workers) | ~20 ms → riesgo de error 1102 |
| 60.000 | ~11 ms |
| **30.000 (elegido)** | **~6 ms** |

Para compensar el menor número de iteraciones: bloqueo tras 5 fallos, contraseñas de 10 caracteres como mínimo, sal única por usuario, y hashes que nunca salen de la base. El formato `pbkdf2-sha256$<iter>$<salt>$<hash>` permite subir las iteraciones más adelante: cada hash se actualiza en el siguiente ingreso del usuario.

## 5. Frontend

- Ruteo con React Router: `/ingresar`, `/`, `/jugadores`, `/jugadores/:id`, `/torneos`, `/torneos/:id`, `/rankings`, `/importar-rankings`, `/publicacion`, `/puntuacion`, `/movimientos`, `/temporadas`, `/categorias`, `/usuarios` (sólo admin) y `/cuenta`.
- Los filtros y las búsquedas viven en la URL, así se pueden compartir links y el botón "atrás" funciona.
- Diseño responsive: barra lateral en escritorio; barra superior con menú deslizable en celulares. Las tablas pasan a listas en pantallas chicas y los diálogos se convierten en hojas inferiores.
- Fechas en formato es-AR, con la zona horaria `America/Argentina/Buenos_Aires` para "hoy".

## 6. Pruebas

- `npm test`: **172 tests**. Fase 5B suma 18:
  - 12 de integridad de puntuaciones (`test/integrity.test.ts`): mismos puntos por integrante, categoría principal y división, regla general frente a acumulativo, cambios de plantilla después de acreditar, triple confirmación concurrente, dos organizadores corrigiendo a la vez, cada corrección contraasentada exactamente una vez, reversión sin borrar historial, categoría acreditada fija ante un cambio de categoría, rankings sólo desde movimientos confirmados (también en la vista pública), temporada cerrada intacta y reapertura sólo por admin, historial protegido.
  - 5 de respaldo (`test/backup.test.ts`): permisos, restauración completa en una segunda base D1 con comparación fila por fila de todas las tablas, paginación sin pérdidas, escape de texto y limpieza diaria.
  - 1 de importación de 1500 filas (más de 64 KB).

  Fase 4: 151 en total hasta esa fase:
  - 18 de lectura de planillas y mapeo: CSV con distintos separadores y codificaciones, XLSX con cadenas compartidas y hojas ocultas, ida y vuelta con el Excel que exporta la app, puntos en formato argentino, categorías “C6/6ta/Sexta”, nombres invertidos, diminutivos, homónimos, duplicados y rendimiento con 3000 jugadores.
  - 12 de integración de la importación: vista previa sin escritura, saldo inicial, jugadores nuevos, archivo o contenido repetido, doble saldo, índice único, reversión y reimportación.
  - 13 de la vista pública: privacidad, `frame-ancestors`, modo incrustado, actualización automática al acreditar, revertir, importar y renombrar, descargas, buscador, configuración, escape de HTML y permisos.

  Fase 3: 18 de interpretación del cuadro (sobre la lectura real de la imagen de referencia y variantes con errores típicos), 9 de normalización y coincidencia de nombres, y 6 de integración de la importación. Fase 2: Incluye 15 del motor de puntuación (cálculos, acumulativo, bonificaciones, validaciones, diferencias, desempates), 25 de integración de la Fase 2 (plantillas, parejas, categorías, doble acreditación, concurrencia, correcciones, reversiones, inmutabilidad, temporadas, divisiones, ajustes) y 3 de exportación. Además, los 32 tests de integración de la Fase 1 que corren dentro de workerd con D1 real y las migraciones aplicadas. Cubren autenticación, bloqueo, CSRF, roles, validaciones, homónimos, búsqueda sin acentos, historial, temporada única activa, transiciones de torneos y dashboard.
- `npm run test:e2e`: **26 pruebas Playwright**. La Fase 5B suma el circuito completo, sin atajos por API, en PC y en celular: crear torneo, configurar puntos, cargar la imagen del cuadro, identificar jugadores, revisar, importar sin acreditar, acreditar, ver el ranking interno y el público (normal, incrustado y el historial del jugador). Suma también la descarga del respaldo desde la app y su restauración real con `wrangler d1 execute`. Hasta la Fase 4 eran 23 pruebas Playwright. La Fase 4 suma importar una planilla al estilo Google Sheets, ver la página pública con y sin incrustar (también en celular), el historial, el buscador, impedir la doble importación y revertir. Antes eran 20, incluido el reconocimiento real de la imagen de referencia en escritorio y celular, con medición de precisión. Antes eran 16 (incluye el flujo completo de carga manual, acreditación, corrección, exportación, ajustes y reversión) contra la app real (Vite + Worker + D1 local aislada), en escritorio y en un celular emulado (Pixel 7). En celular también verifican que no haya scroll horizontal.
