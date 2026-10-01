# Administrador de plataforma y alta de organizaciones (Fase 3 multitenant · PR 2)

Spec: [specs/028-plataforma](../specs/028-plataforma/spec.md) · migración
`0029_plataforma.sql` · reversa `scripts/sql/0029-reversa.sql`.

## Qué es

- **Administrador de plataforma**: no es un rol de un negocio. Es una fila en
  `platform_admin` **y** ser miembro de la organización de la plataforma
  (`PLATFORM_ORG_ID`). Tiene que cumplir las dos cosas. Para cualquier otra
  persona, `/platform` y `/api/platform/*` responden **404**.
- **/platform**: alta de organizaciones con su primer Propietario; suspender,
  reactivar, borrar (borrado suave con 30 días de gracia) y restaurar; ver las
  personas (nombre, correo y rol) y generar un enlace para que una de ellas
  ponga su contraseña; bitácora. **Nunca** se ve el contenido de un negocio
  (conversaciones, mensajes, contactos, notas).
- **Una organización suspendida o borrada**:
  - sus usuarios no entran y sus sesiones abiertas se cierran;
  - sus webhooks se guardan en `webhook_unrouted` (motivo `org_suspended` u
    `org_deleted`, 7 días) y no se procesan;
  - no sale nada: mensajes, plantillas, campañas (la que esté enviando se
    detiene), agente y cerebro externo.
- **Borrado definitivo**: solo con `purge-organization.mjs`, pasados los 30
  días y escribiendo el nombre exacto.

## Enlaces de un solo uso (sin correo)

| Enlace | Dura | Lo genera |
|---|---|---|
| Activación (`/activar/…`) | 72 h | el alta de la organización |
| Restablecimiento (`/restablecer/…`) | 2 h | el administrador, tras volver a escribir **su** contraseña |

- La persona pone **su** contraseña: el administrador nunca la ve ni la fija.
- Solo se guarda el SHA-256 del enlace. Se muestra una sola vez.
- Un enlace nuevo anula el anterior de esa persona.
- Al usarse se registran la IP y el navegador, y se cierran las sesiones de la
  persona. Si es un restablecimiento, se publica además un aviso en el canal
  **Avisos** de su negocio. Lo ve todo el equipo, incluida la persona.
- Si el administrador escribe mal su contraseña 3 veces, queda bloqueado 15
  minutos. El contador vive en la base de datos, así que reiniciar no lo borra.
  Cada intento queda en la bitácora.
- Las rutas de «olvidé mi contraseña» de better-auth están cerradas.

> **Límite:** Vocero no tiene correo en el núcleo (constitución II). Quien
> entrega el enlace (tú) técnicamente podría usarlo. Lo mitigan el uso único,
> la bitácora y el aviso en Avisos. Lo cerraría de verdad un **correo
> transaccional** como conector opcional, apagado por defecto: el enlace iría
> directo a la persona.

## Cabeceras de seguridad (H10)

| Cabecera | Valor | Aplicada |
|---|---|---|
| `Strict-Transport-Security` | `max-age=86400` (1 día, sin subdominios) | sí; se sube en un PR posterior |
| `X-Frame-Options` | `DENY` | sí |
| `Content-Security-Policy` | `frame-ancestors 'none'` | sí |
| `Content-Security-Policy-Report-Only` | política completa (ver `src/lib/security/headers.ts`) | **solo reporta** |
| `X-Content-Type-Options` | `nosniff` | sí |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | sí |
| `Permissions-Policy` | sin cámara, micrófono, geolocalización, pago ni USB | sí |

Lo que una CSP estricta podría romper, y por qué empieza en modo reporte:

- Los scripts que Next mete en línea para hidratar la página (por eso lleva
  `'unsafe-inline'`; quitarlo exige *nonces*).
- El `<style>` en línea del acento de marca.
- Las vistas previas `blob:`/`data:` de adjuntos (ya permitidas).

Nada de Vocero usa iframes, cámara ni micrófono. Los reportes salen en el log
como `[csp] la CSP bloquearía algo directiva=… bloqueado=<host>`. Tras una
semana sin reportes, se vuelve obligatoria en un PR chico.

## Pasos de Coolify (PR 2)

1. **Backup de la base.** Recurso de PostgreSQL → **Backups** → **Backup Now**.
   - Debes ver: el backup nuevo en **Success**.
   - Si falla, no sigas.
2. **Fusiona y despliega** sin tocar variables.
   - Debes ver en **Logs** que `[migrate]` aplica la 0029 sin errores.
   - Tu login sigue funcionando y la Bandeja carga.
   - En el menú todavía **no** aparece «Plataforma» (aún no eres
     administrador).
   - Revertir: despliega el commit anterior. Las columnas nuevas no
     estorban. Para quitarlas, usa la reversa (abajo).
3. **Hazte administrador de plataforma** con el prompt de abajo, en tu sesión
   SSH. Primero muestra los pasos sin escribir; solo con tu «sí» escribe.
   - Debes ver: `Hecho: <tu correo> ya es administrador de plataforma`.
   - Revertir: el mismo prompt con `remove` en vez de `add`.
4. **Recarga la app.**
   - Debes ver «Plataforma» en el menú, y en /platform tu organización con
     la etiqueta «Plataforma» y sin botones de suspender ni borrar.
5. **Comprueba las cabeceras.** En el navegador: DevTools → Red → cualquier
   página → Encabezados de respuesta.
   - Debes ver `strict-transport-security: max-age=86400` y
     `content-security-policy-report-only: …`.
   - Revertir: no aplica. Con HSTS de un día, revertir el código deja de
     exigirlo como mucho al día siguiente.

### Prompt para tu sesión SSH: hacerte administrador de plataforma

> Conéctate por SSH al servidor de Coolify. Busca el contenedor de la app
> Vocero con `docker ps --format '{{.Names}}  {{.Image}}'` (el de la app, no
> el de Postgres) y dime cuál elegiste. Luego corre, SIN `--apply`:
> `docker exec <contenedor> node ops/platform-admin.mjs add --email <MI CORREO>`
> y muéstrame la salida completa, paso por paso. Detente ahí y pregúntame si
> continúo. Solo si respondo «sí», corre el mismo comando agregando
> `--apply` y muéstrame la salida. No corras ningún otro comando que escriba,
> no muestres variables de entorno y no toques nada más.

### Prompt para tu sesión SSH: purgar una organización borrada

Solo después de sus 30 días de gracia:

> Conéctate por SSH al servidor de Coolify y busca el contenedor de la app
> Vocero como antes. Corre SIN `--confirm`:
> `docker exec <contenedor> node ops/purge-organization.mjs --org <org_…>`
> y muéstrame la salida (estado, fechas y conteos). Detente y pregúntame. Solo
> si respondo «sí, purga», corre lo mismo con
> `--confirm "<nombre exacto que salió en la salida>"` y muéstrame la salida.
> No corras nada más.

## Reversa (sin migración nueva)

1. **Código:** vuelve a desplegar el commit anterior al PR 2.
2. **Base (opcional):** con el código viejo ya corriendo, aplica
   `scripts/sql/0029-reversa.sql` como dueño del esquema (te doy el prompt
   SSH si hace falta).
   - Ojo: una organización suspendida o borrada vuelve a quedar activa, y se
     pierden la bitácora de plataforma, los administradores y los enlaces
     pendientes.
3. **Último recurso:** restaurar el backup del paso 1.
