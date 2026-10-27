# Guion E2E — «Conectar con Facebook» (Tech Provider, PR 1)

Automatizado en `scripts/e2e-conectar-facebook.mjs` (CI, job «dos organizaciones»).

Contexto: el negocio termina el Registro insertado de Meta en su navegador y
la pantalla manda al servidor `code` (vence a los 30 s), `wabaId`,
`phoneNumberId`, `flow` (`new_number` | `business_app`) y, si el número es
nuevo, un `pin` de 6 dígitos. Ruta: `POST /api/settings/whatsapp/embedded-signup`
(`settings.manage`).

1. `GET /api/settings/whatsapp` trae `embeddedSignup` (App ID, ID de
   configuración, versión de la Graph API) y jamás el App Secret. Sin
   `META_EMBEDDED_SIGNUP_CONFIG_ID` llega `null` y queda solo la conexión manual.
2. Número nuevo sin PIN → 422 `pin_required`.
3. Código vencido o ya usado → 422 `code_expired` («Vuelve a dar clic…») y no
   se guarda nada.
4. PIN distinto al que ya tiene el número (Meta 133005) → 422 `pin_mismatch`,
   sin guardar.
5. Código + PIN → 200: el número queda conectado (`connected`), el token del
   negocio cifrado (solo sus últimos 4 a la vista), el número registrado en
   la Cloud API (`platform_type` = `CLOUD_API`) y la app suscrita a la WABA.
6. Coexistencia (`business_app`) → 200 sin PIN y SIN volver a registrar el
   número (ya está registrado en el celular); reemplaza la conexión anterior.
7. Otro negocio no puede quedarse con un número ya conectado → 409: es el
   mismo camino que la conexión manual (`validateConnection`), cubierto en
   `scripts/e2e-credenciales.mjs`.

## Coexistencia (PR 3)

8. Al conectar con `business_app` se piden a Meta, una vez cada uno,
   `POST {phone}/smb_app_data` con `smb_app_state_sync` y `history`
   (`historyRequested: true` en la respuesta).
9. Webhook `smb_app_state_sync`: cada `add` crea el contacto con su nombre
   del celular; `remove` no borra nada del CRM.
10. Webhook `history`: cada mensaje entra al chat del cliente (entrante o
    saliente «a mano», con su estado de Meta) SIN no leídos, sin abrir la
    ventana de 24 h, sin pausar la IA y sin crear lead; el chat toma la hora
    del último mensaje y se ve en la Bandeja.
11. Un `media_placeholder` se completa cuando Meta manda después su archivo
    (mismo `wamid`, sin duplicar). Lotes repetidos no duplican.
12. Si el negocio no comparte su historial (error 2593109) el webhook
    responde 200 y no pasa nada más.
