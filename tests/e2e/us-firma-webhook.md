# Guion E2E — Firma del webhook de WhatsApp

> Automatizado en `scripts/e2e-firma-webhook.mjs` (`pnpm test:e2e:firma`, app
> viva en `pnpm dev` con los mocks, después de `pnpm test:e2e`). Córrelo en
> los DOS modos: con el servidor arrancado sin `META_APP_SECRET` y con él.
> Con `SERVER_LOG=<archivo del log del servidor>` revisa también el arranque.

**Sin `META_APP_SECRET`** (instancias existentes: nada se rompe)

1. El servidor arranca y el log dice
   `[boot] META_APP_SECRET no está definido: la firma … NO se verifica`.
2. `GET /api/settings/webhook` → `signatureLayer: false`.
3. Ajustes → WhatsApp → tarjeta del webhook: aviso ámbar **«Firma no
   verificada»** que dice que falta `META_APP_SECRET`.
4. Un `POST` al webhook sin `x-hub-signature-256` → 200 (se procesa).

**Con `META_APP_SECRET`**

1. El arranque NO advierte y el secreto no aparece en el log.
2. `signatureLayer: true`; la tarjeta dice «Verificación de firma activa» y
   no hay aviso.
3. `POST` sin firma → 401; con firma de otro secreto → 401; firmado con el
   App Secret → 200.
