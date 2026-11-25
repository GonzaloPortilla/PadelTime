# Fixtures de torneos largos (Fase 9)

Gestión de grupos, partidos, resultados, tablas de posiciones y cuadros de **Copa de Oro / Copa de Plata**, **sólo para torneos largos**.

Los **Satélites / Americanos** no tienen fixture. Siguen como hasta ahora: se carga el cuadro final (a mano o por imagen) y se acreditan los puntos.

## Torneos con varias categorías

Un **torneo** es un evento general que incluye una o más categorías. Por ejemplo, *Open Padel Time — Noviembre 2026* con C5, C6, C7 y C8.

- **Panel → Torneos → Nuevo torneo.** Los datos generales se cargan una sola vez: nombre, tipo, temporada, fechas, sede, modalidad e información pública.
- Las categorías se eligen con **casillas**: categorías activas y sus divisiones. Damas no se ofrece porque está discontinuada.
- Cada categoría elegida es una **competencia** independiente, con:
  - sus parejas;
  - grupos, fixture, partidos, resultados y tablas;
  - Copa de Oro y Copa de Plata;
  - su puntuación;
  - su estado (programado, en curso o finalizado);
  - su acreditación.
- Una categoría puede terminar y acreditarse mientras las otras siguen en juego. El estado del torneo se deriva de sus categorías.
- Dentro del torneo hay una **pestaña por categoría**, encima de las secciones Resumen, Parejas, Fixture, etc., y un botón **Agregar categoría**.
- **Editar datos** cambia los datos generales y los copia a todas las categorías. La temporada y la categoría de cada competencia no cambian.
- Un torneo sólo se borra si ninguna categoría tiene parejas, partidos o puntos. Borrar la última categoría elimina el torneo vacío.
- Los Satélites / Americanos también se crean como torneo (con una o varias categorías), pero siguen sin fixture: se carga el cuadro final por imagen o a mano y se acredita.

**Modelo de datos.** No hay entidades nuevas:

- **Torneo** = `tournament_events`.
- **Competencia** = `tournaments`: una categoría, y división opcional, de un único torneo.

Todo lo que ya colgaba de la competencia (parejas, puntuación, acreditaciones, movimientos, rankings, importaciones de cuadros, fixture) no cambia.

La migración 0008:

- convierte cada torneo anterior de una categoría en un torneo con una competencia, conservando el mismo id, así que los enlaces y los puntos no cambian;
- impide repetir una categoría dentro de un torneo.

**Web pública.**

- El torneo aparece **una sola vez** en Inicio, Torneos, Calendario y Premios, con sus categorías: «C5 · C6 · C7 · C8».
- Al entrar, el visitante elige la categoría en la barra **Categorías**.
- Cada categoría muestra sus propios fixture, resultados y tablas.

## Circuito de una categoría (pestaña Fixture del torneo)

1. **Configuración**
   - **Formato:** "Fase de grupos y copas" o "Eliminación directa".
   - **Cupo de parejas:** opcional.
   - **Cantidad de grupos.**
   - **Clasificación:**
     - pasan a **Oro** los N primeros de cada grupo;
     - **Plata** se juega con las restantes, con una cantidad fija por grupo, o no se juega.
   - **Partidos:**
     - sets (a 1, al mejor de 3 o de 5) y games por set;
     - tie break, y si el último set es completo o súper tie break.
   - **Desempates:** en orden y editables (ver más abajo).
   - **W.O.:** cómo cuenta en la tabla.
   - **Cabezas de serie por ranking** (opcional): ordena por la suma de puntos de la temporada de los dos integrantes, como indica el reglamento del Master.
2. **Parejas**
   - Se inscriben en **Parejas y resultados**: se eligen jugadores de la base y se define la cabeza de serie.
   - Antes de empezar se agregan o quitan libremente.
   - Una vez en el fixture, la pareja queda **fija**: no se cambian sus jugadores ni se borra. Si no puede seguir, se registra su **retiro**, con opción de W.O. en sus partidos pendientes.
3. **Grupos**
   - Propuesta en serpentina: las cabezas de serie quedan en grupos distintos.
   - Se arma por orden de inscripción o por sorteo.
   - Se puede mover cualquier pareja de grupo antes de confirmar.
   - Al confirmar se generan los partidos **todos contra todos**, repartidos en fechas: nadie juega dos veces por fecha y, con número impar, una pareja queda libre.
4. **Partidos**
   - Fecha, hora y cancha de cada partido.
   - **Programar por fechas** asigna las fechas de una vez. La fecha 1 se juega el día de inicio y cada fecha siguiente, una semana después (configurable).
5. **Resultados**
   - Se carga el marcador por set. La app valida el resultado, identifica al ganador y actualiza las tablas.
   - Tipos de resultado: jugado, **retiro**, **W.O.** o **resultado administrativo**.
   - **Corregir** un resultado exige motivo y queda en el **Historial**: quién, cuándo, antes y después.
