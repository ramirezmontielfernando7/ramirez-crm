# Administrador de plataforma y alta de organizaciones (Fase 3 multitenant · PR 2 y PR 3)

Spec: [specs/028-plataforma](../specs/028-plataforma/spec.md) · migración
`0029_plataforma.sql` · reversa `scripts/sql/0029-reversa.sql`.
Módulos por organización (PR 3): [specs/029-modulos-por-organizacion](../specs/029-modulos-por-organizacion/spec.md)
· migración `0030_modulos_por_organizacion.sql` · reversa
`scripts/sql/0030-reversa.sql`.

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
- **Pestañas (040)**: «Organizaciones y Planes» (`/platform` abre aquí: tabla
  con estado, plan guardado —Plan Esencial / Pro / Ultra o Personalizado—,
  módulos x/13, IA del mes y almacenamiento; filtros por estado y plan; cada
  fila abre su ficha en cuatro pestañas: Plan y módulos, Topes y visibilidad,
  Consumo y almacenamiento, Accesos y estado), «Costos y Precios IA»,
  «Webhooks sin ruta» (lo guardado en `webhook_unrouted`, agrupado por llave;
  solo metadatos, nunca el contenido) y «Administradores y auditoría» (quién
  administra —se dan con `ops/platform-admin.mjs`— y la bitácora).
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
| `Content-Security-Policy` | `frame-ancestors 'none'` | sí, salvo en adjuntos y favicon (mandan su propia CSP `sandbox`) |
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

## Módulos por organización (PR 3)

Campañas, Agenda, Atribución, Instagram y Messenger se encienden **por
organización** desde /platform (interruptores en cada organización, con
bitácora). Las variables `CAMPAIGNS`, `AGENDA`, `ATRIBUCION`, `CHANNELS` y
`CAMPAIGN_SEND_RATE` ya no encienden nada para toda la instancia: son el
valor con el que nace una organización nueva.

- **Al desplegar no cambia nada.** El arranque le pone a cada organización
  sin fila lo que las variables tienen hoy, y nunca pisa una fila que ya
  existe. Tu organización queda exactamente igual.
- **Apagar un módulo** lo hace desaparecer para esa organización al instante:
  pantallas y rutas en 404, fuera del menú. Lo que tenía guardado (citas,
  campañas, conexiones) **no se borra**; al encenderlo vuelve a estar.
  - Campañas: la que esté enviando se detiene.
  - Atribución: deja de guardarse el `ctwa_clid` y de reportarse a Meta. El
    origen del anuncio se sigue viendo.
  - Instagram / Messenger: los mensajes que lleguen se ignoran con un aviso
    en el log y no se envía nada por ese canal.
- **Ritmo de campañas:** de 1 a 80 mensajes por segundo por organización.
  Vacío: el de `CAMPAIGN_SEND_RATE` (o 10).
- **`parent_id`** (organización madre) existe en la base pero nada lo usa
  todavía.

### Asistente interno (038, premium)

El 13.º interruptor. Nace **apagado** en toda organización (no hay variable
ni perfil de alta que lo encienda) y solo lo usa el **Propietario**. Antes de
encenderlo:

1. Fija su **tope propio** en «Plan y topes» → «Asistente interno: tokens al
   mes» (o define `AI_DEFAULT_MONTHLY_ASSISTANT_TOKENS` para todas). **Sin tope,
   el asistente no responde.** Su consumo cuenta también en el tope total de IA.
2. Elige **qué ve el cliente de su consumo de IA** («Qué ve el cliente…»):
   porcentaje del tope (por defecto), solo «Disponible / Agotado», o tokens.
   El cliente nunca ve dólares; tú ves las cifras reales aquí y en Costos.

Desde el PR 2 del 038 el Propietario le hace preguntas en `/asistente`. Lo
que conviene saber antes de encenderlo:

