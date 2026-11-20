# Web pública oficial (Fase 7)

La nueva web de Padel Time convive en el mismo Worker que el panel. Reemplazará a Google Sites cuando se cambien los DNS (Fase 11, autorizado).

## Rutas

| Ruta | Contenido | Fuente de los datos |
|---|---|---|
| `/` | Inicio: presentación, torneos en curso, próximos y destacados, novedades, rankings de la temporada, sede y botones de inscripción y contacto | Página `inicio` (site_pages), torneos publicados, site_posts, rankings y datos de la web |
| `/torneos` | Próximos, en curso, finalizados e historial por temporada, con filtros de temporada, categoría y modalidad (`?estado=` `?temporada=` `?categoria=` `?modalidad=`) | Torneos con **Publicar en la web** |
| `/torneos/<nombre>-<id>` | Página del torneo: datos, información, premios, parejas inscriptas o resultado final acreditado, inscripción por WhatsApp y enlace al ranking | Torneo + acreditación vigente |
| `/rankings` · `/rankings/<temporada\|actual>/<categoría>[/<división>]` · `/rankings/jugadores` · `/rankings/jugador/<código>` | Rankings públicos existentes (mismo motor, mismas consultas) | point_movements |
| `/publico/...` | **Las mismas páginas de rankings, con las direcciones anteriores.** Siguen funcionando los iframes ya pegados en Google Sites (`?embed=1`). | Idem |
| `/calendario` (`?mes=AAAA-MM`) | Grilla mensual (PC) y agenda (celular) | Torneos publicados + site_events |
| `/reglamentos` | Reglamento vigente, con botón "Imprimir o guardar en PDF" y documentos descargables (bloques `document`) | Página `reglamentos` |
| `/liga` · `/cancha-abierta` · `/premios` | Contenido de la web oficial. Cancha abierta suma próximas fechas; Premios suma los premios cargados en cada torneo | Páginas + site_events + torneos |
| `/contacto` | Sede, mapa, WhatsApp, Instagram e inscripciones | Datos de la web |
| `/novedades` · `/novedades/<slug>` | Noticias (se cargan desde el panel en la Fase 8) | site_posts |
| `/sitemap.xml` · `/robots.txt` | Para buscadores: se indexa la web y se excluyen `/admin` y `/api` | |
| `/admin/...` | **Panel de organizadores** (antes en `/`). Con sesión, CSP estricta y `noindex` | |
| `/jugadores`, `/torneos/12`, `/temporadas`, `/ingresar`… | Direcciones viejas del panel: redirigen (301) a `/admin/...` | |

## Contenido real, sin datos inventados

- **Textos publicados en www.padeltime.com.ar:**
  - "Comunidad de pádel" y sus viñetas;
  - los 5 pasos de "¿De qué se trata el circuito Padel Time?";
  - el reglamento completo.

  Se cargaron en la migración 0005 sin agregados. En el reglamento se omitieron las líneas de horarios de Damas, porque la rama está discontinuada.
- **Datos de contacto y sede** (WhatsApp, Instagram, Las Vías Padel Center, dirección y coordenadas del mapa): los mismos de la web actual, en `app_settings`. Se editan desde **Publicación web → Datos de la web**, sólo un administrador.
- **Fotos:** la foto de portada y la vista aérea de la sede, tomadas de la web oficial con autorización, en `public/web/`.
- **Torneos:** sólo los marcados **Publicar en la web** en el panel. Por defecto ninguno se publica.
- **Liga, Cancha abierta y Premios:** se muestra sólo lo que existe en la web actual (la descripción del circuito, la evaluación en canchas abiertas y la entrega de premios del Master). Los premios concretos se cargan por torneo. No se agregaron funciones deportivas.
- **Novedades y eventos del calendario:** las tablas están listas pero vacías. Las páginas muestran estados vacíos hasta que se carguen desde el panel (Fase 8).

## Damas (discontinuada)

El ajuste **Ramas activas** (por defecto sólo Caballeros) define qué se ve en la web y qué se ofrece al crear registros:

- **Web:** no muestra torneos, rankings, jugadores ni búsquedas de Damas. Las direcciones directas responden 404.
- **Panel, altas nuevas:** no ofrece Damas al crear categorías, jugadores ni torneos.
- **Panel, histórico:** las categorías de Damas se ven como "Discontinuada · histórico". Se pueden consultar y editar, y su ranking interno sigue disponible.
- **Datos:** no se borra ni modifica nada. El motor de puntuación no cambió.
- **Reversible:** se vuelve a mostrar marcando "Damas" en Ramas activas.

## Buscadores (SEO)

- Cada página tiene `<title>`, `description`, `canonical` y Open Graph (vista previa al compartir por WhatsApp o Instagram).
- El inicio declara JSON-LD `SportsOrganization` y cada torneo, `SportsEvent`.
- La web **no** hereda el `noindex` del panel: sólo `/admin` lo lleva, por cabecera y por `robots.txt`.
- Las páginas incrustadas (`?embed=1`) se marcan `noindex` para no duplicar contenido.
- Las URLs son legibles: `/torneos/p1-mallorca-1000-12`, `/rankings/2026/6`.

## Rendimiento y seguridad

- **HTML generado en el Worker, sin JavaScript obligatorio.** El JS sólo agrega el filtro instantáneo del ranking, el botón de imprimir y el envío automático de los filtros.
  - CSS propio cacheado (`/pub/site.css`, ~6 KB comprimido).
  - Fotos en WebP (96 KB y 216 KB).
- **Caché:** la misma versionada de la Fase 4. Se suman triggers para torneos, parejas y contenidos, y la fecha del día entra en la clave para que "próximos" y el calendario cambien solos.
- **Archivos estáticos fuera del Worker:** se sirven directo y no consumen las solicitudes diarias del plan gratuito.
- **CSP de la web:** sin scripts externos, sin `eval` y con `frame-src` sólo para el mapa de Google de la página de contacto.
- **Privacidad:** las consultas públicas sólo devuelven nombres de jugadores y datos marcados para publicar. Nunca DNI, teléfono, email, notas internas del torneo ni motivos de ajustes. Hay pruebas automáticas de cada caso.

## Panel: qué cambió

- **Dirección nueva:** el panel se abre en **`/admin`**.
- **Formulario de torneo, sección "Web pública":**
  - Publicar en la web;
  - Modalidad (Open 1000, Challenger 500, Satélite 100, Master Final 2000, Otro);
  - Destacado;
  - Inscripción abierta;
  - Información para la web;
  - Premios.

  Las "Notas" pasan a llamarse "Notas internas" y nunca se publican.
- **Ficha del torneo:** indica si está "En la web" (con enlace) o "No publicado".
- **Publicación web → Datos de la web:**
  - frase de presentación;
  - WhatsApp y su mensaje inicial;
  - Instagram;
  - sede, dirección y coordenadas;
  - aviso destacado (la franja verde superior, vacía por defecto);
  - ramas activas.

## Pendiente para fases siguientes (no incluido en esta fase)

- Editor de páginas, novedades, eventos y biblioteca de imágenes y documentos: Fase 8 (CMS).
- Fixtures, grupos, partidos y copas de los torneos largos: Fase 9. La página de cada torneo ya tiene el lugar para mostrarlos.
- Redirecciones 301 de las 268 direcciones de Google Sites e histórico 2025: Fase 10.
