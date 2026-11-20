# Inventario de la web anterior (www.padeltime.com.ar)

Relevamiento hecho el 20/11/2026 con un navegador automatizado (Chromium) que:

- leyó el menú completo del sitio (Google Sites), incluido el desplegable *More*;
- visitó cada página;
- registró en cada una el texto, las imágenes, los elementos incrustados y los enlaces externos.

El listado página por página, con su clasificación, está en [`inventario-paginas.csv`](inventario-paginas.csv) (268 filas).

No se modificó nada de la web: sólo se leyó.

---

## 1. Hallazgo principal

**La web actual no tiene funcionalidades dinámicas propias.** Es un sitio de Google Sites donde el contenido se publica a mano:

- **Fixtures, resultados, tablas de posiciones, llaves de Copa de Oro y Plata, rankings y calendario son imágenes.** Son capturas de planillas o piezas gráficas: no hay datos estructurados para extraer ni para buscar. Lo verifiqué en una muestra de cada tipo; el resto se clasificó por el patrón de su dirección.
- **No hay inscripción en línea.** El botón **ANOTATE!**, presente en las 268 páginas, abre un chat de WhatsApp con un número de Padel Time.
- **El único formulario** es un Google Forms incrustado en la portada ("Dejanos tus datos"): nombre y correo (obligatorios), teléfono y comentarios. Google exige iniciar sesión con una cuenta de Google para enviarlo.
- **El único otro elemento interactivo** es un **mapa de Google** con la ubicación de la sede (Las Vías Padel Center, Belén de Escobar).

## 2. Mapa del sitio

| Sección del menú | Páginas | Contenido |
|---|---:|---|
| **Página principal** | 1 | Banner, "Comunidad de pádel" con viñetas (Cancha abierta, Torneos, Liga, Ranking, Premios), sede con mapa, galería de flyers, íconos de Instagram y WhatsApp, formulario de contacto, bloque "¿De qué se trata el circuito Padel Time?" (5 pasos ilustrados). |
| **Paris Major 2000** | 4 | Torneo en curso: C5 → fixture y tablas. |
| **P1 Buenos Aires** | 18 | C5, C6, C7, C8 → fixture, tabla, resultados y copas (según categoría). |
| **Qatar Major 2000** | 31 | C5–C8 y **D6, D7 (Damas)** → fixture, resultados, tabla y copas. |
| **P1 Mallorca 1000** | 31 | C5, C7, C8, **C6 1 y C6 2** (C6 dividida en dos grupos) → fixture, resultados, tabla, Copa de Oro y Copa de Plata. |
| **P1 Australia 1000** | 32 | Ídem; C6 con subgrupos C6 1 y C6 2. |
| **Rankings 2026** | 13 | Caballeros C5–C9 y **Damas D5–D9**. |
| **Reglamentos** | 1 | **Único texto real del sitio**: evaluación de nivel, Open 1000, Challenger 500, Satélite 100, Master Final 2000 (formatos, puntos, días y horarios). |
| **Calendario 2026** | 1 | Imágenes. |
| **Master Final 2025** | 13 | C6 y C7 → fixture, resultados, tablas, Copa de Oro y Plata. |
| **Paris Open 1000 2025** | 37 | Masculino C4/5, C6, C7, C8 · **Femenino D6, D7**. |
| **Challenger 500 2025** | 41 | Masculino C5–C8 · **Femenino D5–D7**. |
| **Satélites 1000 2025** | 30 | Un resultado por americano: Santiago, Estocolmo, Río de Janeiro, Bruselas, Lisboa, Valladolid, Buenos Aires… Categorías combinadas (C8/7, C6/7, C5/6, **D6/7**). |
| **Rankings 2025** | 10 | Masculino C4/5, C6, C7, C8 · **Femenino D5–D7**. |
| **Winter Time Cup 2025** | 4 | Resultados, tabla de posiciones y cuadro final. |
| **Ranking general** | 1 | **Página vacía.** |
| **Total** | **268** | 61 son sólo índices de navegación, sin contenido propio. |

Elementos comunes a todas las páginas:

- barra superior "PRÓXIMO TORNEO PORTUGAL P2 360 EL 26 DE DICIEMBRE · ANOTATE!" (WhatsApp);
- banner con el logo y las diagonales azul y verde;
- menú superior.

## 3. Funcionalidades reales frente a contenido informativo

| Elemento | ¿Funcionalidad real? | Qué hace exactamente |
|---|---|---|
| ANOTATE! | Sí, externa | Abre WhatsApp (`wa.me`) con el número de Padel Time. No registra nada en la web. |
| Formulario "Dejanos tus datos" | Sí, externa | Google Forms: nombre, correo, teléfono y comentarios. Las respuestas van a la cuenta de Google del dueño. Pide iniciar sesión en Google. |
| Mapa de la sede | Sí, externa | Google Maps incrustado (coordenadas de Las Vías Padel Center). |
| Instagram | Enlace | `instagram.com/padeltimeok`. |
| Fixtures, resultados, tablas, copas | **No** | Imágenes de planillas, publicadas a mano. |
| Rankings 2025 y 2026 | **No** | Imágenes de planillas. |
| Calendario 2026 | **No** | Imágenes. |
| Reglamentos | **No** (texto) | Texto informativo. |
| Cancha abierta, Liga, Premios (portada) | **No** | Viñetas de texto, sin enlaces ni páginas propias. No hay información de premios ni de la liga en el sitio. |
| Ranking general | **No** | Página vacía. |
| Búsqueda | Del propio Google Sites | Busca en los títulos y textos del sitio, no dentro de las imágenes. |

## 4. Lo que **no** encontré (no se inventa)

- Una página de **Premios** con contenido (sólo aparece la palabra en la portada y en el reglamento: "además de los premios").
- Páginas de **Cancha abierta** o **Liga**. El reglamento menciona las canchas abiertas como instancia de evaluación de nivel.
- Inscripción en línea, pagos, cuentas de jugadores o notificaciones.
- Datos estructurados (tablas HTML, planillas de Google incrustadas): todo resultado está en imágenes.

## 5. Datos útiles para la nueva web

- **Estructura de torneos** que se repite: torneo → categoría (o grupo, como C6 1 / C6 2) → fixture, resultados, tabla de posiciones, Copa de Oro, Copa de Plata.
- **Tipos de torneo y puntos**, según el reglamento:

  | Tipo | Formato | Frecuencia | Puntos al campeón |
  |---|---|---|---:|
  | Open 1000 | largo, grupos y copas | 2 por año | 1000 |
  | Challenger 500 | corto, grupos y copas | 4 por año | 500 |
  | Satélite 100 | americano de un día | varios por mes | 100 |
  | Master Final 2000 | por ranking, 2 grupos de 4 y cruces | 1 por año | 2000 |

  Los nombres de cada edición varían ("P1 Mallorca 1000", "Qatar Major 2000", "Portugal P2 360"): la web tiene que admitir nombres libres con un *tipo* asociado.
- **Días por categoría (Caballeros):** lunes C8, martes C5, miércoles C7, jueves C6, desde las 21:00.
- **Sede:** Las Vías Padel Center, César Díaz 850, Belén de Escobar, Buenos Aires.
- **Contacto:** WhatsApp y el Instagram `@padeltimeok`.

## 6. Contenido de Damas (discontinuado)

53 de las 268 páginas son de Damas (D5–D9, "Femenino", "Damas 2026"). Según lo decidido:

- no se publican en la nueva web pública;
- sus datos históricos, si se cargan, se conservan en la base.
