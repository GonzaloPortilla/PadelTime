# Gestor de contenidos (Fase 8)

Los organizadores modifican toda la información de la web pública desde el panel (**Contenidos web**), con formularios y bloques, sin tocar código.

Los datos deportivos (torneos, jugadores, resultados, rankings) **no** se duplican en el CMS: se siguen cargando en sus módulos, y la web los muestra solos.

## Qué se puede editar

| Pantalla (panel → Contenidos web) | Qué administra |
|---|---|
| **Páginas → Inicio** | Banner principal (título, frase, foto de fondo y hasta 4 botones), secciones informativas (textos, listas, pasos, imágenes) y **orden y visibilidad** de las secciones automáticas (próximo torneo destacado, torneos en curso, próximos y destacados, novedades, rankings, patrocinadores, sede). El "próximo torneo destacado" puede ser automático o un torneo publicado. |
| **Páginas → Reglamentos** | Reglamento por bloques y PDF descargables. |
| **Páginas → Liga, Cancha abierta, Premios** | Su contenido real (el de la web oficial), editable. Se pueden ocultar. |
| **Páginas → Contacto, Torneos, Rankings, Calendario, Novedades** | Título e introducción de cada sección. Son parte de la estructura y no se ocultan. |
| **Novedades** | Noticias y anuncios: título, resumen, portada, contenido y "fijar arriba". |
| **Multimedia** | Biblioteca de fotos, logos y PDF: subir, renombrar, texto alternativo, ver dónde se usa cada archivo y borrar los que no se usan. |
| **Patrocinadores** | Logo (de la biblioteca), nombre, enlace, orden y visibilidad. |
| **Calendario** | Canchas abiertas, cenas, cierres de inscripción y otros eventos (los torneos publicados aparecen solos). |
| **Datos de la web** | WhatsApp y mensaje de inscripción, Instagram, sede (nombre, dirección, mapa, foto), aviso destacado con vencimiento y ramas activas. |

### Bloques disponibles

| Bloque | Uso |
|---|---|
| Título, Texto, Lista, Pasos, Aviso destacado | Contenido. El texto acepta **negrita**, *cursiva* y enlaces (`[texto](https://…)`). |
| Botón | Enlace a una página de la web, a una dirección `https://…` o al **WhatsApp configurado**. |
| Documento (PDF) | Descarga de un PDF de la biblioteca. |
| Imagen, Galería | Fotos de la biblioteca, con texto alternativo y epígrafe. |
| Banner principal, Sección automática | Sólo en Inicio. |

Cada bloque se puede **subir, bajar, ocultar** (sin borrarlo) o **quitar**.

## Ciclo de publicación

| Estado | En la web |
|---|---|
| **Borrador** | No se ve (novedades nuevas). |
| **Publicada** | Se ve. Puede tener **cambios sin publicar** (un borrador pendiente): la web sigue mostrando la última versión publicada. |
| **Archivada (oculta)** | No se ve y desaparece del menú. Se puede volver a mostrar. |

Acciones:

- **Guardar borrador:** guarda sin publicar.
- **Vista previa:** guarda si hay cambios y abre, en otra pestaña, la página con el diseño real y el contenido sin publicar. Sólo con sesión, y no se indexa.
- **Publicar:** pasa el contenido a la web. La caché pública se invalida sola por trigger.
- **Ocultar de la web / Mostrar en la web.**
- **Descartar borrador:** vuelve a lo publicado.
- **Historial de cambios:** cada guardado, publicación, ocultamiento y restauración queda con autor, fecha y una copia completa. **Recuperar** deja esa versión como borrador para revisarla antes de publicar.

## Permisos

Se reutiliza la autenticación existente: sin registro público.

| Acción | Organizador | Administrador |
|---|:---:|:---:|
| Editar, guardar borradores, previsualizar, publicar, ocultar y recuperar versiones de páginas y novedades | ✔ | ✔ |
| Crear novedades | ✔ | ✔ |
| **Borrar** novedades | — (puede ocultarlas) | ✔ |
| Subir archivos, editar título y texto alternativo | ✔ | ✔ |
| **Borrar** archivos (sólo si no se usan) | — | ✔ |
| Patrocinadores y calendario | ✔ | ✔ |
| Datos de la web (contacto, sede, aviso) | ✔ | ✔ |
| **Ramas activas** (Damas) | — | ✔ |

