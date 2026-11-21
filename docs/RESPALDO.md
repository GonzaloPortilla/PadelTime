# Respaldo y recuperación

Padel Time tiene **tres capas de protección**, todas gratuitas.

| Capa | Qué guarda | Quién la usa | Para qué |
|---|---|---|---|
| 1. Registro inmutable de puntos | Cada movimiento de puntos queda para siempre. Las correcciones y reversiones agregan contraasientos y nunca borran. | Automático | Errores de carga: se corrigen desde la app sin perder historia. |
| 2. Time Travel de Cloudflare D1 | La base completa, minuto a minuto, de los **últimos 7 días**. | Quien administra la cuenta de Cloudflare (terminal) | Volver la base a un momento anterior: borrado accidental o importación masiva equivocada. |
| 3. Respaldo descargable | Un archivo `.sql` con toda la base, guardado fuera de Cloudflare. | Un administrador, desde la app | Protección a largo plazo y contra la pérdida de la cuenta. |

---

## Respaldo descargable (recomendado: semanal)

### Desde la app (no requiere terminal)

1. Ingresá con un usuario **administrador**.
2. Menú → **Respaldo** → **Descargar respaldo (.sql)**.
3. Guardá el archivo (`padel-time-respaldo-AAAA-MM-DD_HH-MM.sql`) en un lugar **privado**, por ejemplo una carpeta personal de Google Drive.

Cuándo hacerlo:

- una vez por semana;
- **siempre antes** de importar rankings, cerrar una temporada o actualizar la app.

Qué tiene en cuenta:

- **Contenido:** jugadores, categorías y divisiones, temporadas, torneos, parejas, puntuaciones, acreditaciones, todos los movimientos de puntos, importaciones, auditoría, usuarios y configuración. No incluye las sesiones abiertas (al restaurar hay que volver a ingresar).
- **Es confidencial:** tiene teléfonos, correos y documentos de jugadores, y las contraseñas *cifradas* de los organizadores. No lo compartas ni lo subas a carpetas públicas.
- **Es seguro:** descargarlo no modifica nada. Queda registrado en la auditoría quién lo descargó.

### Fotos, logos y documentos de la web (desde la Fase 8)

Viven en Workers KV, fuera de la base de datos, así que el respaldo `.sql` no los incluye. En la misma pantalla, **Respaldo → Descargar multimedia (.zip)** baja todos los archivos con un índice (`manifest.json`). Guardalo junto al `.sql`.

Para restaurarlos en una cuenta o espacio nuevo, después de restaurar la base:

```bash
node scripts/restore-media.mjs padel-time-multimedia-AAAA-MM-DD.zip
```

Agregá `--local` para probar la restauración en la base local.

### Desde la terminal (alternativa)

```bash
npm run db:backup:remote
```

Genera `respaldo-padel-time.sql` con la exportación oficial de Cloudflare (`wrangler d1 export`). Este formato incluye también el esquema de las tablas.

---

## Recuperación

### Caso A — Un error de carga (lo más común)

**No hace falta restaurar nada.** Se corrige desde la app:

| Error | Solución en la app |
|---|---|
| Resultados mal cargados en un torneo ya acreditado | Corregir los resultados → **Acreditación** → confirmar la corrección con motivo. |
| Torneo acreditado por error | **Acreditación** → **Revertir** (o anular el torneo). |
| Ajuste manual equivocado | Ficha del jugador → historial → **Anular** el ajuste. |
| Ranking importado mal | **Importar rankings** → historial → **Revertir** la importación completa. |

### Caso B — Volver la base a un momento de los últimos 7 días (Time Travel)

Para daños que no se pueden revertir desde la app, como una importación enorme equivocada o datos borrados por error.

1. Averiguá el momento exacto al que querés volver, en UTC (hora argentina + 3 h). Por ejemplo, el martes a las 18:00 de Argentina son las 21:00 UTC.
2. Primero, **descargá un respaldo** del estado actual, por las dudas.
3. Mirá la información de Time Travel:
   ```bash
   npx wrangler d1 time-travel info padel-time --timestamp=2026-11-17T21:00:00Z
   ```
4. Restaurá:
   ```bash
   npx wrangler d1 time-travel restore padel-time --timestamp=2026-11-17T21:00:00Z
   ```
   Wrangler pide confirmación y muestra un *bookmark* del estado anterior a la restauración. **Anotalo:** sirve para deshacer la restauración con `--bookmark=<valor>`.
5. Ingresá a la app y verificá los rankings.

Ojo: todo lo que se cargó después de ese momento se pierde y hay que volver a cargarlo.

### Caso C — Restaurar un respaldo descargado (base nueva)

Por ejemplo, si se perdió la cuenta de Cloudflare o pasaron más de 7 días. El respaldo se restaura sobre una base **nueva y vacía**; nunca se mezcla con una base que ya tiene datos.

1. Creá una base nueva:
   ```bash
   npx wrangler d1 create padel-time-restaurada
   ```
2. Pegá su `database_id` en `wrangler.jsonc`, en lugar del anterior. Anotá el viejo, por si hay que volver.
3. Creá las tablas (migraciones):
   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```
4. Cargá el respaldo:
   ```bash
   npx wrangler d1 execute DB --remote --file=padel-time-respaldo-AAAA-MM-DD_HH-MM.sql
   ```
5. Publicá la app apuntando a la base nueva:
   ```bash
   npm run deploy
   ```
6. Ingresá con tu usuario y contraseña de siempre: el respaldo incluye las cuentas.

Esto se probó de punta a punta:

- La prueba automática `test/backup.test.ts` restaura un respaldo en una base nueva y verifica que todas las tablas queden idénticas, fila por fila, que los rankings coincidan y que los movimientos sigan siendo inmutables.
- La prueba de navegador `e2e/phase5.spec.ts` descarga el respaldo desde la pantalla y lo restaura con estos mismos comandos de `wrangler` (en modo local).

Para el **respaldo de terminal** (`wrangler d1 export`), el paso 3 se saltea: el archivo ya trae el esquema. Se ejecuta directamente sobre la base nueva.

### Caso D — Ensayo de recuperación sin tocar producción

Para practicar o revisar un respaldo, se puede cargar en una base local:

```bash
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/ensayo
```

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/ensayo --file=padel-time-respaldo-AAAA-MM-DD_HH-MM.sql
```

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/ensayo --command="SELECT COUNT(*) FROM players"
```

---

## Ante una falla de Cloudflare

Si Cloudflare tiene una caída general, la app no responde hasta que se resuelva. Los datos no se pierden: D1 los replica. Mientras tanto:

- los rankings ya incrustados en Google Sites muestran un error de carga;
- la última exportación a Excel de cada ranking sirve como respaldo visible para publicar a mano si la caída se prolonga.
