# Manual de operación para organizadores

Guía práctica para usar Padel Time desde la compu o el celular. No hace falta saber nada técnico.

---

## 1. Ingreso y cuentas

- El panel está en **`/admin`** (por ejemplo, `https://padel-time.<subdominio>.workers.dev/admin`). La raíz de la dirección es la web pública, abierta a todos.
- Entrá con tu **usuario y contraseña**. No existe el registro público: las cuentas las crea un administrador.
- Tras 5 intentos fallidos, el ingreso se bloquea 15 minutos.
- Tu contraseña la cambiás desde **Mi cuenta** (abajo en el menú). Al cambiarla se cierran tus sesiones en otros dispositivos.
- Las sesiones duran 30 días sin uso. En una compu compartida, tocá **Salir** al terminar.

### Roles

| Puede… | Organizador | Administrador |
|---|:---:|:---:|
| Jugadores, torneos, resultados, acreditaciones, correcciones, ajustes | ✔ | ✔ |
| Importar rankings y exportar a Excel | ✔ | ✔ |
| Cerrar una temporada | ✔ | ✔ |
| **Reabrir** una temporada cerrada | — | ✔ |
| Configurar la publicación web | — | ✔ |
| Crear y desactivar usuarios | — | ✔ |
| Descargar el **respaldo** de la base | — | ✔ |

---

## 2. Preparación de la temporada (una vez por año)

1. **Categorías:** creá las categorías de cada rama (por ejemplo 4ta, 5ta y 6ta, en Caballeros y en Damas), con su nivel. Si usan divisiones (A/B, Oro/Plata), agregalas dentro de cada categoría.
2. **Temporada:** en **Temporadas**, creá la del año con sus fechas y tocá **Activar**. Sólo puede haber una activa.
3. **Puntuación:** en **Puntuación** revisá las plantillas (*Torneo largo estándar*, *Americano estándar*). Cada torneo nuevo copia la de su tipo y después se puede ajustar sólo para ese torneo.
4. **Rankings anteriores:** si venís de una planilla, importala desde **Importar rankings** (ver sección 7).

---

## 3. Circuito de cada torneo

**Crear torneo → configurar puntos → cargar cuadro → identificar jugadores → revisar → confirmar → acreditar → rankings públicos actualizados**

### 3.1 Crear el torneo

**Torneos → Nuevo torneo:** nombre, tipo (*largo* o *americano*), temporada, fechas, información pública y las **categorías participantes**, con casillas. Se crea un torneo con una pestaña por categoría.

- En cada categoría: en **Resumen**, tocá **Iniciar torneo**. En un torneo largo con fixture, armar el fixture lo inicia solo.
- Para torneos históricos que sólo tienen imágenes de resultados: **Resumen → Archivos de resultados** (ver `docs/MIGRACION_CONTENIDOS.md`).

### 3.2 Configurar los puntos

Pestaña **Puntuación**:

- Cada instancia (Campeón, Finalista, Semifinal…) tiene sus puntos y su cupo de parejas.
- **Regla general:** cada pareja recibe los puntos de la instancia que alcanzó. El campeón recibe los de campeón, sin sumar las fases anteriores.
- **Puntaje acumulativo:** activalo sólo si el reglamento de ese torneo dice que se suman todas las fases.
- Bonus opcionales: por participar, por partido jugado y por partido ganado.
- Estos cambios afectan sólo a este torneo. La plantilla queda igual.

### 3.3 Cargar el cuadro

Hay dos formas:

- **Importar cuadro** (recomendado): subí la foto o captura del cuadro y tocá **Reconocer cuadro**. La lectura se hace en tu dispositivo y tarda unos segundos.
  - Revisá en pantalla nombres, resultados y ganadores. Corregí lo que haga falta: los campos dudosos aparecen marcados.
- **Parejas y resultados** (manual): inscribí las parejas y elegí para cada una la instancia alcanzada y, si se usan bonus, los partidos jugados y ganados.

### 3.4 Identificar a los jugadores

- La app vincula sola a los jugadores ya registrados, aunque el cuadro tenga diferencias de acentos o diminutivos.
- Para cada nombre podés elegir otro jugador, o **crear uno nuevo**.
- Si un nombre está incompleto (por ejemplo, sólo un apodo), completá nombre y apellido.
- Ante **homónimos** (dos "Juan Pérez"), fijate en el **código** (J-00012) y en la categoría: así se distinguen.
- Los jugadores nuevos se crean sólo cuando confirmás.

