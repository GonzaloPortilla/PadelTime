# Fixtures de torneos largos (Fase 9)

Gestión de grupos, partidos, resultados, tablas de posiciones y cuadros de **Copa de Oro / Copa de Plata**, **sólo para torneos largos**.

Los **Satélites / Americanos** no tienen fixture. Siguen como hasta ahora: se carga el cuadro final (a mano o por imagen) y se acreditan los puntos.

## Eventos con varias categorías

Un **evento** agrupa las categorías de un mismo torneo. Por ejemplo, *Qatar Major 2000* con C5, C6 y C7.

- **Panel → Eventos → Nuevo evento:** nombre, temporada, fechas, sede, modalidad y categorías.
- Se crea **un torneo largo por categoría**, con la puntuación predeterminada (editable en cada uno). Cada categoría tiene sus propias parejas, fixture, puntos y acreditación.
- Los torneos existentes no cambian. Para sumar un torneo ya cargado a un evento, se elige el evento en **Editar datos** del torneo.
- Al borrar un evento, sus categorías quedan como torneos sueltos: no se borra nada deportivo.
- Damas (rama discontinuada) no se ofrece en el alta de eventos. Los datos históricos se conservan.

**Modelo de datos:** se agregó la tabla `tournament_events` y la columna opcional `tournaments.event_id`. No se duplican parejas ni puntos: el evento sólo agrupa torneos.

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

## Qué no cambia

- **Acreditación anual:** sin cambios. Al terminar la competencia, las instancias se siguen cargando en *Parejas y resultados* y se acredita como siempre. El fixture no genera movimientos de puntos (lo verifican las pruebas).
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
