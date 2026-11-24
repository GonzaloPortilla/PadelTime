# Limitaciones conocidas

Estado al cierre de la Fase 9 (noviembre de 2026). Ninguna afecta la integridad de los puntos.

## Infraestructura gratuita

| Limitación | Impacto | Mitigación |
|---|---|---|
| **10 ms de CPU por solicitud** (plan gratuito) | Importar rankings de **más de ~1000 filas** en un solo paso puede fallar con un error del servidor. Validar 3000 filas lleva entre 12 y 45 ms de CPU. | La app avisa en la vista previa. Importar por hojas: cada importación es independiente y reversible. |
| **100.000 solicitudes por día** | Un pico muy grande de visitas a los rankings públicos (decenas de miles en un día) podría agotar el cupo. La app y los rankings dejarían de responder hasta las 21:00 de Argentina. No hay cobro. | Uso esperado: muy por debajo. Las páginas públicas responden 304 (sin recalcular) cuando no cambiaron. Con dominio propio, la caché de Cloudflare absorbe más tráfico. |
| **Time Travel de 7 días** | Para volver a un estado de hace más de una semana hace falta un respaldo descargado. | Respaldo semanal desde la app (`docs/RESPALDO.md`). |
| **Sin alta disponibilidad garantizada** | Una caída de Cloudflare deja la app sin servicio mientras dure. | Los datos se conservan. Exportaciones a Excel como plan B para publicar. |
| **Sin correo electrónico** | No hay "olvidé mi contraseña" por mail: los servicios de envío confiables tienen costo o requieren configurar un dominio. | Un administrador resetea la contraseña desde **Usuarios**, o por terminal con `npm run user:create -- --reset`. |

## Gestor de contenidos (Fase 8)

| Limitación | Detalle |
|---|---|
| **Espacio para archivos: 1 GB** (Workers KV gratis) y 1000 subidas por día | Con la optimización automática alcanza para miles de fotos. Si hiciera falta más, Cloudflare R2 da 10 GB gratis, pero exige registrar una tarjeta: no se activó. |
| **Sin páginas nuevas arbitrarias** | Se editan las páginas de la web (Inicio, Reglamentos, Liga, Cancha abierta, Premios, Contacto e introducciones). Las noticias se publican como Novedades. Crear secciones nuevas en el menú requiere un cambio de código. |
| **Vista previa** | Muestra lo último guardado: si hay cambios sin guardar, primero los guarda como borrador. |
| **Edición simultánea** | No hay bloqueo mientras alguien edita: el segundo en guardar recibe un aviso y debe recargar (no se mezclan los cambios automáticamente). |
| **Formato del texto** | Negrita, cursiva y enlaces. No hay tablas, colores ni tipografías libres (a propósito, para mantener el diseño y la seguridad). |
| **Imágenes** | Sólo JPG, PNG y WebP; las animaciones (GIF) y SVG no se admiten. |

## Fixtures (Fase 9)

| Limitación | Detalle |
|---|---|
| **Desempates y W.O.** | El reglamento publicado no fija el orden de desempate ni cómo cuenta un W.O. en la tabla: son configurables por categoría y vienen con una propuesta que hay que confirmar. |
| **Sin ida y vuelta** | La fase de grupos es todos contra todos a una rueda. |
| **Puntos del ranking** | El fixture no acredita puntos solo: al final, las instancias se cargan en *Parejas y resultados* y se acredita como siempre (la lógica de acreditación no se modificó en esta fase). |
| **Publicación manual** | La web muestra el fixture publicado: después de cargar resultados hay que tocar **Publicar cambios**. |
| **Satélites / Americanos** | No tienen fixture (por definición): siguen con cuadro final y acreditación. |
| **Inscripción** | La cargan los organizadores. No hay inscripción pública con cuentas de jugadores. |
| **Datos por categoría** | Nombre, fechas, sede e información pública son del torneo y se copian a todas sus categorías. No hay fechas o premios distintos por categoría (las notas internas sí son por categoría). |

## Funcionales

| Limitación | Detalle |
|---|---|
| **Edición simultánea del mismo torneo** | Si dos organizadores editan los resultados del mismo torneo a la vez, prevalece el último que guarda: no hay bloqueo de edición. Para la **acreditación** sí hay protección: se rechaza si los datos cambiaron desde la previsualización, y nunca se acredita dos veces. |
| **Reconocimiento de cuadros** | Está calibrado para cuadros de eliminación impresos o digitales (el formato de referencia: octavos, cuartos, semis y final). Fotos torcidas, borrosas o escritas a mano reducen la precisión. Siempre hay una pantalla de revisión antes de importar. Detalle en `docs/OCR.md`. |
| **Formatos de torneo** | El puntaje se asigna por **instancia alcanzada** (más bonus opcionales por partidos). Desde la Fase 9, los torneos largos tienen grupos con tabla de posiciones en la pestaña Fixture, pero la instancia de cada pareja para los puntos se sigue asignando a mano. |
| **Cambio de categoría a mitad de temporada** | Los puntos ya ganados quedan en la categoría donde se acreditaron, también si después se corrige ese torneo. Si se necesita **mover** puntos históricos a la categoría nueva, hay que revertir el torneo y volver a acreditarlo, o usar ajustes manuales con motivo. No hay "traspaso de puntos" automático. |
| **Divisiones y ajustes manuales** | Los ajustes manuales suman en el ranking general de la categoría, no en el de una división específica. |
| **Rama del jugador** | No se puede cambiar la rama (Caballeros/Damas) de un jugador que ya tiene torneos o puntos. Si fue un error de carga, hay que darlo de alta de nuevo con la rama correcta. |
| **Saldos importados** | Se revierten por importación completa, no por fila. Para corregir a un solo jugador se usa un ajuste manual. |
| **Bloqueo de ingreso por usuario** | Tras 5 intentos fallidos se bloquea el usuario 15 minutos. Alguien que conozca un nombre de usuario podría bloquearlo a propósito durante ese lapso. El bloqueo se levanta solo, o un administrador resetea la contraseña. |
| **Respaldo desde la app** | Se restaura con comandos de terminal (`wrangler`), sobre una base nueva. No hay "restaurar" con un botón: es intencional, para que nadie pise la base de producción por error. |
| **Google Sites** | No modifiqué Google Sites. La integración consiste en pegar la dirección o el código de cada ranking (`docs/PUBLICACION.md`). Si Google cambia los dominios desde donde sirve el contenido incrustado, habría que actualizar `PUBLIC_FRAME_ANCESTORS`. |
| **Idioma y zona horaria** | Interfaz sólo en español rioplatense. Fechas en horario de Argentina. |

## Probado y no probado

- **Probado automáticamente** en Chromium de escritorio y en Pixel 7 emulado (Playwright).
- **No probado en dispositivos físicos** ni en Safari de iPhone, aunque la app usa sólo funciones estándar. Conviene una prueba rápida en un iPhone real después de publicar.
- **No probado contra la infraestructura real de Cloudflare**, porque la app no se publicó (por indicación). Todas las pruebas corren sobre el mismo motor (`workerd` y D1 local) que usa Cloudflare.
