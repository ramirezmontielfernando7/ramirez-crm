# US — Módulos por organización (029, Fase 3 PR 3)

Automatizado: `pnpm test:e2e:modulos` (`scripts/e2e-modulos.mjs`), con la app
viva, los mocks y
`PLATFORM_ORG_ID` = la organización de `e2e@vocero.test`.

## Guion

1. La organización del operador (A) ya tiene su fila de módulos (relleno al
   arrancar). El administrador la deja con todo encendido.
2. Alta de B desde la API de plataforma; B activa su cuenta, conecta WhatsApp
   y Messenger. B nace con los módulos de las variables (su fila y Campañas lo
   confirman); el administrador le enciende todo; citas → 200; /platform
   lista sus módulos.
3. Una usuaria común no puede cambiar módulos (404). El administrador apaga
   todo en B; un ritmo fuera de 1–80 → 400/422; una organización que no existe
   → 404.
4. Con la sesión de B, cada ruta (campañas, citas, horario, disponibilidad,
   Zoom, Google, CAPI, Messenger, Instagram) → 404; con la de A, no. Las
   pantallas (/campaigns, /campaigns/new, /bookings, Ajustes de Agenda,
   Anuncios y Messenger) → 404 para B y 200 para A. El menú y las pestañas
   de B no los muestran.
5. Webhooks: un anuncio a B se guarda SIN `ctwa_clid` (a A, con él). Un
   mensaje de Messenger a la página de B → 200 pero no entra; con Messenger
   encendido para B, el siguiente sí.
6. Desde /platform (navegador) se enciende Campañas de B con el interruptor:
   B vuelve a tener Campañas (200) y Agenda sigue en 404. La bitácora tiene
   cada cambio.
