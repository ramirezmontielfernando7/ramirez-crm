# US — Credenciales y webhooks endurecidos (027, Fase 3 PR 1)

Automatizado: `pnpm test:e2e:credenciales` (`scripts/e2e-credenciales.mjs`),
con la app viva y los mocks (wa-mock, ai-mock, zernio-mock).

## Precondiciones

- `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
  `OPENROUTER_BASE_URL` → ai-mock con `OPENROUTER_API_TOKEN`/`MODEL`
  cualquiera (si no, la parte de IA se omite y lo dice).
- `CHANNELS` con `messenger` para el caso de Zernio (si no, se omite).

## Guion

1. Propietario A guarda WhatsApp con un WABA ID con caracteres raros → 422
   `invalid_waba_id`.
2. Con una WABA a la que el número no pertenece (`WABA-AJENA-…` en el mock)
   → 422 `phone_not_in_waba` con mensaje que dice qué revisar.
3. Con un token sin `whatsapp_business_management` (`…-noperm`) → 422
   `missing_permission`.
4. Con su número y su WABA → 200.
5. La propietaria B intenta el número de A → 409 `phone_in_use`; la WABA de
   A → 409 `waba_in_use`. Nunca 500. La conexión de A queda intacta.
6. Llega un mensaje para un número que nadie conectó → el webhook responde
   200, el evento queda en `webhook_unrouted`, sin el texto en claro, y no
   entra a ninguna organización.
7. Con la cuota de IA de A en 0 turnos: el asistente de redacción → 429
   `quota_exceeded`; un lead escribe con el agente encendido → la
   conversación pasa a una persona con motivo `cuota`, sin respuesta de IA y
   sin turno contado. Sin tope, el asistente responde y su turno y sus
   tokens quedan en `ai_usage`.
8. Una cuenta de Zernio sin secreto guardado manda un evento firmado con
   cualquier secreto → 401.

## Camino infeliz

- Llave de cifrado faltante o equivocada: `getOrgCredentials` devuelve
  `key_unavailable` / `decrypt_failed` (pruebas de BD); el arranque no se cae.
- Proveedor de IA caído: la reserva cuenta el turno y el agente escala como
  antes (motivo `error`).
