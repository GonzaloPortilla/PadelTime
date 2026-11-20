# Manual de operación para organizadores

Guía práctica para usar Padel Time desde la compu o el celular. No hace falta saber nada técnico.

---

## 1. Ingreso y cuentas

- Entrá a la dirección de la app con tu **usuario y contraseña**. No existe el registro público: las cuentas las crea un administrador.
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

**Torneos → Nuevo torneo:** nombre, tipo (*largo* o *americano*), temporada, categoría, división (opcional) y fechas. Después, en **Resumen**, tocá **Iniciar torneo**.

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

## 8. Publicación web y Google Sites

- **Publicación web** (administrador): activar las páginas públicas, el título y qué temporadas se muestran.
- Cada ranking tiene su **dirección pública** y su **código para incrustar** en Google Sites (*Insertar → Incorporar → Código*). Paso a paso en `docs/PUBLICACION.md`.
- Las páginas públicas nunca muestran DNI, teléfonos, correos, notas ni los motivos de los ajustes.

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
