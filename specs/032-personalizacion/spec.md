# 032 — Personalización (Fase D)

Ajustes → **Personalización**, con tres subpestañas (rutas, compartibles):

1. **Apariencia** (cualquier persona con sesión) — tipografía y estilo del chat.
2. **Marca** (`settings.manage`) — la pantalla de 019/H11, movida tal cual.
3. **Navegación** (`settings.manage`) — la de 030 PR 4, movida tal cual. Sin el
   módulo `custom_nav`, la subpestaña existe y explica: «Disponible cuando el
   módulo «Menú personalizable» está encendido» (antes era un 404 mudo).

`/settings/branding` y `/settings/navigation` redirigen a su nueva casa.

## Apariencia

- **Tipografía**: Inter (next/font, de fábrica), Geist, Plus Jakarta Sans y DM
  Sans (`@fontsource-variable/*`, empaquetadas con la app: sin Google Fonts en
  runtime; solo se descarga la que se usa). Se elige con `data-font` en
  `<html>`, que redefine `--font-ui` (`globals.css`).
- **Estilo del chat**: «Clásico» (de fábrica, no escribe CSS) o «WhatsApp»
  (burbujas con cola, fondo verde-gris, hora abajo a la derecha, entrada suave
  de 180 ms en los últimos mensajes, respeta `prefers-reduced-motion`). Se
  elige con `data-chat`; la burbuja (`MessageBubble`) solo expone ganchos
  (`bubble`, `bubble-in|out`, `bubble-first`). Lo hereda también la vista
  previa del Laboratorio.
- **Vista previa en vivo**: elegir escribe los atributos en `<html>` (se ve en
  todo el CRM); al salir sin guardar vuelve lo guardado.
- **Dos niveles, sin migración**:
  - Organización → `organization.metadata.appearance` (junto a la marca);
    `PUT /api/settings/appearance`, permiso `settings.manage`.
  - Persona → cookies `vocero-font` / `vocero-chat-style` (como el tema):
    **solo en ese navegador**. Pisan a la de la organización solo para esa
    persona; «Usar la de la organización» las borra.
  - El layout raíz resuelve cookie > organización > fábrica y escribe los
    atributos en el HTML del servidor: sin parpadeo.

## D2 — Pulido del chat y catálogo de tipografías

- Quinta letra «Sistema» (`system-ui, -apple-system, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, sans-serif`): no descarga nada. Mismas reglas de
  guardado (organización y cookie personal).
- Tres estilos de chat: «Clásico» (sin cambios, idéntico píxel a píxel),
  «WhatsApp» (colores medidos de WhatsApp Web, agrupados como variables
  `--wa-*` «medido de WhatsApp Web, ajustable»; patrón de fondo PROPIO) y
  «Premium» (`<marca> Premium`: tonos del acento de la organización, cola
  curva, hora al pasar el cursor —siempre visible en táctil—, resortes).
- Las animaciones de entrada solo aplican a mensajes NUEVOS en vivo
  (`.bubble-enter`, lo marca `MessageThread`); el historial no se anima.
  `prefers-reduced-motion` las apaga.
- Los checks (`.tick-<estado>`) solo dibujan los estados que el sistema guarda.
- NO hechos (el dato no existe, y no hay migración): mensajes citados y el
  «escribiendo…» en la Bandeja (el componente `TypingDots` existe y se ve en la
  vista previa de Premium).
- En Apariencia, `<html>` queda en `data-chat="classic"` mientras la pantalla
  está abierta: cada tarjeta lleva su propio `data-chat` y así los estilos no
  se cuelan entre sí. Capturas antes/después: `d2-capturas/`.

## Fuera de alcance (necesita migración — pendiente)

- Que la preferencia PERSONAL siga a la persona entre dispositivos
  (`user_preference` no tiene columnas para esto).
- El Asesor no tiene Ajustes en su menú (sin permisos); llega a Apariencia por
  la URL `/settings/personalization`. Darle una entrada en el menú es decisión
  de producto aparte.

## Verificación

`tests/unit/appearance.test.ts` · `pnpm test:e2e:apariencia`
(`scripts/e2e-apariencia.mjs`) · `pnpm test:e2e:navegacion` (ajustado).

## Demfort Premium — Estilo de interfaz (PR 1)

- Tercer ajuste de Apariencia, **sin migración**: `uiStyle` (`classic` | `premium`) en `organization.metadata.appearance` y cookie personal `vocero-ui-style`; mismas reglas que letra y chat (cookie > organización > fábrica).
- `<html data-ui>` lo escribe el layout raíz. `[data-ui="premium"]` (globals.css) solo redefine tokens de color y forma con la paleta de la ficha (azul marino, fondos azulados); «Clásico» no escribe CSS. No toca el acento white-label.
- Selector «Estilo de interfaz» con maqueta de cada estilo; elegir pinta `data-ui` en todo el CRM (vista previa en vivo) y al salir sin guardar vuelve lo guardado.
- Fase A del rediseño: encabezado y base Premium (display, píldoras, entrada suave).
- PR 4 hecho: letras de la ficha (Instrument Sans y Bricolage) en Premium con la letra de fábrica.
- PR 3 hecho: menú lateral azul marino de la ficha.
- PR 2 hecho: burbujas, píldora de día y fondo del hilo Premium (solo si el chat es «Clásico»). Siguientes PRs: luego en el resto de pantallas, luego pulido.
