# Guía de correcciones

Ninguna corrección borra historia: todo queda registrado con usuario, fecha y motivo.

## 1. Resultado mal cargado en el fixture (torneo largo)

1. **Fixture → Partidos** (o el cuadro de la copa) → **Corregir** en el partido.
2. Cargar el marcador correcto → **Revisar cambios**. Antes de guardar, la app muestra:
   - qué parejas cambian de posición en el grupo;
   - qué cruces sin jugar se actualizan solos;
   - **conflictos**: partidos posteriores que ya se jugaron con otra pareja. **No se modifican solos.**
   - cambios en las posiciones finales;
   - si el torneo tiene puntos acreditados.
3. Escribir el **motivo** → **Guardar**.
4. Si hubo conflictos: **Problemas → Anular ese resultado** (sólo administradores). El partido vuelve a pendiente con la pareja correcta y se carga de nuevo.

## 2. El torneo ya tenía puntos acreditados

Los puntos **no cambian solos** al corregir un resultado.

1. Corregir el resultado como en el punto 1.
2. **Fixture → Puntos:** aparecen las **diferencias con la acreditación vigente**, jugador por jugador.
3. **Aplicar corrección al torneo**, con motivo.
4. **Acreditación → Confirmar corrección**, con motivo. En una sola operación se revierte la versión vigente (contraasientos) y se acredita la nueva (versión 2, 3…).

## 3. Satélites y torneos sin fixture

1. Corregir parejas o instancias en **Parejas y resultados**, o reimportar el cuadro.
2. **Acreditación:** aparece *Corrección* con las diferencias → motivo → **Confirmar corrección**.

## 4. Otros casos

| Situación | Qué hacer |
|---|---|
| El torneo no debía sumar puntos | **Acreditación → Revertir** (con motivo). Los puntos vuelven a cero. |
| El torneo se suspendió | **Revertir** y marcar *Anular torneo*. Queda cancelado. |
| Bonificación o sanción a un jugador | Ficha del jugador → **Ajuste manual** (con motivo). |
| Un ajuste estaba mal | Ficha del jugador → historial → **Anular**. |
| Una pareja abandona en el fixture | **Fixture → Grupos y parejas → Retirar** (con W.O. en sus partidos pendientes). |
| Empate que el reglamento no resuelve | **Posiciones → Definir orden** (por ejemplo, por sorteo). Queda en la auditoría. |
| Ranking importado mal | **Importar rankings → historial → Revertir** la importación. |
| Contenido de la web publicado por error | **Contenidos web → la página → Historial de cambios → Recuperar.** |

## 5. Dónde ver lo que pasó

- **Movimientos:** todos los puntos, con su origen.
- **Fixture → Historial:** cada resultado cargado, corregido o anulado (antes, después, motivo y responsable).
- **Acreditación → Historial de acreditaciones:** versiones y reversiones.
- Registro de actividad: quién hizo cada cambio.