- **Solo lectura y catálogo cerrado.** El modelo no escribe SQL: pide
  consultas de una lista fija (consumo de IA, almacenamiento, plan y topes,
  avisos, módulos, equipo, etiquetas, leads por etapa y conversaciones
  recientes), todas a nombre de la organización (RLS).
- **Datos personales enmascarados.** Nombres de contactos y del equipo,
  teléfonos y correos viajan al proveedor de IA como fichas («[CONTACTO 1]»);
  el Propietario ve los datos reales en la respuesta.
- **Cada respuesta dice de dónde salen sus datos** («Datos de: …») y deja ver
  lo que devolvió cada consulta.
- **Topes por pregunta:** hasta 6 consultas y 4 llamadas al modelo, una
  pregunta a la vez por persona y 6 por minuto. Cada llamada cuenta contra su
  tope propio y el total.
- Las conversaciones son de quien las abre y se borran a los **90 días** sin
  actividad. Tú (plataforma) no las ves.
- **Análisis de conversaciones (PR 3).** Para preguntas como «¿por qué pierdo
  ventas?», el asistente analiza cada conversación UNA vez y guarda el
  resultado (resultado, motivo de pérdida, objeción, desempeño del asesor);
  sin mensajes nuevos lo reutiliza sin volver a pagar. Hasta 20 conversaciones
  nuevas por pregunta (de a 5 por llamada, de la más reciente a la más
  vieja); si faltan, lo dice. Las vacías, muy cortas, solo con audios o
  imágenes, o solo con mensajes automáticos se marcan «sin información
  suficiente» sin gastar IA. Para que cueste menos, define
  `OPENROUTER_ANALYSIS_MODEL` (p. ej. `anthropic/claude-haiku-4.5`); sin ella
  usa `OPENROUTER_MODEL`.

### Pasos de Coolify (PR 3)

1. **Backup de la base.** Recurso de PostgreSQL → **Backups** → **Backup Now**.
   - Debes ver: el backup nuevo en **Success**.
   - Si falla, no sigas.
2. **Fusiona y despliega** sin tocar variables.
   - Debes ver en **Logs**: `[migrate]` aplica la 0030 sin errores y, al
     arrancar, `[modules] módulos por organización: 1 organización(es) con los
     valores del entorno`.
   - Revertir: despliega el commit anterior (el código viejo vuelve a leer
     las variables para toda la instancia; la tabla nueva no estorba).
3. **Comprueba que nada cambió.** Entra como siempre.
   - Debes ver en el menú lo mismo que antes (Campañas y Citas si las tenías)
     y abrir esas pantallas sin error.
4. **Mira tus módulos en /platform** (necesitas ser administrador de
   plataforma: el script de la sección anterior).
   - Debes ver en tu organización los interruptores encendidos igual que tus
     variables de hoy.
   - No hace falta tocarlos. Las variables puedes dejarlas como están.

### Prompt para tu sesión SSH: ver los módulos (solo lectura)

> Conéctate por SSH al servidor de Coolify. Busca el contenedor de Postgres
> de Vocero con `docker ps --format '{{.Names}}  {{.Image}}'` y dime cuál
> elegiste. Corre, en SOLO LECTURA:
> `docker exec <contenedor> psql -U postgres -d <base> -c "select o.name, m.campaigns, m.agenda, m.atribucion, m.channels, m.campaign_send_rate, m.updated_by from organization o left join organization_module m on m.organization_id = o.id order by o.created_at"`
> y muéstrame la salida. No corras nada que escriba y no muestres variables
> de entorno.

### Reversa del PR 3 (sin migración nueva)

1. **Código:** vuelve a desplegar el commit anterior al PR 3.
2. **Base (opcional):** con el código viejo ya corriendo, aplica
   `scripts/sql/0030-reversa.sql` como dueño del esquema. Se pierde lo que
   cada organización tenía encendido (con el código viejo vuelven a mandar las
   variables).
3. **Último recurso:** restaurar el backup del paso 1.

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
> (usa `DATABASE_URL_SYSTEM` y `PLATFORM_ORG_ID` del propio contenedor; no
> las muestres)
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
