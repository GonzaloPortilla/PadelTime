# Guía de configuración del dominio padeltime.com.ar

> **Esta guía no se ejecutó.** El dominio y los DNS no se tocan hasta que lo autorices expresamente.

## Situación actual

- `www.padeltime.com.ar` apunta a Google Sites.
- La web nueva corre en Cloudflare Workers. Mientras no se active el dominio, se ve en `https://padel-time.<subdominio>.workers.dev`.

## Requisitos (todos gratuitos)

1. El dominio tiene que estar **en la misma cuenta de Cloudflare** que el Worker (zona de Cloudflare, plan Free).
2. Saber dónde está registrado (NIC Argentina, en el caso de `.com.ar`) y tener acceso para cambiar los servidores de nombres (DNS).

## Paso a paso (el día del lanzamiento)

### 1. Agregar el dominio a Cloudflare (sin cortar nada)

1. En Cloudflare: **Add a site** → `padeltime.com.ar` → plan **Free**.
2. Cloudflare copia los registros DNS actuales. **Verificá que estén todos**, en especial los de correo (MX) si el dominio tiene casillas.
3. Cloudflare indica **dos servidores de nombres** (por ejemplo `xxx.ns.cloudflare.com`).

### 2. Cambiar los servidores de nombres en NIC Argentina

- **Lo hace el titular del dominio**, en nic.ar → Dominios → padeltime.com.ar → Delegaciones: se reemplazan las actuales por las dos de Cloudflare.
- La propagación tarda de minutos a unas horas. Mientras tanto la web anterior sigue funcionando, porque los registros se copiaron.

### 3. Conectar el dominio a la web nueva

1. En `wrangler.jsonc`, descomentar el bloque `routes` (Custom Domains):

   ```jsonc
   "routes": [
     { "pattern": "padeltime.com.ar", "custom_domain": true },
     { "pattern": "www.padeltime.com.ar", "custom_domain": true }
   ],
   ```

2. Publicar:

   ```bash
   npm run deploy
   ```

   Cloudflare crea los registros DNS y **emite el certificado HTTPS automáticamente** (gratis, con renovación automática).
3. Si existía un registro `www` apuntando a Google Sites (CNAME `ghs.googlehosted.com`), Cloudflare pide reemplazarlo. Ese reemplazo es el **corte**: desde ahí se ve la web nueva.

### 4. Ajustes recomendados en Cloudflare (gratis)

- **SSL/TLS → modo Full (strict).**
- **Always Use HTTPS: activado.**
- **Redirección de dominio:** elegir una versión canónica (recomendado `www.padeltime.com.ar`) y redirigir la otra con una regla gratuita (*Rules → Redirect Rules*).
- **Desvincular el dominio en Google Sites** (Configuración → Dominios personalizados), para que no quede asociado.

### 5. Verificación (lista de control)

```bash
npm run check:links -- https://www.padeltime.com.ar --legacy
```

- [ ] Portada, Torneos, Rankings, Calendario, Reglamentos y Contacto responden con candado (HTTPS).
- [ ] Las direcciones viejas (`/página-principal`, `/qatar-major-2000/c5/fixture`…) redirigen con 301.
- [ ] `https://www.padeltime.com.ar/robots.txt` y `/sitemap.xml` responden.
- [ ] `/admin` pide usuario y contraseña.
- [ ] Google Search Console: agregar la propiedad del dominio y enviar el sitemap.
- [ ] Los rankings incrustados en otros sitios (si los hay) siguen funcionando (`PUBLIC_FRAME_ANCESTORS`).

### 6. Volver atrás (si algo falla)

- **Antes de cambiar el registro `www`:** no hay nada que revertir. La web anterior sigue intacta.
- **Después:**
  1. En Cloudflare → *Workers & Pages → padel-time → Settings → Domains & Routes* → quitar los dominios.
  2. Volver a crear el CNAME `www` → `ghs.googlehosted.com` (proxy desactivado, nube gris).
  3. La web anterior vuelve a verse en minutos (Google Sites no se tocó).

## Qué NO cambia con el dominio

- Los datos, el panel y la web siguen siendo los mismos. Sólo cambia la dirección.
- `padel-time.<subdominio>.workers.dev` sigue funcionando. Si se quiere, se desactiva en *Settings → Domains & Routes → workers.dev*.
- Costo: USD 0. Ver [`COSTOS.md`](COSTOS.md).
