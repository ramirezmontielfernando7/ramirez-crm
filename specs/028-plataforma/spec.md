# 028 — Administrador de plataforma y alta de organizaciones (Fase 3 multitenant, PR 2)

**Estado:** implementado · guion E2E [`tests/e2e/us-plataforma.md`](../../tests/e2e/us-plataforma.md)
(`pnpm test:e2e:plataforma`) · migración `0029_plataforma.sql` · reversa
`scripts/sql/0029-reversa.sql` · operación: [docs/plataforma.md](../../docs/plataforma.md).

## Historias

1. **Administrador de plataforma**, separado del Propietario de cada
   organización: fila en `platform_admin` **y** miembro de la organización de
   la plataforma (`PLATFORM_ORG_ID`). El primero lo crea el operador con
   `scripts/platform-admin.mjs` (sin `--apply` solo muestra los pasos); nunca
   desde la interfaz. Para todos los demás, `/platform` y `/api/platform/*`
   responden **404**.
2. **/platform**: lista de organizaciones con estado y metadatos (personas,
   Propietarios, WhatsApp conectado); alta con su primer Propietario;
   suspender, reactivar, borrar (suave, 30 días) y restaurar; personas de cada
   organización (nombre, correo, rol); bitácora. **Nunca contenido** de un
   negocio. El borrado definitivo es `scripts/purge-organization.mjs` (se
   niega dentro del plazo, exige el nombre exacto, borra cuentas y archivos).
3. **Suspendida o borrada** (`src/server/platform-admin/org-status.ts`): sus
   usuarios no inician sesión (mensaje claro) y sus sesiones abiertas dejan de
   valer; sus webhooks van a `webhook_unrouted` con motivo `org_suspended` /
   `org_deleted`; no se envía nada (texto, adjuntos, plantillas, campañas en
   curso se detienen, agente callado, cerebro externo 403). La organización de
   la plataforma no se suspende ni se borra.
4. **Registro público cerrado.** Alta del primer Propietario por **enlace de
   activación** de un solo uso (72 h). No hay correo en el núcleo
   (constitución II): el administrador ve el enlace una vez y lo entrega.
5. **Bitácora** `platform_audit_log`: quién, qué, sobre qué organización o
   persona, cuándo, IP. Sin FK (sobrevive a la purga). Nunca secretos ni
   enlaces.
5b. **Restablecimiento**: enlace de un solo uso (2 h) para que la persona
   ponga SU contraseña. Antes, el administrador vuelve a escribir la suya; 3
   fallos → bloqueo de 15 min (en la BD). Usarlo cierra las sesiones de la
   persona, guarda IP y navegador y deja un aviso de sistema en el canal de
   **Avisos** de su organización. Las rutas de "olvidé mi contraseña" de
   better-auth están cerradas.
6. **Cabeceras (H10)**: HSTS de **1 día**, `X-Frame-Options: DENY` +
   `frame-ancestors 'none'` (aplicados), `nosniff`, `Referrer-Policy`,
   `Permissions-Policy`, CSP en **modo reporte** con `/api/csp-report`.
7. **E2E** (`scripts/e2e-plataforma.mjs`): alta desde /platform, activación,
   aislamiento en los dos sentidos, suspensión, restablecimiento y bloqueo,
   borrado suave, purga, cabeceras, 404 a usuarios comunes.

## Límite documentado

Sin correo, quien entrega el enlace podría usarlo. Mitigación: un solo uso,
IP y navegador en la bitácora, aviso en Avisos. Lo cierra un **correo
transaccional** como conector opcional (más adelante).

## Datos (0029, aditiva e idempotente)

`organization.status/status_reason/status_changed_at/deleted_at/purge_after`
(todas las existentes quedan `active`). Tablas de plataforma (sin RLS, solo
`vocero_system`): `platform_admin`, `platform_audit_log`, `account_link_token`.
