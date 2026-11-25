# Auditoría de contenidos y migración desde la web anterior

Comparación entre la web actual (www.padeltime.com.ar, Google Sites) y la web nueva, hecha sobre el inventario de la Fase 6 (`docs/web-anterior/`).

El 25/11/2026 se volvió a leer el menú de la web actual: tiene las mismas 268 páginas que el inventario, así que sigue vigente.

**No se modificó la web actual.** Sólo se leyó.

## 1. Auditoría: qué hay en cada web

| Sección | Web actual | Web nueva | Estado |
|---|---|---|---|
| **Inicio** | Banner, viñetas, "¿De qué se trata?" (5 pasos), sede con mapa, flyers, formulario de Google | `/`: banner editable, los mismos textos, torneos en curso y próximos, novedades, rankings, patrocinadores y sede con mapa | ✔ Texto migrado (Fase 7). La galería de flyers se puede cargar en Novedades. El formulario de Google se reemplaza por WhatsApp (decisión del 20/11). |
| **Cancha abierta** | Sólo una viñeta en la portada | `/cancha-abierta`: página editable más las fechas del calendario | ✔ Estructura lista. **Falta información del cliente** (días, horarios, costo). |
| **Torneos** | Una sección por torneo con fixture, tabla y copas como **imágenes** | `/torneos`: listado por estado y temporada; cada torneo con selector de categoría, fixture, resultados, tablas, Copa de Oro y Plata **en datos**, y archivos de resultados | ✔ Para torneos nuevos. Los históricos se migran como archivo (sección 3). |
| **Liga** | Sólo una viñeta | `/liga`: texto del circuito (el de la portada) | ✔ Texto migrado. Ampliar con información del cliente si existe. |
| **Rankings** | Imágenes por categoría (2025 y 2026); "Ranking general" vacío | `/rankings`: rankings calculados por temporada y categoría, buscador de jugadores y descarga | ✔ 2026: planillas importadas (Fase 6). 2025: imágenes migrables a la biblioteca, o importar las planillas si existen (sección 4). |
| **Premios** | Sólo una viñeta | `/premios`: premios por torneo (se cargan en cada torneo) | ✔ Estructura lista. Los premios se informan por torneo (decisión del 20/11). |
| **Calendario** | Imágenes "Calendario 2026" | `/calendario`: torneos publicados y eventos | ✔ En datos. Las dos imágenes de 2026 quedan en la biblioteca. **Falta cargar las fechas reales de los próximos torneos.** |
| **Reglamentos** | Único texto real del sitio | `/reglamentos`: el mismo texto, editable por bloques, más PDF descargables | ✔ Migrado completo (Fase 7). |
| **Sede** | Mapa de Google y dirección | Bloque "Dónde jugamos" en Inicio y Contacto: mapa, dirección y foto | ✔ Migrado (Las Vías Padel Center). |
| **Contacto e inscripciones** | Botón ANOTATE! (WhatsApp) y formulario de Google | `/contacto` y botones "Inscribirme" por torneo, con mensaje armado | ✔ El número de WhatsApp se configura en **Datos de la web**. |
| **Fixtures, resultados y posiciones** | Imágenes | Fixture con datos: grupos, partidos, tablas, Copa de Oro y Plata, con publicación controlada | ✔ Fases 9 y 10. |
| **Contenido histórico** | Torneos 2025 y 2026 en imágenes | Torneos históricos con **archivos de resultados** (imágenes) y redirecciones desde las direcciones viejas | Preparado (secciones 3 y 5). |
| **Damas** | 53 páginas (D5–D9, "Femenino") | No aparece en la web pública. Los datos que existan en la base se conservan. | ✔ Excluida, sin borrar datos. |

## 2. Qué ya está migrado

- **Textos:** portada, "¿De qué se trata el circuito?", reglamento completo, datos de la sede, Instagram.
- **Imágenes y logotipos:** logo y símbolo de Padel Time, foto de la sede y foto de portada (`public/web/`, `public/brand/`).
- **Rankings 2026:** las planillas completas que entregaste, importadas como saldo inicial (Fase 6).
- **Enlaces:** WhatsApp e Instagram, configurables en **Datos de la web**.
- **Redirecciones 301:** las 15 secciones de la web anterior, con sus subpáginas, llevan a su equivalente (sección 5).

## 3. Torneos históricos: imágenes conservadas como archivo

En la web anterior los resultados existen **sólo como imágenes**. No se inventan datos estructurados: se conservan como **archivos de resultados** de cada categoría (pestaña **Resumen → Archivos de resultados**), y la página pública los muestra en "Resultados (archivo)".

**Herramienta:** `scripts/migrar-web-anterior.mjs`

1. **Descargar** (sólo lectura de la web anterior):

   ```bash
   node scripts/migrar-web-anterior.mjs descargar
   ```

   Guarda en `migracion-web-anterior/` las imágenes de cada página de Caballeros, con un índice `manifest.json`. Damas queda afuera. La carpeta no se sube al repositorio.

   En Windows (PowerShell) funciona igual. En entornos con proxy hace falta `NODE_USE_ENV_PROXY=1`.