## Edición simultánea

Cada contenido tiene una **versión**:

- Al guardar, el panel envía la versión que el organizador tenía abierta.
- Si otro guardó antes, la API responde **409**: "*Gabriela guardó cambios el 20/11 22:40. Recargá…*". **Nada se pisa en silencio.**
- El editor ofrece **Recargar la versión actual**.

El `UPDATE` se condiciona a la versión (`WHERE version = ?`). El historial y la auditoría se insertan sólo si ese `UPDATE` cambió la fila (`WHERE changes() > 0`), así un guardado perdedor no deja rastros falsos. Lo mismo vale para patrocinadores, eventos y datos de la web.

## Multimedia y almacenamiento

- **Workers KV** (gratis hasta 1 GB, sin tarjeta) guarda los archivos. En D1 queda sólo la ficha (tabla `media`): **ningún archivo multimedia se guarda en D1**.
- **Cloudflare R2, evaluado:** ofrece 10 GB gratis, pero exige registrar una tarjeta de pago para activarse. No se activó (no se habilitan servicios facturables sin autorización). Todo el acceso pasa por la interfaz `MediaStore` (`worker/lib/media.ts`): para usar R2 alcanza con otra implementación.
- **Optimización:** las imágenes se procesan en el navegador antes de subir. Quedan con un máximo de 1920 px, en WebP y **sin metadatos EXIF** (que pueden incluir la ubicación GPS de la foto). Una foto de celular de 4 MB queda en ~200–400 KB.
- **Validación en el servidor:**
  - sólo JPG, PNG, WebP (≤ 5 MB) y PDF (≤ 10 MB);
  - el **contenido real** se verifica por sus primeros bytes, no por la extensión;
  - SVG y HTML están rechazados (pueden contener scripts).
- **Duplicados:** se calcula la huella SHA-256. Si el archivo ya existe, se reutiliza en lugar de subirlo otra vez.
- **Servido:** desde `/media/<id>/<nombre>`, con caché de un año (los archivos nunca cambian), `nosniff` y una CSP `sandbox` que aísla cualquier archivo.
- **Borrado seguro:** sólo administradores, y sólo si el archivo no se usa en ninguna página, novedad (publicada **o en borrador**), patrocinador ni en la foto de la sede. La biblioteca muestra dónde se usa cada uno.

## Seguridad del contenido

- **Sin HTML libre:** todo contenido son bloques validados con Zod. El texto enriquecido se convierte con un analizador propio (`parseInline`) que produce segmentos escapados.
- **Enlaces:** sólo rutas internas, `https://` o `mailto:`. Se rechazan `javascript:`, `data:` y `//dominio`.
- **Plantillas:** todo el HTML se genera con escape automático.
- **Pruebas:** hay pruebas de inyección con `<script>`, `onerror`, `<svg onload>` y enlaces maliciosos.
- **Auditoría:** cada acción del CMS registra autor y fecha (`audit_log` y `site_revisions`).

## Integración con la web

Todas las pantallas de la Fase 7 consumen contenido del CMS:

- inicio por bloques;
- introducciones de Torneos, Rankings, Calendario y Novedades;
- Reglamentos, Liga, Cancha abierta, Premios y Contacto;
- novedades con portada;
- patrocinadores;
- foto de la sede;
- aviso destacado con vencimiento;
- menú sin las páginas ocultas.

Los únicos textos fijos en el código son de interfaz: botones, estados vacíos, etiquetas.

## Respaldo

- El respaldo `.sql` incluye las tablas nuevas (`media`, `site_sponsors`, `site_revisions`).
- Los **archivos** se descargan aparte desde **Respaldo → Descargar multimedia (.zip)** y se restauran con `node scripts/restore-media.mjs` (ver `docs/RESPALDO.md`).