### 3.5 Revisar y confirmar la importación

- La **Confirmación** muestra todas las parejas con su instancia y sus puntos.
- Marcá *"Revisé la lista completa"* e importá.
- **Importar no acredita puntos:** todavía no cambia ningún ranking.

### 3.6 Acreditar

Pestaña **Acreditación**:

- La **previsualización** muestra cada jugador, su compañero, la instancia, los puntos y **la categoría donde los va a sumar**: siempre su categoría principal, aunque haya jugado otra.
- Revisá los avisos:
  - en **rojo**, errores que impiden acreditar (falta una instancia, un cupo excedido, un jugador repetido);
  - en **amarillo**, avisos (por ejemplo, un jugador inactivo).
- Tocá **Confirmar y acreditar puntos**. Cada integrante de la pareja recibe exactamente los mismos puntos.
- Al acreditar, el torneo pasa a *Finalizado*. Los rankings internos y las páginas públicas se actualizan **al instante**, sin tocar Google Sites.
- Un torneo **nunca se acredita dos veces**: aunque dos organizadores confirmen a la vez, se registra una sola acreditación.

---

## 4. Correcciones y anulaciones

| Situación | Qué hacer |
|---|---|
| Un resultado estaba mal (torneo ya acreditado) | Corregí resultados o parejas → **Acreditación** → aparece *Corrección* con las diferencias jugador por jugador → indicá el **motivo** → confirmar. La versión anterior queda reemplazada y se descuentan sus puntos exactos. |
| El torneo no debía sumar puntos | **Acreditación → Revertir** (con motivo). Los puntos vuelven a cero y el torneo se puede volver a acreditar. |
| El torneo se suspendió | **Revertir** y marcar *Anular torneo*: queda cancelado. |
| Bonificación o sanción a un jugador | **Jugadores** → ficha del jugador → **Ajuste manual** con puntos positivos o negativos y motivo. |
| Un ajuste estaba mal | Ficha del jugador → historial → **Anular** el ajuste. |

**Nada se borra.** Cada corrección queda en el historial con fecha, usuario y motivo. Si un jugador cambió de categoría después de un torneo, los puntos de ese torneo se quedan en la categoría donde se ganaron, aun si después se corrige el torneo.

---

## 5. Rankings e historial

- **Rankings:** por temporada, categoría y división. Los empates se resuelven con los criterios de la temporada (títulos, finales, etc., configurables). Si persiste el empate, los jugadores comparten la posición (1, 2, 2, 4).
- **Exportar:** desde el ranking, descargalo a **Excel** o **CSV** (uno o toda la temporada).
- **Ficha del jugador:** puntos por temporada y categoría, y todos sus movimientos (torneos, correcciones, ajustes y saldos importados).
- **Movimientos:** el libro completo, con filtros por temporada, jugador, torneo y tipo.

---

## 6. Cierre de temporada

1. Verificá que no queden torneos *programados* o *en curso* (finalizalos o cancelalos).
2. **Descargá un respaldo** (lo hace un administrador).
3. **Temporadas → Cerrar**.

Una temporada cerrada es **histórica e intocable**:

- No admite resultados, acreditaciones, correcciones, ajustes ni cambios de desempate.
- Su ranking sigue visible y exportable.
- Sólo un administrador puede reabrirla para corregir un error. Después hay que volver a cerrarla.

Al activar la temporada siguiente, todos arrancan en cero. La anterior se conserva tal cual.

---

## 7. Importar rankings existentes (Excel o CSV)

1. **Importar rankings** → elegí el archivo (de Google Sheets: *Archivo → Descargar → Excel*).
2. **Columnas:** confirmá qué columna es el jugador y cuál los puntos. Se configura una sola vez para todo el archivo, no fila por fila.
3. **Valores:** asigná temporada, categoría y división. Cada valor distinto aparece una sola vez.
4. **Jugadores:** revisá las vinculaciones y los jugadores nuevos.
5. **Vista previa** → **Confirmar**. Los puntos quedan como *Saldo inicial importado*.

Detalles:

- El mismo archivo no se puede importar dos veces.
- Una importación completa se puede **revertir** desde el historial.
- Para archivos muy grandes (más de 1000 filas), importá las hojas de a una.

---

## 7 bis. Contenidos de la web (Contenidos web)

Desde **Contenidos web** se edita todo lo que se ve en la web, sin programar. Detalle técnico en `docs/CMS.md`.