2. **Crear los torneos históricos en el panel** con sus datos reales: temporada, nombre, fechas y categorías.
   - Las **fechas** no figuran en la web anterior. Las tiene que indicar la organización.
   - Para la temporada 2025 (cerrada) hay que reabrirla mientras se cargan; los archivos de resultados se pueden agregar igual en temporadas cerradas.
3. **Plantilla de correspondencias:**

   ```bash
   node scripts/migrar-web-anterior.mjs plantilla
   ```

   Completar `migracion-web-anterior/correspondencias.json` con el número de cada categoría de la web nueva (el número de `/admin/torneos/<número>`).
4. **Subir** al entorno de prueba primero y, ya aprobado, a producción:

   ```bash
   node scripts/migrar-web-anterior.mjs subir --url https://padel-time-prueba.<subdominio>.workers.dev --usuario admin
   ```

   - Sube las imágenes a la biblioteca y las agrega a cada categoría.
   - **No borra ni reemplaza nada**, y no duplica: se probó corriéndolo dos veces seguidas.
   - Las imágenes de rankings y calendario quedan en la biblioteca.

**Resultado de la descarga del 25/11/2026:** 241 imágenes (60 MB), de 159 páginas de Caballeros.

| Sección anterior | Categorías con imágenes |
|---|---|
| Paris Major 2000 | C5 |
| P1 Buenos Aires | C5, C6, C7, C8 |
| Qatar Major 2000 | C5, C6, C7, C8 |
| P1 Mallorca 1000 | C5, C6-1, C6-2, C7, C8 |
| P1 Australia 1000 | C5, C6-1, C6-2, C7, C8 |
| Master Final 2025 | C6, C7 |
| Paris Open 1000 2025 | C4/5, C6, C7, C8 |
| Challenger 500 2025 | C6, C7, C8 |
| Satélites 1000 2025 | 13 satélites por categoría (C5/6, C6, C6/7, C7, C8, C8/7) |
| Winter Time Cup 2025 | Resultados y tabla |
| Rankings 2025 / 2026, Calendario 2026 | A la biblioteca |

En la web nueva, **C6-1 y C6-2** (grupos de C6) se cargan como **divisiones** de la categoría C6: Categorías → C6 → divisiones "1" y "2".

## 4. Inventario de contenido pendiente (requiere archivos o información del cliente)

| # | Pendiente | Qué hace falta | Quién |
|---|---|---|---|
| 1 | **Fechas de los torneos históricos** (2025 y 2026) | Fecha de inicio y fin de cada torneo, para crearlos y que el calendario y el historial sean correctos | Organización |
| 2 | **Winter Time Cup 2025: "Cuadro final"** | Google no permite descargar esa imagen (error 403). Se necesita el archivo original. | Organización |
| 3 | **P1 Buenos Aires C7 "Copa de Plata"** y **P1 Australia C8 "Resultados"** | Esas páginas no tienen imagen en la web anterior. Si existen, el archivo original. | Organización |
| 4 | **Rankings 2025 en datos** | Si existen las planillas (Excel o CSV) de 2025, se importan como saldo histórico. Si no, quedan como imágenes en la biblioteca. | Organización |
| 5 | **Cancha abierta** | Días, horarios, costo y modalidad, para la página y el calendario | Organización |
| 6 | **Liga** | Información adicional, si la hay (la web anterior no tiene más que la viñeta) | Organización |
| 7 | **Calendario 2026–2027** | Fechas de los próximos torneos (se cargan como torneos o eventos) | Organización |
| 8 | **Premios** | Premios de cada torneo próximo (se cargan en cada torneo) | Organización |
| 9 | **Flyers de la portada** | Si se quieren conservar, se suben en Novedades. Están en la web anterior. | Organización / descarga |
| 10 | **Patrocinadores** | Logos y enlaces (la web anterior no tiene) | Organización |
| 11 | **Número de WhatsApp definitivo** | Confirmar el número de los botones de inscripción | Organización |
| 12 | **Puntos de la Copa de Plata** (Fase 10, si se usa) | Cuántos puntos otorga. Hoy se propone "Fase de grupos". | Organización |
| 13 | **Orden de desempate y W.O.** | Confirmar el orden de criterios y cómo cuenta un W.O. en la tabla | Organización |

## 5. Redirecciones 301 (direcciones de la web anterior)

Se crearon con la migración 0010 y se editan en **Contenidos web → Redirecciones** (sólo administradores).

| Dirección anterior | Lleva a |
|---|---|
| `/página-principal` | `/` |
| `/calendario-2026/…` | `/calendario` |
| `/rankings-2026/…`, `/rankings-2025/…`, `/ranking-general` | `/rankings` |
| Cada torneo: `/qatar-major-2000/…`, `/p1-mallorca-1000/…` y los demás | `/torneos?estado=historial` |
| `/reglamentos` | Misma dirección en la web nueva (no necesita redirección) |

Cuando se carga un torneo histórico, conviene apuntar su dirección vieja a la página nueva del torneo. Las 268 direcciones del inventario se verificaron con `npm run check:links -- <web> --legacy`: todas responden 200 o 301.
