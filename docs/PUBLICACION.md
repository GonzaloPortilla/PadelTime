# Rankings públicos y Google Sites

Padel Time genera **una página pública por ranking** (temporada + categoría + división). La dirección se pega **una sola vez** en Google Sites y después se actualiza sola: cada acreditación, corrección, reversión o importación cambia lo que se ve, sin tocar el sitio.

Las páginas públicas son de **sólo lectura**. No usan sesión, no exponen la API administrativa y muestran únicamente nombre, apodo, código interno, categoría y puntos. Nunca muestran DNI, teléfono, email, fecha de nacimiento, notas ni motivos de ajustes.

## 1. Direcciones

Desde **Publicación web** en la app se copian los enlaces. Tienen esta forma (con el dominio donde quedó publicada la app, por ejemplo `https://padel-time.TU-CUENTA.workers.dev`):

| Página | Dirección |
|---|---|
| Índice de rankings | `/publico` |
| Ranking de una categoría | `/publico/ranking/<temporada>/<categoría>` |
| Ranking de una división | `/publico/ranking/<temporada>/<categoría>/<división>` |
| Ranking de la temporada vigente | `/publico/ranking/actual/<categoría>` (pasa sola a la próxima temporada cuando la activás) |
| Buscador de jugadores | `/publico/jugadores` |
| Historial de un jugador | `/publico/jugador/J-00012` |
| Descarga a Excel / CSV | agregar `?descargar=xlsx` o `?descargar=csv` al ranking |

Agregando **`?embed=1`** la página se muestra en **modo incrustado**: sin barra superior, con fondo transparente, márgenes mínimos y un enlace “Ver en Padel Time ↗” que abre la versión completa en otra pestaña. El botón **Copiar enlace para Google Sites** ya lo incluye.

Los números de la dirección son identificadores internos: si después se cambia el nombre de una categoría o de una temporada, el enlace sigue funcionando.

## 2. Qué averigüé sobre Google Sites

No pude abrir `www.padeltime.com.ar` desde el entorno donde se desarrolló (la red lo bloquea), así que lo que sigue es el comportamiento general de Google Sites y no de ese sitio en particular.

- **Insertar → Incorporar** tiene dos pestañas:
  - **Por URL:** Google Sites crea un iframe que apunta a la dirección. Según la ayuda de Google, sólo funciona si la página de destino permite que la incrusten. Si no lo permite, se inserta un enlace o una vista previa.
  - **Incorporar código:** acepta HTML (por ejemplo un `<iframe>`) y lo muestra dentro de un marco aislado servido desde un subdominio de `googleusercontent.com`. Ese subdominio cambia y no es fijo.
- **Google Sites no ajusta la altura sola:** el alto del recuadro se ajusta arrastrando el borde en el editor.
- **La página incrustada decide si se puede incrustar**, con sus cabeceras `X-Frame-Options` y `Content-Security-Policy: frame-ancestors`. Google Sites no las puede saltear.

### Cómo lo resuelve Padel Time

- Las páginas `/publico/*` **no** envían `X-Frame-Options`. Su CSP permite que las incrusten solamente desde:

  ```
  frame-ancestors 'self' https://sites.google.com https://*.googleusercontent.com https://www.padeltime.com.ar https://padeltime.com.ar
  ```

  La lista se configura en `wrangler.jsonc` (`PUBLIC_FRAME_ANCESTORS`).
- La app administrativa (`/api`, panel de organizadores) sigue con `X-Frame-Options: DENY` y `frame-ancestors 'none'`: no se puede incrustar.
- **Verificado en un navegador real (Chromium):**
  - Cargada como iframe desde `https://sites.google.com/…` o desde `https://…googleusercontent.com/…`, la página se muestra.
  - Cargada desde otro dominio, el navegador la bloquea con el error de `frame-ancestors`.

  Lo que no pude probar es la inserción dentro de un sitio de Google real, porque requiere entrar con la cuenta del propietario.
- Las páginas funcionan sin JavaScript (el filtro por nombre usa JavaScript si está disponible), no usan cookies y las descargas se abren en otra pestaña. Así funcionan dentro del marco aislado de Google Sites.

> **No modifiqué Google Sites.** Los pasos siguientes los tiene que hacer alguien con acceso de edición al sitio.

## 3. Pasos para integrarlo en el sitio actual

Antes de empezar: la app tiene que estar publicada en Cloudflare (`npm run deploy`, ver el README). Google Sites no puede mostrar una dirección `localhost`.

