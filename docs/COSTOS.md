# Costos e infraestructura: objetivo USD 0 por mes

Todo corre en el **plan gratuito de Cloudflare** (Workers Free). No hay ningún servicio pago activado ni tarjeta registrada. El plan gratuito **no factura excedentes**: si se supera un límite diario, esa operación falla hasta el reinicio diario (00:00 UTC = 21:00 de Argentina). Nunca se genera un cobro.

Límites verificados el 25/11/2026 en la documentación oficial de Cloudflare ([Workers](https://developers.cloudflare.com/workers/platform/limits/), [D1](https://developers.cloudflare.com/d1/platform/limits/), [KV](https://developers.cloudflare.com/kv/platform/limits/)).

## Recursos y uso estimado

| Recurso | Límite gratis | Uso de Padel Time | Margen |
|---|---|---|---|
| **Solicitudes al Worker** | 100.000 por día | 1 por página vista, más 1 por cada foto de la biblioteca mostrada. CSS, JS, logos y el panel son archivos estáticos: **gratis e ilimitados**, no cuentan. | Una portada con 3 fotos = 4 solicitudes: ~25.000 visitas por día. |
| **CPU por solicitud** | 10 ms | Páginas públicas en caché: ~0 ms (respuesta 304 o copia guardada). Páginas nuevas: armado de HTML simple. Las esperas de la base no cuentan como CPU. | Holgado. Lo más pesado es importar rankings de más de ~1000 filas: se importa por partes. |
| **Tamaño del Worker** | 3 MB | 690 KB (176 KB comprimido) | Amplio |
| **D1: lecturas** | 5 millones de filas por día | Una página pública lee decenas o cientos de filas. Con caché, una vez por cambio. | Muy amplio |
| **D1: escrituras** | 100.000 filas por día | Una acreditación de 32 jugadores ≈ 40 filas; un resultado ≈ 5–10. | Muy amplio |
| **D1: consultas por solicitud** | 50 (un lote cuenta como una) | La app agrupa en lotes: máximo ~6 por solicitud. | Amplio |
| **D1: almacenamiento** | 500 MB por base | Años de datos: pocos MB | Amplio |
| **KV (fotos y PDF): almacenamiento** | 1 GB | Fotos optimizadas a ~200–400 KB. Las 241 imágenes de la web anterior suman 60 MB. | ~3.000 fotos optimizadas |
| **KV: lecturas** | 100.000 por día | 1 por foto servida. **Con dominio propio, la caché de Cloudflare evita leer KV en cada visita.** | Amplio |
| **KV: escrituras / borrados** | 1.000 por día | 1 por archivo subido o borrado | Subir más de 1.000 archivos en un día falla hasta el día siguiente (la migración de 241 imágenes entra holgada). |
| **Transferencia de datos** | Sin cargo | Workers no cobra transferencia | — |
| **Tareas programadas** | 5 por cuenta | 1 producción + 1 entorno de prueba | — |
| **Certificado HTTPS** | Gratis (Universal SSL) | Automático con dominio propio | — |
| **Dominio en Cloudflare** | Zona Free gratis | DNS y redirecciones gratis | — |
| **Respaldos** | Time Travel de D1: 7 días gratis | Más el respaldo descargable semanal (`.sql` + `.zip` de archivos), guardado fuera de Cloudflare | — |
| **Registros (logs)** | Workers Logs gratis con cupo diario | Sólo para diagnóstico | Si se agota, deja de registrar, sin cortar el servicio |

## Lo que **no** está garantizado (limitaciones a conocer)

1. **Picos de tráfico muy grandes.** Si en un día hubiera más de ~100.000 solicitudes (por ejemplo, una publicación viral), la web y el panel dejan de responder hasta las 21:00 de Argentina (error 1027). **No hay cobro**, pero sí una interrupción. Con el tráfico esperado de una comunidad de pádel, es muy improbable. Si ocurriera, la única solución sin interrupción es el plan Workers Paid (USD 5 por mes): no se activa sin tu autorización.
2. **El costo del dominio no es de Cloudflare.** La renovación anual de `padeltime.com.ar` en NIC Argentina es un costo aparte que ya existe hoy. No forma parte de la infraestructura.
3. **Cloudflare puede cambiar sus planes.** Si cambian los límites gratuitos, hay que revisar esta tabla. La app no depende de ningún servicio pago.
4. **Sin correo saliente.** No hay recuperación de contraseña por mail: lo resuelve un administrador.

## Cómo controlarlo

- En el panel de Cloudflare: *Workers & Pages → padel-time → Metrics* (solicitudes por día) y *D1 → padel-time → Metrics*.
- Revisión sugerida: una vez por mes, mirar el pico de solicitudes diarias. Si alguna vez supera ~50.000 por día, conviene evaluar opciones antes de llegar al límite.
