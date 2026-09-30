# Guion E2E — Firma del webhook de WhatsApp

> Automatizado en `scripts/e2e-firma-webhook.mjs` (`pnpm test:e2e:firma`, app
> viva, después de `pnpm test:e2e`). Córrelo en los TRES modos: con
> `META_APP_SECRET`; sin él y sin mocks; sin él y con `WA_MOCK_ENABLED=true`.
> Con `SERVER_LOG=<archivo del log del servidor>` revisa también el arranque.

**Sin `META_APP_SECRET`** (H7: obligatorio en producción)

1. El servidor ARRANCA igual (no falla) y el log dice
   `[boot] META_APP_SECRET no está definido: la firma … NO se verifica`.
2. `GET /api/settings/webhook` → `signatureLayer: false`.
3. Ajustes → WhatsApp → tarjeta del webhook: aviso ámbar **«Firma no
   verificada»** que dice que falta `META_APP_SECRET` y que es obligatorio.
4. Sin mocks: un `POST` al webhook sin `x-hub-signature-256` → **401**, y el
   log registra `[webhook] Evento de WhatsApp rechazado (401)…`.
5. Con `WA_MOCK_ENABLED=true` fuera de producción (desarrollo / E2E): el
   mismo `POST` → 200. En producción esta salida nunca se activa.

**Con `META_APP_SECRET`**

1. El arranque NO advierte y el secreto no aparece en el log.
2. `signatureLayer: true`; la tarjeta dice «Verificación de firma activa» y
   no hay aviso.
3. `POST` sin firma → 401; con firma de otro secreto → 401; firmado con el
   App Secret → 200.
