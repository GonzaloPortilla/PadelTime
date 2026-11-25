# Guía de acreditación de puntos

Los puntos del ranking anual **sólo** se acreditan cuando un organizador lo confirma. Cargar un resultado nunca suma puntos por sí solo.

## Principios

- **Una única fuente de verdad:** el registro de movimientos de puntos. Cada acreditación, corrección, reversión y ajuste es un movimiento con fecha, usuario y motivo. Nunca se borra ni se modifica.
- **Categoría principal:** cada jugador suma en su categoría principal, aunque haya jugado otra categoría. La categoría queda fija al acreditar.
- **Nunca dos veces:** un torneo (categoría) tiene como máximo una acreditación vigente. Un segundo intento con los mismos resultados se rechaza.
- **Cada categoría por su cuenta:** en un torneo con varias categorías, cada una se acredita cuando termina, aunque las demás sigan en juego.

## Torneos largos (con fixture)

1. Terminar la competencia: todos los partidos con resultado y las copas jugadas.
2. **Fixture → Puntos:**
   - aparecen las posiciones finales (Campeón de Oro, Finalista, Semifinal…);
   - revisar la instancia de puntuación de cada posición. La Copa de Plata está marcada «Revisar»: el reglamento no define sus puntos;
   - controlar la **distribución de puntos**, calculada por el mismo motor que acredita.
3. **Aplicar posiciones al torneo.** Completa la instancia y los partidos de cada pareja, y pasa la categoría a *Finalizado*. Todavía no acredita.
4. **Ir a Acreditación → Confirmar y acreditar puntos.**
5. Verificar en **Rankings**, o en la web pública `/rankings`.

## Satélites / Americanos (cuadro final)

1. **Torneos → Nuevo torneo** (tipo Americano), con su categoría o categorías.
2. **Puntuación:** revisar los puntos de este torneo.
3. **Importar cuadro** (foto) o **Parejas y resultados** (a mano): instancia alcanzada por cada pareja.
4. **Resumen → Iniciar torneo.**
5. **Acreditación → Confirmar y acreditar puntos.**

## Qué revisar en la previsualización

| Aviso | Significa |
|---|---|
| Rojo: "Falta cargar la instancia…" | Una pareja no tiene instancia. No se puede acreditar. |
| Rojo: cupo excedido | Más parejas que las permitidas en una instancia (p. ej. 3 semifinalistas). |
| Rojo: "El fixture todavía no terminó" / "posiciones sin aplicar" | Torneo largo: falta terminar o aplicar las posiciones en Fixture → Puntos. |
| Amarillo: otra categoría | El jugador suma en su categoría principal (es lo esperado). |
| Amarillo: jugador inactivo | Igual suma. Reactivalo si corresponde. |

## Rankings públicos

Se actualizan **al instante** al acreditar, corregir o revertir. No hay que publicar nada aparte, salvo que la publicación de rankings esté desactivada en **Publicación web**.

Para correcciones posteriores ver [`CORRECCIONES.md`](CORRECCIONES.md).
