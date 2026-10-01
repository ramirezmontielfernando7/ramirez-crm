# US — Administrador de plataforma y alta de organizaciones (028, Fase 3 PR 2)

Automatizado: `pnpm test:e2e:plataforma` (`scripts/e2e-plataforma.mjs`), con
la app viva, los mocks y `PLATFORM_ORG_ID` = la organización de
`e2e@vocero.test`.

## Guion

1. Sin el rol: `/platform` y `/api/platform/organizations` → 404.
2. `scripts/platform-admin.mjs add --email …` sin `--apply` muestra los pasos
   y no escribe; con `--apply` da el rol. Una cuenta inexistente → error.
3. Desde /platform (navegador): crear la organización B → enlace de
   activación visible una vez; no está en la BD (solo su hash). El mismo
   correo otra vez → 409. Antes de activar, B no entra; con el enlace pone su
   contraseña; el enlace no sirve dos veces.
4. Aislamiento: cada una ve solo sus conversaciones; B (usuaria común) → 404
   en /platform y no ve «Plataforma» en el menú; el administrador ve B en la
   lista sin su contenido.
5. Suspender B: su sesión → 401; su login → 403 con «Tu negocio está
   suspendido» (también en la pantalla); su webhook → 200 pero el evento va a
   `webhook_unrouted` (`org_suspended`) y no entra; A sigue normal. Reactivar
   → B entra. La organización de la plataforma no se suspende (422).
6. Restablecimiento: contraseña del administrador incorrecta → 403 sin enlace;
   correcta → enlace de 2 h; una usuaria común no puede (404). B pone su
   contraseña nueva; su sesión vieja se cierra; la vieja contraseña ya no
   entra; aviso en Avisos; bitácora completa. Tres fallos → 423, y bloqueado
   ni la correcta sirve.
7. Borrar B: 30 días de gracia, no entra; purgarla dentro del plazo se niega;
   restaurar → activa.
7b. Purga de una organización desechable con el plazo vencido: sin
   `--confirm` solo muestra conteos; nombre equivocado → se niega; nombre
   exacto → se va la organización, la cuenta de su Propietario y queda en la
   bitácora.
8. Cabeceras: HSTS `max-age=86400`, `X-Frame-Options: DENY`, `nosniff`,
   `Referrer-Policy`, CSP en reporte con `frame-ancestors`, `/api/csp-report`
   → 204.
