# Informe de pruebas y limitaciones (Fase 11)

Última corrida completa: **25/11/2026**, rama `fase11-lanzamiento`.

| Suite | Resultado | Cómo se corre |
|---|---|---|
| Pruebas unitarias y de integración (Vitest sobre `workerd` y D1 local, el mismo motor que Cloudflare) | **272 de 272 pasan** (21 archivos) | `npm test` |
| Pruebas de navegador (Playwright: Chromium de escritorio y Pixel 7 emulado) | **40 de 40 pasan** (31 PC + 9 celular) | `npm run test:e2e` |
| Verificación de tipos (TypeScript estricto) | Sin errores | `npm run typecheck` |
| Rastreo de enlaces sobre la app local con datos de demostración | 86 páginas, **0 problemas**; 268 direcciones de la web anterior: **todas 301 o 200** | `npm run check:links -- <url> --legacy` |
| Auditoría de dependencias de producción | **0 vulnerabilidades** | `npm audit --omit=dev` |
| Despliegue simulado (`wrangler deploy --dry-run`) en producción y en prueba | Configuración válida; cada entorno con su base y espacio de archivos | `scripts/deploy.mjs` |

**Sólo se informa como probado lo que se ejecutó.** Lo que no se pudo ejecutar está en la sección 3.

## 1. Cobertura por área (evidencia)

| Área pedida | Qué se verificó | Pruebas |
|---|---|---|
| **Web pública sin sesión** | Todas las secciones responden con título, descripción, canonical e idioma; 404 con diseño; rastreo de todos los enlaces internos; sin datos personales (correo, teléfono, documento, notas) en ninguna página; Damas no aparece ni por dirección directa | `test/site.test.ts`, `test/public.test.ts`, `test/lanzamiento.test.ts`, `e2e/phase7.spec.ts`, `e2e/mobile_web.spec.ts`, `e2e/mobile_lanzamiento.spec.ts` |
| **Panel administrativo** | Ingreso, credenciales inválidas, rutas protegidas, roles (organizador sin gestión de usuarios), cabeceras *noindex* y anti-iframe | `test/auth.test.ts`, `e2e/app.spec.ts`, `e2e/phase11.spec.ts` |
| **CMS** | Borrador → vista previa → publicar → visible; historial y recuperación; edición simultánea (409); XSS en bloques | `test/cms.test.ts`, `e2e/phase8.spec.ts`, `e2e/mobile_cms.spec.ts` |
| **Subida de imágenes** | Validación por contenido real; SVG y HTML rechazados; tamaños; duplicados; borrado sólo si no se usa (incluye archivos de torneos); purga de caché al borrar | `test/cms.test.ts`, `test/lanzamiento.test.ts`, `e2e/phase8.spec.ts`, `e2e/phase11.spec.ts` |
| **Publicación de contenidos** | Caché pública invalidada al publicar; lo no publicado no se ve | `test/cms.test.ts`, `test/fixtures.test.ts` |
| **Torneos con varias categorías** | Alta con C5–C8; una categoría; sin Damas; datos generales una sola vez; un torneo una vez en la web con selector de categoría | `test/multicategoria.test.ts`, `e2e/phase9.spec.ts`, `e2e/mobile_fixture.spec.ts` |
| **Gestión de torneos largos y fixtures** | Grupos, todos contra todos, programación, resultados con validación de marcador, retiros con W.O. | `test/fixture.test.ts` (motor), `test/fixtures.test.ts`, `e2e/phase9.spec.ts` |
| **Tablas de posiciones** | Puntos, sets, games, desempates configurables, empates sin resolver y orden manual | `test/fixture.test.ts`, `test/fixtures.test.ts` |
| **Copa de Oro y Plata** | Clasificación, cruces del reglamento (1°A–4°B…), BYE, avance de ronda, conflictos con partidos jugados | `test/fixture.test.ts`, `test/fixtures.test.ts`, `e2e/phase9.spec.ts` |
| **Satélites (cuadro final)** | Reconocimiento del cuadro de referencia, vinculación de jugadores, importación sin acreditar, acreditación; sin fixture | `e2e/phase3.spec.ts`, `e2e/phase5.spec.ts`, `e2e/mobile_circuito.spec.ts`, `test/automation.test.ts` |
| **Rankings automáticos** | Categoría principal correcta, sin duplicados, actualización pública inmediata, del fixture al ranking anual | `test/credits.test.ts`, `test/automation.test.ts`, `e2e/phase10.spec.ts`, `e2e/mobile_automation.spec.ts` |
| **Correcciones** | Corrección con motivo y diferencias; reversión; reacreditación transaccional; vista previa de efectos en el fixture | `test/credits.test.ts`, `test/automation.test.ts`, `e2e/phase2.spec.ts`, `e2e/phase10.spec.ts` |
| **Seguridad** | Ver sección 2 | Varias |
| **Rendimiento** | Ver sección 4 | Mediciones manuales |
| **Dispositivos móviles** | 9 circuitos en Pixel 7 emulado, sin desborde horizontal | `e2e/mobile*.spec.ts` |
| **Acceso simultáneo** | Dos organizadores sobre el mismo contenido o partido: el segundo recibe 409 y nada se pisa; acreditación doble rechazada | `test/cms.test.ts`, `test/fixtures.test.ts`, `test/credits.test.ts` |
| **Copias de seguridad** | Respaldo descargado y restaurado en una base nueva (fila por fila, todas las tablas, incluidas las nuevas); restauración con `wrangler` local | `test/backup.test.ts`, `e2e/phase5.spec.ts` |
| **Migraciones sobre datos anteriores** | Torneos viejos convertidos sin perder puntos, acreditaciones ni parejas | `test/migration.test.ts` |
| **Redirecciones y SEO** | 301 desde direcciones viejas (con acentos y subpáginas); sin redirecciones abiertas a sitios externos; robots, sitemap, *noindex* en panel, API, entorno de prueba y meses del calendario | `test/lanzamiento.test.ts`, `e2e/phase11.spec.ts` |
| **Entorno de prueba** | Franja visible, *noindex*, `robots.txt` bloquea todo; despliegue simulado contra su propia base | `test/lanzamiento.test.ts`, despliegue simulado |

