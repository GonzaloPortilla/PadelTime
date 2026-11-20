# Importación de cuadros por imagen (OCR)

La pestaña **Importar cuadro** de cada torneo permite subir una captura o foto de un cuadro eliminatorio. La aplicación identifica las parejas, los resultados y la instancia final que alcanzó cada una, y propone todo para revisión.

> **Regla fundamental:** el OCR sólo propone. Nunca crea jugadores ni acredita puntos por su cuenta. El organizador revisa y corrige el cuadro, confirma cada jugador nuevo, ve la lista completa de jugadores, instancias y puntos, y recién entonces importa. La acreditación sigue siendo un paso aparte, con la previsualización y la confirmación de la Fase 2.

## Flujo

1. **Imagen:** se sube desde la compu o el celular (en el celular se puede sacar la foto en el momento). Hay herramientas opcionales para rotar de a 90°, enderezar de forma fina (±15°), recortar arrastrando sobre la imagen, y ajustar contraste y brillo.
2. **Reconocimiento**, en el navegador:
   - **Enderezado automático:** se estima la inclinación por el perfil de proyección horizontal del texto y se corrige.
   - **Estructura por colores:** se detectan las barras de encabezado de cada partido (rectángulos de color anchos y bajos). Debajo de cada una están las dos parejas, a la derecha la celda coloreada del resultado y después la del indicador. Los bloques se agrupan en columnas (rondas). Si un bloque no tiene celdas de color, copia la geometría de otro bloque de su columna.
   - **Normalización de tamaño:** si el texto es muy chico o muy grande, la imagen se reescala.
   - **Lectura celda por celda con Tesseract.js:** cada celda se recorta con un margen proporcional, se amplía y se binariza con umbral de Otsu, invirtiendo si el texto es claro sobre fondo oscuro. Los nombres se leen como una línea de letras; los resultados, sólo como dígitos.
   - **Reintentos con otros preprocesamientos:** si un resultado sale vacío o un nombre sale con baja confianza, se vuelve a leer con borrado de restos de bordes, versión en grises o un umbral más estricto (para fotos desenfocadas).
   - **Indicador "X":** se detecta midiendo la tinta claramente más oscura que el fondo de su celda, descartando líneas de borde.
   - **Respaldo por texto:** si no se reconoce la estructura de colores, se lee la imagen completa y se arman los bloques por posición. Es menos preciso.
3. **Interpretación** (`src/ocr/bracket.ts`, funciones puras y testeadas):
   - **Rondas:** se identifican por la cantidad de partidos de cada columna (8 → octavos, 4 → cuartos, 2 → semifinales, 1 → final). Así se detecta si falta una ronda. Si el cuadro no es estándar, se usa el texto del encabezado.
   - **Parejas entre rondas:** las distintas apariciones de una misma pareja se unen por similitud de nombres, tolerando errores de lectura.
   - **Ganador de cada partido:** se combinan tres evidencias: el resultado (gana el mayor), el avance (la pareja que aparece en la ronda siguiente) y el indicador. El significado de la "X" (perdedor o ganador) se aprende de los partidos con resultado claro. Si las evidencias se contradicen, se avisa.
   - **Instancia final de cada pareja:** es la ronda más avanzada que alcanzó; en la final se distingue campeón de finalista. No hace falta cargar partido por partido. Los partidos jugados y ganados también se deducen.
   - **Nunca se inventa:** si un dato no se puede deducir (por ejemplo, el resultado de la final es ilegible), queda vacío, se informa como error y el organizador lo elige con un clic.
4. **Revisión del cuadro:** cada dato es editable: nombres, resultados, indicador y ganador elegido a mano. Junto a cada texto se ve la miniatura de la imagen original. Los datos dudosos se resaltan y la interpretación se recalcula en vivo. Botones para completar rondas con los ganadores y para agregar la final si faltaba.
5. **Jugadores** (`shared/names.ts`): cada nombre se compara con los jugadores registrados de la rama, ignorando acentos y mayúsculas y tolerando abreviaturas y diminutivos ("Maxi" ↔ Maximiliano, "Facu" ↔ Facundo, "Eze" ↔ Ezequiel), espacios faltantes y errores de una o dos letras. Hay cuatro resultados posibles:
   - **Coincide:** se vincula y se puede cambiar.
   - **Verificar:** coincidencia alta pero no exacta.
   - **Ambiguo:** homónimos o candidatos muy parecidos; hay que elegir.
   - **No registrado:** se propone crear el jugador con nombre, apellido y categoría editables, y sólo se crea si se confirma.

   También se detectan duplicados (un mismo jugador vinculado a dos nombres) y jugadores inactivos.
6. **Confirmación:** se muestra la lista completa de parejas, jugadores, instancia (editable), PJ/PG y puntos según la puntuación del torneo. Si el torneo ya tenía parejas, se elige entre reemplazarlas o agregar. Hay que marcar "Revisé la lista completa" para habilitar la importación. Al importar se crean los jugadores confirmados y se guardan parejas e instancias en una operación atómica. Queda un registro auditable (tabla `bracket_imports`) con archivo, modo de lectura, correcciones, jugadores creados y advertencias aceptadas.
7. **Acreditación:** se hace aparte, en la pestaña Acreditación (Fase 2).

Si el reconocimiento falla, se puede armar el cuadro a mano (4, 8, 16 o 32 parejas) con la misma revisión, o ir directo a la carga manual por pareja.

## Costo y privacidad