6. **Posiciones**
   - Tabla de cada grupo: PJ, PG, PP, sets y games, ordenada según los desempates configurados.
   - Si un empate no se resuelve con ningún criterio, queda marcado y se define **a mano** (por ejemplo, por sorteo). Hasta entonces no se pueden armar las copas.
7. **Copa de Oro / Plata**
   - Cuando terminan los grupos, la app **propone** los cuadros.
   - Siembra estándar: los primeros de grupo arriba y separados.
   - Con dos grupos se produce el cruce del reglamento: 1°A–4°B, 2°B–3°A, 1°B–4°A, 2°A–3°B.
   - Con más grupos se evita que dos parejas del mismo grupo se crucen en la primera ronda.
   - Si faltan parejas para completar el cuadro, los mejores sembrados tienen **pase libre (BYE)**.
   - Se pueden intercambiar lugares antes de confirmar.
   - Rondas: 32avos, 16avos, octavos, cuartos, semifinales y final, según la cantidad de clasificados.
8. **Avance de ronda:** el ganador pasa solo a la ronda siguiente, y el BYE avanza solo.
9. **Publicar:** la web muestra **sólo lo publicado**. Mientras tanto se puede cargar y revisar. El panel avisa si hay "cambios sin publicar".

En **eliminación directa** no hay grupos: el cuadro se arma con las cabezas de serie (1 y 2 en mitades opuestas) y BYE para los primeros.

## Correcciones que afectan partidos ya jugados

- Si una corrección cambia quién debía jugar un partido **que todavía no se jugó**, el cruce se actualiza solo.
- Si ese partido **ya tiene resultado**, **no se sobrescribe**. Aparece un **conflicto** en **Problemas**, que se resuelve así:
  - un **administrador** anula el resultado posterior: el partido vuelve a pendiente con la pareja correcta y se carga de nuevo;
  - o se revierte la corrección.
- Problemas que también se detectan:
  - empates sin resolver;
  - parejas retiradas con partidos pendientes;
  - parejas sin grupo;
  - dos partidos en la misma cancha y horario;
  - una pareja con dos partidos a la misma hora.

## Reglas: qué está confirmado y qué es configurable

Confirmado en el reglamento publicado (página Reglamentos):

- 3 sets con tie break en 6-6;
- grupos todos contra todos;
- los primeros a Copa de Oro y los restantes a Copa de Plata;
- Challenger: los 2 primeros de cada grupo a Oro;
- Master: 2 grupos de 4, cabezas de serie por ranking (suma de los dos integrantes) y cruces 1°A–4°B, 2°A–3°B.

**No definido en el reglamento**: configurable y con aviso en el panel.

- **Orden de desempate.** Propuesta inicial: partidos ganados, resultado entre las empatadas, diferencia de sets, diferencia de games. Disponibles también: sets ganados y games ganados. Hay que confirmarlo con la organización.
- **W.O. en la tabla:** sólo el partido, o como 6-0 en los sets necesarios.
- **Retiro y resultado administrativo:** cuentan los games cargados.
- **Súper tie break** (si se usa): cuenta como set, sin sumar games.
- **Empate total:** no se inventa un criterio. Se define a mano y queda en la auditoría.

## Permisos y edición simultánea

| Acción | Organizador | Administrador |
|---|:---:|:---:|
| Configurar, armar grupos y cuadros, programar, cargar y corregir resultados (con motivo), retirar parejas, publicar | ✔ | ✔ |
| **Anular** resultados (resolución de conflictos) | — | ✔ |

- Cada operación sobre la estructura (configuración, grupos, cuadros, publicación, retiros) exige la **versión** que el organizador tenía en pantalla. Si otro cambió algo, recibe el aviso con nombre y hora, y recarga.
- Los resultados se controlan **por partido**: dos personas cargando partidos distintos no se bloquean, pero si dos cargan el mismo, el segundo recibe el aviso.
- Las escrituras se hacen en un único lote protegido. Si otro escribió en el medio, no se aplica nada.

## Del fixture a los puntos y al ranking (Fase 10)

El fixture alimenta al **mismo** motor de puntuación y acreditación de siempre: no hay un segundo sistema de puntos.

**Circuito completo de un torneo largo** (por categoría: cada una pasa del fixture a los puntos y se acredita por su cuenta, aunque las demás sigan en juego):

1. Crear el torneo (Torneos → Nuevo torneo) con sus categorías y entrar a la categoría.
2. Registrar las parejas.
3. Generar grupos y fixture. El torneo pasa solo a **En curso**.
4. Cargar resultados.
5. Las posiciones se actualizan solas.
6. Se determinan los clasificados a Oro y Plata.
7. Se completan los cuadros.
8. Al terminar, la pestaña **Fixture → Puntos** muestra las **posiciones finales** de cada pareja.
9. Cada posición se asocia a una **instancia de la puntuación del torneo**: la plantilla configurada, editable en Puntuación.
10. Se revisa la **distribución de puntos**, calculada por el motor existente (`computePreview`), con las mismas reglas de categoría principal, bonificaciones y cupos.
11. **Aplicar posiciones al torneo** completa la instancia, los partidos jugados y los ganados de cada pareja: las mismas entradas que se cargaban a mano. El torneo pasa a **Finalizado**. **No acredita.**
12. En **Acreditación** se confirma con el flujo de siempre, y los rankings públicos se actualizan solos.