## 2. Revisión de seguridad (previa a exponer a Internet)

| Punto | Estado |
|---|---|
| Contraseñas | PBKDF2-SHA256 (30.000 iteraciones, sal aleatoria). Nunca se guardan en claro. |
| Sesiones | Token aleatorio. En la base sólo se guarda su SHA-256. Cookie `HttpOnly`, `Secure`, `SameSite=Strict`, prefijo `__Host-` en HTTPS. Vencen solas. |
| Fuerza bruta | Bloqueo por usuario y por IP tras 5 intentos fallidos. |
| CSRF | Toda operación que modifica datos exige el mismo origen, además de la cookie `SameSite=Strict`. |
| Permisos | Toda la API exige sesión, salvo el ingreso y `/api/health`. Sólo administradores: usuarios, respaldos, borrado de archivos y novedades, anulación de resultados, redirecciones, ramas activas. |
| Inyección SQL | Todas las consultas con parámetros. Los pocos valores armados en el SQL son números o identificadores generados por el servidor. |
| XSS | HTML generado con escape automático. Contenidos por bloques validados (sin HTML libre). Enlaces sólo internos, `https:` o `mailto:`. CSP estricta en la web y en el panel. |
| Archivos subidos | Tipo verificado por su contenido, SVG y HTML prohibidos, servidos con CSP `sandbox` y `nosniff`. |
| Redirecciones | Sólo a direcciones de la misma web: no se pueden usar para llevar a sitios externos. |
| Datos personales | La web pública nunca muestra documento, teléfono, correo ni notas (probado rastreando todas las páginas). El respaldo `.sql` es confidencial (documentado). |
| Indexación | Panel, API y entorno de prueba con `noindex`; `robots.txt` excluye `/admin` y `/api/`. |
| Cabeceras | HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors` controlado. |
| Secretos | No hay claves en el repositorio (la app no usa servicios externos). `.dev.vars` y las planillas con nombres están excluidos. |
| Dependencias | `npm audit --omit=dev`: 0 vulnerabilidades. |
| Separación de entornos | El despliegue de prueba no puede apuntar a la base ni a los archivos de producción (control previo y verificación de la compilación). |

**Hallazgo corregido en esta revisión:** con el plugin de Vite, `wrangler deploy --env prueba` usaba la configuración de producción. Ahora `scripts/deploy.mjs` compila con el entorno pedido, verifica la compilación y usa la configuración explícita en las migraciones.

**También se corrigieron:**
- un archivo borrado seguía saliendo de la caché: ahora se purga al borrarlo, y la copia en caché dura como máximo un día;
- el calendario generaba páginas infinitas para los buscadores: ahora la navegación va de 3 años antes a 2 después, y los meses que no son el actual no se indexan.

## 3. Lo que **no** se pudo probar (limitaciones de este informe)

| No probado | Motivo | Cómo cubrirlo |
|---|---|---|
| **Infraestructura real de Cloudflare** | La app no se publicó (no hay cuenta ni autorización). Todo se probó sobre `workerd` y D1 locales, el mismo motor. | Publicar el **entorno de prueba** y correr `npm run check:links` y el circuito del manual (`PRODUCCION.md`, paso 3). |
| **CPU real por solicitud (límite de 10 ms)** | No se puede medir fuera de Cloudflare. Localmente las páginas tardan 14–52 ms de reloj, incluyendo la base local (la espera de la base no cuenta como CPU). | En el entorno de prueba: *Workers → Metrics → CPU time*. |
| **Dispositivos físicos y Safari de iPhone** | Sólo emulación de Pixel 7 (Chromium). | Recorrer el entorno de prueba con un iPhone y un Android reales. |
| **Pruebas de carga** (cientos de visitas simultáneas) | No hay infraestructura real. Las mediciones son de a una solicitud. | Cloudflare escala solo. El límite relevante es el diario (`COSTOS.md`). |
| **Dominio, DNS y certificado HTTPS** | Por indicación: no se cambia el dominio. | `DOMINIO.md`, paso 5 (lista de control). |
| **Subida real de las 241 imágenes históricas** | Necesita los torneos creados con sus fechas reales y un entorno publicado. Se probó la subida con una muestra contra la app local, dos veces seguidas, sin duplicar. | `MIGRACION_CONTENIDOS.md`, sección 3. |
| **Correos** | La app no envía correos. | — |

## 4. Rendimiento medido (build de producción, app local)

| Página | Primera vez | En caché | Tamaño |
|---|---:|---:|---:|
| `/` | 52 ms | 8 ms | 9,9 KB |
| `/torneos` | 21 ms | 9 ms | 4,5 KB |
| `/rankings` | 19 ms | 8 ms | 4,6 KB |
| `/calendario` | 17 ms | 6 ms | 6,6 KB |
| `/reglamentos` | 17 ms | 7 ms | 8,8 KB |
| `/contacto` | 14 ms | 7 ms | 7,5 KB |

- **Web pública:** HTML del servidor, sin JavaScript obligatorio.
- **Panel:** 111 KB comprimidos en la carga inicial; las pantallas pesadas se cargan bajo demanda.
- **Worker:** 690 KB (176 KB comprimido), muy por debajo del límite de 3 MB del plan gratuito.

## 5. Limitaciones conocidas

Ver [`LIMITACIONES.md`](LIMITACIONES.md) (funcionales y de infraestructura) y [`COSTOS.md`](COSTOS.md) (límites del plan gratuito).