Para cada página de ranking del sitio (por ejemplo **Rankings 2026 → Caballeros 2026 → C6**):

1. En Padel Time, entrá a **Publicación web**, elegí la temporada y tocá **Copiar enlace para Google Sites** en el ranking correspondiente.
   - Si querés que esa página pase sola al año siguiente, elegí **Temporada vigente** en el selector.
   - Si el sitio tiene una página por año, elegí la temporada fija.
2. Abrí el sitio en Google Sites en modo edición y entrá a la página del ranking.
3. Si hoy hay una planilla o tabla incrustada con el ranking viejo, seleccionala y borrala (o dejala oculta hasta verificar).
4. Panel derecho: **Insertar → Incorporar** → pestaña **Por URL** → pegá el enlace.
5. Elegí **Página completa** (no “Vista previa”) y tocá **Insertar**.
6. Estirá el recuadro: ancho completo y alto suficiente para el ranking. Como referencia, unos 60 px por jugador más 250 px. Si es más corto, la tabla tiene su propia barra de desplazamiento.
7. Tocá **Publicar**.

Si en el paso 5 Google Sites sólo ofrece una vista previa, usá la pestaña **Incorporar código** con el botón **Copiar código HTML**. Pega algo así:

```html
<iframe src="https://padel-time.TU-CUENTA.workers.dev/publico/ranking/2/6?embed=1" title="Ranking 6ta Caballeros" width="100%" height="900" style="border:0" loading="lazy"></iframe>
```

Opcional:
- Agregar una página **Buscar jugador** con el enlace del buscador incrustado de la misma forma.
- Agregar un botón con el texto “Ver todos los rankings” que apunte a `/publico`.

### Alternativas si la incrustación no sirve

- **Botón o enlace:** en Google Sites, Insertar → Botón, con la dirección pública del ranking (sin `?embed=1`). Se abre la página completa, también actualizada sola.
- **Excel:** cada página pública tiene botones **Excel** y **CSV**, y en la app (Rankings → Excel / Temporada completa) se descargan los mismos datos. Se pueden subir a Google Drive o Sheets si se prefiere seguir con planillas, pero eso ya no se actualiza solo.

## 4. Actualización automática y caché

- Cada página se genera en el Worker a partir del libro de movimientos.
- La base mantiene un contador de “versión pública”. Lo incrementan triggers ante cualquier cambio visible:
  - movimientos de puntos;
  - estado de una acreditación;
  - nombres de jugadores, categorías, divisiones, temporadas o torneos;
  - configuración de la publicación.
- Mientras la versión no cambia, la página se sirve desde caché: memoria del Worker y Cache API, que funciona con un dominio propio en Cloudflare. El navegador revalida en cada visita con `ETag` y recibe `304` si no hubo cambios.
- Apenas cambia algo, la siguiente visita ve los datos nuevos. No hay demora configurada.

**Costo:** cada visita es 1 request al Worker. Con la página en caché, son 2 lecturas de D1. El plan gratuito incluye 100.000 requests y 5 millones de lecturas por día, de sobra para un sitio de club. Si se excede, Cloudflare corta hasta las 00:00 UTC, sin cobrar nada.

## 5. Configuración (Publicación web)

Sólo los administradores la cambian:

- **Publicar rankings en la web:** si se desactiva, las páginas muestran “no disponible”, también dentro de Google Sites.
- **Buscador e historial de jugadores:** se puede ocultar. La búsqueda es sólo por nombre, apellido o apodo: si alguien escribe números (por ejemplo un DNI), esa parte se ignora.
- **Título** de las páginas.
- **Temporadas visibles:** las planificadas nunca se muestran.

## 6. Limitaciones

- La altura del recuadro en Google Sites es fija: hay que ajustarla a mano una vez. Si el ranking crece mucho, la tabla tiene su propio desplazamiento.
- Google puede cambiar el dominio desde el que sirve el contenido incrustado. Si algún día dejara de mostrarse, hay que agregar el dominio nuevo a `PUBLIC_FRAME_ANCESTORS` y volver a publicar.
- La Cache API de Cloudflare no funciona en `*.workers.dev`. Ahí las páginas se cachean sólo en la memoria del Worker. Funciona igual, con algunas consultas más a D1, siempre dentro del plan gratuito.
- Para usar un subdominio propio (por ejemplo `rankings.padeltime.com.ar`), el dominio tiene que estar administrado en Cloudflare (DNS gratuito). Es opcional: la dirección `workers.dev` funciona igual dentro de Google Sites.