1. **Páginas:** elegí la página (Inicio, Reglamentos, Liga…), cambiá los textos y los bloques.
   - **Guardar borrador** guarda sin publicar.
   - **Vista previa** muestra cómo va a quedar.
   - **Publicar** lo deja visible en la web al instante.
2. **Inicio:** el **banner** (título, frase, foto y botones), las secciones informativas y el **orden** de las secciones automáticas (torneos, novedades, rankings, patrocinadores, sede).
   - El ojo oculta un bloque sin borrarlo.
   - En "Próximo torneo destacado" podés elegir el torneo o dejarlo automático.
3. **Novedades:** **Nueva novedad** → escribí → publicá. Para sacarla de la web, **Ocultar** (sólo un administrador puede borrarla).
4. **Multimedia:** subí fotos (se optimizan solas) y PDF.
   - Completá el **texto alternativo**: describe la imagen para buscadores y lectores de pantalla.
   - Un archivo en uso no se puede borrar.
5. **Patrocinadores:** logo, nombre y enlace, en el orden que quieras.
6. **Calendario:** cargá las **canchas abiertas** y otros eventos. Aparecen en el calendario y en la página Cancha abierta.
7. **Datos de la web:** WhatsApp (el número de los botones de inscripción), Instagram, sede, foto de la sede y el **aviso destacado** con fecha de vencimiento.

**Si dos organizadores editan lo mismo:** el segundo en guardar ve un aviso con quién guardó antes y un botón para recargar. Nada se pisa sin avisar. Toda versión anterior se puede **recuperar** desde **Historial de cambios**.

## 7 ter. Torneos con varias categorías y fixtures (pestaña Fixture)

Sólo para torneos largos. Los Satélites / Americanos siguen con su cuadro final. Un torneo puede tener varias categorías: el fixture es de cada categoría. Detalle en `docs/FIXTURES.md`.

1. **Torneos → Nuevo torneo:** nombre, tipo, fechas e información pública una sola vez, y las **categorías participantes** con casillas (por ejemplo C5, C6, C7 y C8). Dentro del torneo hay una pestaña por categoría: cada una se juega, finaliza y acredita por su cuenta.
2. En cada categoría, **Parejas y resultados:** inscribí las parejas eligiendo jugadores de la base y marcá las cabezas de serie.
3. Pestaña **Fixture**:
   - **Configuración:** cantidad de grupos, cuántas pasan a Oro y a Plata, formato de los partidos y **orden de desempate**. Confirmá ese orden con la organización: el reglamento no lo define.
   - **Grupos y parejas:** **Proponer grupos** → mové lo que haga falta → **Confirmar grupos y generar partidos**.
   - **Partidos:** **Programar por fechas** (una por semana) o fecha, hora y cancha de cada partido. **Resultado** carga el marcador por set: la app avisa si es imposible.
   - **Posiciones:** se calculan solas. Si queda un empate sin resolver, **Definir orden** (por ejemplo, por sorteo).
   - **Copa de Oro / Plata:** al terminar los grupos aparece la propuesta de cruces. Tocá dos lugares para intercambiarlos y **Confirmar**. Los ganadores pasan solos a la ronda siguiente.
   - **Publicar** (barra superior): la web muestra el fixture tal como lo publicaste. Después de cargar resultados, **Publicar cambios**.
4. **Corregir** un resultado pide motivo. Si cambia quién debía jugar un partido que ya se jugó, la app no lo toca: aparece en **Problemas** y lo resuelve un administrador (**Anular ese resultado** y cargarlo de nuevo).
5. Si una pareja abandona: **Grupos y parejas → Retirar**, con W.O. en sus partidos pendientes.
6. **Al terminar la competencia** (pestaña **Puntos**):
   - aparecen las posiciones finales y la instancia de puntuación de cada una;
   - revisá la Copa de Plata (el reglamento no define sus puntos);
   - controlá la distribución;
   - **Aplicar posiciones al torneo** → **Ir a Acreditación** → **Confirmar y acreditar puntos**.

   Los rankings se actualizan al instante. Nada se acredita hasta esa confirmación.
7. **Si después hay que corregir un resultado:**
   - **Corregir** → **Revisar cambios** (muestra posiciones, cruces, conflictos y si hay puntos acreditados) → motivo → **Guardar**;
   - si el torneo ya tenía puntos: en **Puntos** se ven las diferencias por jugador → **Aplicar corrección al torneo** (con motivo) → **Confirmar corrección** en Acreditación.