- Tesseract.js (licencia Apache-2.0) corre en el navegador como WebAssembly. Worker, motor y modelo de español (`best_int`, ≈2 MB) se sirven desde el propio sitio (`public/ocr`, copiados de `node_modules` al instalar). No hay APIs pagas ni CDNs externos.
- La imagen **no se envía al servidor**: sólo viajan los datos que el organizador confirma.
- El modelo se descarga una vez y queda en la caché del navegador.

## Resultados medidos

### Imagen de referencia (`test/fixtures/cuadro-referencia.png`, 1222×525)

| Dato | Resultado |
|---|---|
| Partidos y rondas | 15 partidos en 4 rondas (octavos, cuartos, semis, final) |
| Nombres de parejas | **30/30** exactos |
| Resultados numéricos | **30/30** |
| Indicadores "X" | **28/28** |
| Instancia final deducida | **16/16** parejas |
| Campeones / finalistas | NICOLAS SALAS – MILTON AHUMADA / LEO MOSQUERA – TIMO MOSQUERA ✔ |
| Tiempo | ≈3–4 s en una computadora (Chromium), incluido el build de producción con CSP |

Esta medición se repite automáticamente en `npm run test:e2e` y queda en `test-results/ocr-reporte.json`.

### Imágenes degradadas (generadas a partir de la de referencia)

Medido con el mismo pipeline del navegador. "Nombres" cuenta lecturas exactas letra por letra. Muchos errores son de una o dos letras ("BUFRA", "CALANORA") que la coincidencia aproximada igual resuelve al unir parejas y vincular jugadores.

| Caso | Partidos | Nombres | Resultados | "X" | Instancias correctas | Campeón propuesto |
|---|---|---|---|---|---|---|
| Original | 15/15 | 30/30 | 30/30 | 28/28 | 16/16 | ✔ correcto |
| Resolución al 75 % (917×394) | 15/15 | 17/30 | 20/30 | 28/28 | 14/16 | ✔ correcto |
| Resolución al 50 % (611×262) | 15/15* | 0/30 | 0/30 | — | 0/16 | no propone |
| JPEG calidad 40 | 15/15 | 27/30 | 29/30 | 28/28 | 13/16 | no propone (falta un dato: se elige a mano) |
| JPEG calidad 15 | 15/15 | 22/30 | 15/30 | 18/28 | 12/16 | no propone |
| Inclinada 2° (enderezado automático) | 15/15 | 26/30 | 23/30 | 28/28 | 12/16 | no propone |
| Inclinada 5° (enderezado automático) | 15/15 | 23/30 | 22/30 | 28/28 | 15/16 | ✔ correcto |
| Foto simulada (desenfoque, ruido, luz despareja, 1,5°) | 14/15 (falta la final) | — | — | — | 3/16 | no propone (informa que falta la final) |

\* Detecta 16 bloques: la estructura aparece, pero el texto mide unos 5 px y es ilegible.

En ningún caso se propuso un campeón equivocado. Cuando falta evidencia, se informa y se pide la decisión al organizador.

## Limitaciones reales

- **Diseñado para las planillas de Padel Time:** encabezados de color por partido, celdas de resultado coloreadas y columnas por ronda. Otros diseños (cuadros dibujados a mano, otras planillas sin barras de color) caen al modo de respaldo por texto, mucho menos preciso: hay que corregir en la revisión o usar la carga manual.
- **Resolución mínima:** las filas deben medir al menos unos 10–11 px de alto en la imagen. Con letra más chica la lectura cae fuerte; por debajo de 7–8 px es ilegible. Conviene una captura de pantalla a tamaño completo, no una miniatura reenviada.
- **Compresión JPEG fuerte** (por ejemplo, reenvíos sucesivos por WhatsApp): los nombres se siguen leyendo razonablemente, pero los dígitos y las "X" se degradan.
- **Fotos de pantalla o de papel:** el desenfoque, el ruido y los reflejos degradan mucho la lectura. El enderezado automático corrige inclinaciones de hasta unos 8°, pero no corrige perspectiva (foto tomada en ángulo) ni curvatura.
- **Recortes que dejan afuera una ronda:** se detecta y se informa. La ronda se puede agregar a mano.
- **Nombres:** el OCR lee en mayúsculas y puede omitir tildes; los jugadores nuevos se proponen en formato "Nombre Apellido" para revisar. Un nombre de una sola palabra (por ejemplo, el apodo "CHECHO") se vincula por apodo si existe; si no, hay que completar el apellido.
- **Cuadros no estándar** (byes, partidos por el tercer puesto, zonas de grupos): el modelo asume eliminación directa. Una pareja que aparece en una ronda sin haber jugado la anterior se informa como advertencia.
- **Rendimiento en celulares:** el reconocimiento tarda más que en una computadora (estimado de 2 a 4 veces, según el equipo). La primera vez descarga ≈2 MB del modelo.
- **Diminutivos:** se incluye una lista de apodos habituales. Los que no son prefijo del nombre y no están en la lista requieren confirmar a mano.

## Consejos para mejores resultados

1. Usar una **captura de pantalla** de la planilla, no una foto, y a tamaño completo.
2. Si es una foto: tomarla de frente, con buena luz, sin reflejos y lo más cerca posible.
3. Recortar sólo el cuadro, pero sin dejar afuera la final.
4. Si quedan resultados vacíos, corregirlos en la revisión: el ganador también se deduce por quién avanzó de ronda.
