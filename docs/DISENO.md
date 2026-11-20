# Sistema de diseño de Padel Time (Fase 5A)

El rediseño adopta la identidad de la web oficial (padeltime.com.ar) sin cambiar ninguna funcionalidad. Los colores y las tipografías salen de la web publicada (analizada en noviembre de 2026), no de suposiciones:

- los colores se midieron sobre los píxeles del logotipo, el banner y la planilla de ranking;
- las tipografías son las que la web declara en sus estilos.

## 1. Identidad relevada

| Elemento | En la web oficial | Uso en la app |
|---|---|---|
| **Logotipo** | Reloj con paleta y pelota dentro de un círculo azul, con la palabra “PADELTIME” (PADEL en azul, TIME en verde) | `public/brand/padeltime-logo.png` (completo) y `padeltime-simbolo.png` (sólo el círculo), con fondo transparente |
| **Azul** | `#0F5A93`: círculo, paleta y “PADEL” | Color principal: botones, enlaces, selección y encabezados de tablas |
| **Verde** | `#57AA57`: “TIME”, pelota y onda del banner | Acento: ítem activo, logros, podio, franja de marca |
| **Azul de títulos** | `#1C4587`: títulos como “COMUNIDAD DE PADEL” | Títulos y cifras grandes (`navy`) |
| **Verde claro** | `#B6D7A8`: barra de aviso superior | Fondos suaves de éxito (`ball-300`) |
| **Tipografía de títulos** | Oswald 700, en mayúsculas | Títulos de página y tarjetas, cifras, posiciones |
| **Tipografía de navegación** | Comfortaa | Marca “PADEL TIME”, menú, rótulos pequeños |
| **Elementos gráficos** | Diagonales azul y verde en las esquinas del banner, ondas azul y verde en la portada | Banner del panel y de las páginas públicas (diagonales), pantalla de ingreso (ondas), franja azul/verde en barras y ventanas |
| **Planilla de ranking** | Encabezado de color, columna de posiciones en celeste | Tabla pública: encabezado azul, columna de posición celeste y podio |

Las fuentes (licencia SIL Open Font License) se sirven desde el propio sitio, en `public/pub/fonts`. Así no se usan CDNs externos y se respetan las CSP.

## 2. Tokens (`src/index.css`)

Se conservaron los nombres de los tokens existentes, así los componentes no tuvieron que reescribirse:

| Token | Significado | Valor base |
|---|---|---|
| `brand-50 … brand-900` | Azul Padel Time | `brand-700 = #0F5A93` |
| `ball-50 … ball-700` | Verde Padel Time | `ball-400 = #57AA57`, `ball-300 = #B6D7A8` |
| `ink-800 … ink-950` | Azul profundo para superficies oscuras (avisos, barras flotantes, pasos) | `ink-950 = #0B2D4E` |
| `navy` | Azul de títulos | `#1C4587` |
| `surface` | Fondo de la app | `#F3F6F9` |
| `font-display` | Oswald | títulos y cifras |
| `font-brand` | Comfortaa | marca y navegación |

Utilidades propias:

- `brand-stripe`: franja azul y verde.
- `brand-waves`: fondo con las ondas del banner.

## 3. Componentes

- **Barra lateral y superior:** blancas como el encabezado de la web, con el símbolo oficial y la franja de marca. El ítem activo va en azul con una marca verde.
- **`PageHeader`:** título en Oswald y mayúsculas, con un acento azul/verde.
- **`Card` / `CardHeader`:** sombra azulada suave y títulos en Oswald.
- **`Stat`:** barra de color superior, ícono en azul o verde y cifra grande en Oswald.
- **`Button`:** primario azul, secundario con borde, sutil en verde.
- **`Modal` y diálogos de confirmación:** franja de marca y título en Oswald.
- **Rankings internos:** podio con el 1° en verde, el 2° en azul y el 3° en celeste. Puntos en Oswald.
- **Ingreso:** logotipo completo sobre las ondas azul y verde.
- **Panel:** banner con las diagonales de la web.

## 4. Rankings públicos

- Encabezado blanco con el símbolo y “PADEL TIME” en Comfortaa, como la barra de la web oficial.
- Banner con las diagonales azul y verde. Título en Oswald.
- Tabla con encabezado azul y columna de posición celeste (como la planilla oficial), podio destacado y puntos grandes.
- Modo incrustado (`?embed=1`): fondo transparente, franja de marca arriba y sin barra de navegación, para integrarse dentro de Google Sites.
- Buscador, filtro instantáneo y descargas a Excel/CSV sin cambios. CSP con `font-src 'self'` para las fuentes propias. La compatibilidad con Google Sites (`frame-ancestors`) se verificó nuevamente.

## 5. Qué no cambió

Cálculos de puntos, categorías, base de datos, asignación de puntuaciones, OCR, importaciones y exportaciones, autenticación, correcciones, API y contratos de datos. Los únicos cambios en el Worker son de presentación de la vista pública (estilos, encabezado y `font-src` en su CSP).