8. Con fixture, la carga manual de instancias en *Parejas y resultados* queda bloqueada: todo sale del fixture.

## 8. Publicación web y Google Sites

- **Publicación web** (administrador): activar las páginas públicas, el título y qué temporadas se muestran.
- Cada ranking tiene su **dirección pública** y su **código para incrustar** en Google Sites (*Insertar → Incorporar → Código*). Paso a paso en `docs/PUBLICACION.md`.
- Las páginas públicas nunca muestran DNI, teléfonos, correos, notas ni los motivos de los ajustes.

### Publicar un torneo en la web

1. Abrí el torneo → **Editar datos** → sección **Web pública**.
2. Marcá **Publicar en la web** y elegí la **Modalidad** (Open 1000, Challenger 500, Satélite 100, Master Final 2000).
3. Opcional:
   - **Destacado**: se resalta en la portada;
   - **Inscripción abierta**: muestra el botón *Inscribirme*, que abre WhatsApp con el mensaje armado;
   - **Información para la web**: horarios, formato, costo;
   - **Premios**.
4. Guardá. La ficha muestra **En la web ↗** con el enlace a la página pública.

Las **Notas internas** nunca se publican. Mientras un torneo no está publicado, no aparece en la web.

### Datos de la web (administrador)

En **Publicación web → Datos de la web** se editan:

- la frase de presentación;
- el número de WhatsApp y el mensaje inicial;
- Instagram;
- la sede, la dirección y las coordenadas del mapa;
- el **aviso destacado**, la franja verde arriba de todas las páginas. Por ejemplo: "Próximo torneo Portugal P2 360 el 26 de diciembre". Vacío no se muestra;
- las **ramas activas**: Damas está desmarcada, así que no aparece en la web ni en las altas nuevas. Sus datos históricos se conservan.

---

## 9. Uso desde el celular

- Todo funciona en el celular: el menú se abre con el botón ☰ arriba a la izquierda.
- Las tablas largas se desplazan dentro de su recuadro.
- Para importar un cuadro desde el teléfono, elegí la foto de la galería o sacala en el momento. Conviene una foto derecha, nítida y con buena luz.
- Se puede agregar a la pantalla de inicio: en Android, *menú del navegador → Agregar a pantalla principal*; en iPhone, *Compartir → Agregar a inicio*.

---

## 10. Trabajo simultáneo de varios organizadores

- Pueden trabajar a la vez sobre torneos distintos sin problema.
- Sobre el **mismo torneo**, el último que guarda resultados es el que queda. Antes de acreditar, la app compara con lo que vio cada uno: si alguien cambió algo mientras tanto, pide **revisar de nuevo** en lugar de acreditar datos viejos.
- Una acreditación o corrección hecha por dos personas a la vez se registra una sola vez.
- **Fixture:** dos organizadores pueden cargar resultados de partidos distintos a la vez. Si los dos cargan el mismo partido o cambian la configuración, grupos o cuadros al mismo tiempo, el segundo recibe un aviso con el nombre y la hora del otro, y recarga. Nada se pisa.

---

## 11. Rutina recomendada

| Cuándo | Qué |
|---|---|
| Después de cada torneo | Cargar cuadro → revisar → acreditar el mismo día. Mirar el ranking público. |
| Cada semana | Un administrador descarga el **respaldo**. |
| Antes de importar o cerrar una temporada | Respaldo. |
| Fin de temporada | Cerrar la temporada, exportar los rankings a Excel y activar la nueva. |

## 12. Si algo no funciona

| Síntoma | Qué hacer |
|---|---|
| "Tu sesión expiró" | Volvé a ingresar. |
| "Demasiados intentos fallidos" | Esperá 15 minutos o pedile a un administrador que resetee tu contraseña. |
| "Los resultados cambiaron desde que se generó la previsualización" | Otro organizador modificó el torneo: recargá y revisá antes de confirmar. |
| "La temporada está cerrada" | Es intencional: pedile a un administrador que la reabra sólo si hay que corregir algo. |
| El reconocimiento del cuadro leyó mal | Corregí en la pantalla de revisión, o cargá los resultados a mano en **Parejas y resultados**. |
| La app no carga en ningún dispositivo | Puede ser una caída de Cloudflare o el límite diario gratuito: se normaliza sola (a más tardar a las 21:00). Los datos no se pierden. |
