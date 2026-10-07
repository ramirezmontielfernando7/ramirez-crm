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

## Fuera de alcance (necesita migración — pendiente)

- Que la preferencia PERSONAL siga a la persona entre dispositivos
  (`user_preference` no tiene columnas para esto).
- El Asesor no tiene Ajustes en su menú (sin permisos); llega a Apariencia por
  la URL `/settings/personalization`. Darle una entrada en el menú es decisión
  de producto aparte.

## Verificación

`tests/unit/appearance.test.ts` · `pnpm test:e2e:apariencia`
(`scripts/e2e-apariencia.mjs`) · `pnpm test:e2e:navegacion` (ajustado).