**Posiciones finales y equivalencia propuesta (editable):**

| Posición final | Instancia propuesta |
|---|---|
| Campeón de Oro (o del cuadro) | Campeón |
| Finalista de Oro | Finalista |
| Semifinal / Cuartos / Octavos de Oro | Semifinal, Cuartos de final, Octavos de final |
| Cualquier posición de Plata | **Fase de grupos**, marcado «Revisar»: el reglamento no define puntos para la Plata. Si corresponden otros, se agrega la instancia en Puntuación y se elige. |
| No pasó de la fase de grupos | Fase de grupos |

**Partidos para las bonificaciones:** cuentan los jugados, con retiro o con resultado administrativo. Un W.O. o un BYE no son partidos disputados.

**Nunca se acredita por cargar un resultado.** No hay ninguna regla de acreditación automática.

### Una sola fuente de verdad

- Si un torneo tiene partidos en el fixture, sus instancias **sólo** salen del fixture. La carga manual en *Parejas y resultados* y la importación de cuadro quedan bloqueadas para ese torneo (se pueden seguir inscribiendo parejas).
- La acreditación se rechaza mientras el fixture no terminó o sus posiciones finales no están aplicadas. Así nunca se acreditan datos viejos ni a medio cargar.

### Correcciones

1. Al corregir un resultado, **Revisar cambios** muestra, antes de guardar:
   - cambios de posiciones en los grupos;
   - cruces sin jugar que se actualizan solos;
   - **conflictos** con partidos ya jugados, que no se sobrescriben;
   - cambios en las posiciones finales;
   - y si el torneo tiene puntos acreditados.
2. Se guarda con **motivo**: responsable, fecha y motivo quedan en el historial y la auditoría.
3. Si el torneo ya acreditó, los puntos **no cambian solos**. Aparece el problema «Los resultados cambiaron después de acreditar», y en **Puntos** se ven las **diferencias** con la acreditación vigente, jugador por jugador.
4. **Aplicar corrección al torneo** exige motivo.
5. **Confirmar corrección** en Acreditación usa el mecanismo transaccional existente: contraasientos de la versión vigente y nueva versión, en una sola operación y sin duplicados.

### Publicación

La página del torneo usa los mismos datos de la base, sin repetir información:

- **Resultado final** con puntos, cuando hay acreditación vigente;
- **Fixture publicado** con posiciones, partidos y cuadros de Oro y Plata (la lista de parejas no se repite);
- otras categorías del evento.

Los rankings anuales se actualizan al acreditar.

### Torneos antiguos y Satélites

- Los torneos largos sin fixture siguen con carga manual y acreditación como siempre.
- Los Satélites / Americanos conservan exactamente su flujo: crear → configurar puntos → cargar el cuadro final por imagen o a mano → revisar → confirmar. Muestran públicamente el resultado final y los puntos.

## Qué no cambia

- **Motor de acreditación:** sin cambios en sus reglas. El fixture sólo le entrega las instancias y los partidos de cada pareja. Nunca genera movimientos de puntos por sí mismo (lo verifican las pruebas).
- Torneos, parejas, acreditaciones e historiales existentes: la migración 0007 sólo agrega tablas y columnas.
- Satélites / Americanos: cuadro final y acreditación como hasta ahora.

## Técnica

- **Motor puro:** `shared/fixture.ts`. Lo comparten la API, el panel y las pruebas. Incluye:
  - validación de marcadores;
  - todos contra todos;
  - serpentina;
  - tablas con desempates;
  - siembra;
  - cuadros con BYE;
  - sincronización de cruces;
  - detección de conflictos;
  - vista pública.
- **Migración 0007:** `tournament_events`, `tournaments.event_id`, retiro en `tournament_teams`, `tournament_fixtures`, `fixture_groups`, `fixture_group_teams`, `fixture_matches`, `fixture_match_history` y `fixture_publications`.
- **API (`/api/tournaments/:id/fixture/*` y `/api/events`):**
  - lectura del estado completo (con tablas, conflictos y problemas calculados);
  - configuración, grupos, orden manual, propuesta y confirmación de cuadros;
  - programación individual y por fechas;
  - resultados, anulación, retiro;
  - publicación e historial.
- **Web pública:**
  - `/torneos/<slug>` agrega la sección **Fixture**: posiciones, próximos partidos y resultados con fecha, hora y cancha, y los cuadros de Oro y Plata;
  - todo sale de la copia publicada (`fixture_publications`);
  - la página enlaza las otras categorías del evento;
  - la caché se invalida al publicar.
- **Respaldo:** las tablas nuevas están en el respaldo `.sql` (`shared/backup.ts`).
- **Pruebas:**
  - `test/fixture.test.ts` (28): motor;
  - `test/fixtures.test.ts` (18): API y base;
  - `e2e/phase9.spec.ts` y `e2e/mobile_fixture.spec.ts`: circuito completo en PC y celular.
