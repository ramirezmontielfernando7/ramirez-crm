# Ficha técnica — ramirez-crm (Dashfort by Demfort, fork de Vocero CRM)

> Fotografía de `main` en el commit `37d7cbe` (25-sep-2026), tomada en
> **solo lectura**: sin instalar dependencias, sin levantar el servidor, sin
> tocar la base y sin correr migraciones. Todo lo que dice este documento sale
> del código, del historial de git o de la API de GitHub. Lo que no se pudo
> comprobar lleva la marca **⚠️ NO VERIFICADO**.

---

## 1. Resumen

| Dato | Valor | Fuente |
|---|---|---|
| Versión | **1.4.0** (sin cambiar desde el upstream, aunque el fork ya trae 020–024) | `package.json` |
| Última migración | **`0019_conocimientos.sql`** (20 migraciones: 0000–0019; el `_journal.json` y los snapshots cuadran) | `drizzle/` |
| Tablas | **40** `pgTable` (8 de auth/organización + 32 de dominio) | `src/lib/db/schema.ts` |
| Rutas API | **98** archivos `route.ts` (**83** sin contar los 15 mocks de `dev/`), 147 handlers exportados | `src/app/api/**` |
| Commits desde el fork | **18** sobre el último commit del upstream (`b3469f9`, merge de kevinrivm/#75): 16 sin merges + 2 merges | `git log b3469f9..HEAD` |
| PRs fusionados del fork | **14** (#1–#14), todos fusionados entre el 24 y el 25-sep-2026 | GitHub |
| Tamaño | ~48 300 líneas TS/TSX en `src/`, 81 componentes `.tsx` | `wc` |
| CI en `main` | **Verde** (CI + Imagen, corrida 29, sobre `37d7cbe`) | GitHub Actions |

### PRs fusionados (fork)

| PR | Qué trajo | Spec |
|---|---|---|
| #1 | Registro: distinguir registro cerrado de `INVALID_ORIGIN` en 403 | — |
| #2 | **Roles Propietario / Coordinador / Asesor y asignación de chats** (+ fix de fuga de contactos ajenos al dar de alta un teléfono duplicado) | 020 |
| #3 | **Etiquetas, consentimiento, importar/exportar CSV y campañas por plantilla** | 021 |
| #4 | Menú lateral colapsable por rol, panel de Detalles, **línea de tiempo del chat** | 022 |
| #5, #6, #9, #11, #12 | Pulido de la Bandeja (lista compacta, barra de filtros, buscador, renglones, encabezados de 56 px, letra del sistema) | — |
| #7, #8 | Motion calibrado y menú de tres estados | 022 |
| #10 | **Marca Dashfort by Demfort** (logo, teal, color del menú lateral) | — |
| #13 | Compositor: emojis, pegar imágenes con Ctrl+V, clip colapsable | — |
| #14 | **Asistente de redacción con IA** y **Conocimientos** | 023, 024 |

---

## 2. Roles y permisos

### La matriz — `src/lib/auth/permissions.ts`

- Se declara con `createAccessControl` del plugin `organization` de
  **better-auth**; el mismo objeto `ac` se pasa al plugin, así que las rutas
  propias de better-auth (`organization`, `member`, `invitation`, `team`, `ac`)
  respetan los mismos roles (esos recursos solo los tiene `owner`).
- **Un solo punto de verdad**: `can(session, "recurso.acción")`. Falla
  **cerrado**: un rol desconocido en BD no puede nada.
- `member.role` es texto libre en BD (lo exige better-auth; default
  `asesor`). Solo `coordinador` y `asesor` se asignan desde Ajustes → Equipo;
  hay un solo Propietario.

| Permiso | Propietario | Coordinador | Asesor |
|---|:-:|:-:|:-:|
| `settings.manage` (marca, WhatsApp, webhook, canales, agenda, anuncios/CAPI, Zoom/Google) | ✅ | — | — |
| `agent.manage` (perfil del agente, KB del agente, Laboratorio) | ✅ | — | — |
| `users.manage` (altas, roles, bajas) | ✅ | — | — |
| `users.read` | ✅ | ✅ | — |
| `pipeline.edit` (etapas) | ✅ | ✅ | — |
| `templates.manage` | ✅ | ✅ | — |
| `contacts.import` / `contacts.export` | ✅ | ✅ | — |
| `tags.manage` | ✅ | ✅ | — |
| `campaigns.manage` | ✅ | ✅ | — |
| `assignment.manage` (asignar/reasignar, en lote) | ✅ | ✅ | — |
| `scope.all` (ver todos los chats/leads/citas) | ✅ | ✅ | — |
| `results.read` / `results.all` | ✅ | ✅ | — |
| `knowledge.manage` (crear/editar/borrar Conocimientos) | ✅ | ✅ | — |

El **Asesor** tiene un rol vacío (`ac.newRole({})`): solo ve lo que tiene
asignado, puede mover *sus* leads, responder *sus* chats, usar el asistente de
redacción y ver/enviar Conocimientos. No entra a Resultados (ni a los suyos).

### Cómo se aplica en el servidor

- `withAuth(handler, { permission })` en `src/lib/api.ts` devuelve **403
  `forbidden` antes de tocar la BD**.
- `requireSession()` arma `session.access = { organizationId, userId, seesAll }`
  con `seesAll = can(session, "scope.all")`. Ningún handler lo construye a mano.
- UI: `useViewer()` (`src/components/viewer-context.tsx`) solo oculta cosas;
  la autoridad es el servidor.

### `scopedContacts()` y compañía — `src/lib/db/tenant.ts`

| Función | Qué hace |
|---|---|
| `scoped(orgCol, orgId, ...conds)` | Tenant obligatorio; lanza si `orgId` viene vacío. |
| `scopedContacts(orgCol, access, contactIdCol, ...)` | `scoped()` + "el contacto de esta fila está asignado a mí" si `!seesAll`. Sobre la tabla `contact` usa `contact.assigned_user_id = userId` directo; en las demás, un `EXISTS` correlacionado contra `contact`. |
| `assignedTo(access, contactIdCol)` | Solo la condición de asignación (para subconsultas de Resultados). `undefined` si `seesAll`. |
| `scopedConversations(...)` | Igual, para tablas que cuelgan de `conversation` (`message`, `offered_slot`…). |
| `scopedMediaAssets(...)` | Un adjunto se ve si lo trae un mensaje de una conversación visible **o** es la imagen del anuncio de un contacto visible. |

La única puerta que escribe `contact.assigned_user_id` es
`src/server/assignment/assign.ts` (y anota en `contact_assignment_event`).
Tests de vigilancia: `assignment-guard.test.ts`, `assignment-scope.test.ts` y
`assignment-visibility.test.ts`. (El comentario de `tenant.ts` cita
`scoped-contacts-guard.test.ts`, que **no existe**; ver §9, H7.)

### Tabla declarativa de rutas — `tests/unit/permissions-routes.test.ts`

Cuatro listas:

| Lista | Cuántas | Qué prueba |
|---|---|---|
| `PROTEGIDAS` | **67** (ruta, método, permiso) | Un Asesor recibe 403 en todas sin tocar la BD; un Coordinador recibe 403 en las de `settings/agent/users.manage`; y el código de cada una contiene literalmente `withAuth(… permission: "<permiso>")`. |
| `FILTRADAS` | **23** | Las usa cualquier rol pero filtran por asignación (`scopedContacts`); su prueba de datos vive en `assignment-scope.test.ts`. Incluye `events GET` (SSE). |
| `DEL_NEGOCIO` | **13** | Datos del negocio sin datos de clientes: cualquier rol con sesión (preferencias, etiquetas, plantillas, `writing-assist`, lectura de `knowledge`…). |
| `EXENTAS_PREFIJOS` | `auth/`, `bot/`, `webhooks/`, `dev/`, `health`, `branding/favicon` | Tienen su propia autenticación o son públicas. |

**Test de cobertura**: recorre todos los `route.ts`, extrae cada
`export const|async function GET|POST|…` y falla si alguno no está en ninguna
lista. Resultado: **una ruta nueva no compila en CI hasta que alguien decide
su permiso**. Además hay un test explícito de que un asesor no puede pedir
`analytics/*?userId=otro`.

---

## 3. Modelo de datos

Convenciones: todas las tablas de dominio llevan `organization_id NOT NULL`
con `ON DELETE CASCADE` e índice que empieza por la organización; ids `text`
con prefijo nanoid (`src/lib/db/ids.ts`); timestamps **sin zona, en UTC**
(la conexión fija `TimeZone: "UTC"`); enums como `text` con `enum` de Drizzle
(no `pgEnum`). **🆕 = nació (o se amplió) en un PR del fork.**

### Auth / organización (better-auth)

| Tabla | Propósito |
|---|---|
| `user`, `session`, `account`, `verification` | Cuentas y sesiones de better-auth. |
| `organization` | El negocio (una instancia = un negocio). La marca vive en `metadata`. |
| `member` | Usuario ↔ organización con `role`. 🆕 020: `role` default `asesor`, columna `sales_team_id`. |
| `invitation` | Invitaciones de better-auth. |
| `sales_team` 🆕 020 | Equipo de ventas con `coordinator_user_id`. **Solo esquema: no hay código que lo lea ni lo escriba** (único uso: prefijo en `ids.ts`). |
| `assignment_settings` 🆕 020 | Modo de reparto (`manual` / `round_robin`) + cursor. **Reservado**: `strategy.ts` siempre devuelve `manual`. |

### Clientes y embudo

| Tabla | Propósito · relaciones |
|---|---|
| `contact` | Persona. Llave estable `wa_identity` (teléfono normalizado 521→52, `bsuid:<id>`, `ig:<IGSID>`), único por (org, `channel`, `wa_identity`). `phone` es opcional. `name_source` perfil/manual, `ficha` jsonb libre (cerebro externo), `source`, `archived_at`. 🆕 020: `assigned_user_id` → `user`, `assigned_at`. 🆕 021: `wa_consent` (`opt_in`/`opt_out`/`desconocido`), `wa_consent_source`, `wa_consent_at`. |
| `contact_tag` 🆕 021 | Etiqueta del negocio, nombre único por org, color de paleta. |
| `contact_tag_assignment` 🆕 021 | N:M contacto ↔ etiqueta (PK compuesta, cascada en ambos lados). |
| `pipeline_stage` | Etapas; `kind` open/won/lost (won y lost no se borran). |
| `lead` | 1:1 con `contact` (`lead_contact_uq`) → `pipeline_stage`. Monto en centavos, moneda, prioridad. |
| `lead_stage_event` | Bitácora append-only de movimientos de etapa (snapshots de nombre/tipo; `CHECK` que exige motivo de pérdida). Única puerta: `src/server/leads/stage-history.ts`. |
| `contact_assignment_event` 🆕 020 | Bitácora append-only de asignaciones (from/to/actor, `source` manual/lote/auto/sistema/migración, `batch_id`). |
| `contact_activity_event` 🆕 022 | Bitácora append-only: notas, IA pausada/reanudada/handoff, consentimiento, etiqueta +/-. Única puerta: `src/server/activity/log.ts`. |

### Conversación

| Tabla | Propósito · relaciones |
|---|---|
| `conversation` | → `contact`. `is_test` (Laboratorio), `channel`, `channel_thread_ref`, `ai_enabled`, `handoff_at/reason`, `last_inbound_at` (ventana 24 h), `unread_count`. Una conversación real por contacto (índice parcial). |
| `message` | → `conversation`. `wa_message_id` **UNIQUE** (idempotencia), `direction`, `status` monotónico, `origin` ai/operator/manual/template, → `media_asset`. |
| `media_asset` | Adjuntos copiados a `MEDIA_DIR` (sin S3), o payload de ubicación/contactos. |
| `template` | Plantillas de Meta: nombre+idioma únicos por org, `status` draft/pending/approved/rejected, `wa_template_id`. |
| `offered_slot` | Huecos de agenda ofrecidos en una conversación (garantía anti-reserva inventada). |

### Credenciales (todas cifradas AES-256-GCM: `*_cipher`, `*_iv`, `*_tag`)

`meta_credentials` (WABA, `phone_number_id` único en la instancia, token),
`instagram_credentials`, `messenger_credentials`, `zoom_credentials`,
`google_credentials` (client secret + refresh token), `capi_settings` (dataset
+ token + etapa "lead calificado").

### Agente y Laboratorio

`agent_profile` (1 por org), `kb_entry` (lo que **sí** lee el agente),
`agent_test_run` (lock: una corrida `running` por org), `agent_test_case`.

### Agenda (bandera `AGENDA`)

`calendar_settings`, `booking` (índice único parcial anti doble-booking,
`is_test` fuera), `offered_slot`.

### Atribución (bandera `ATRIBUCION`)

`ad_attribution` (primer referral gana; imagen del creativo → `media_asset`),
`conversion_event` (dedup por (org, conversación, evento) insertando antes de
llamar a Meta), `capi_settings`.

### Campañas, Conocimientos y preferencias

| Tabla | Propósito · relaciones |
|---|---|
| `campaign` 🆕 021 | Una plantilla aprobada (`ON DELETE RESTRICT`) → público `opt_in`. `variables` y `audience` jsonb, `status` draft/sending/completed/failed. |
| `campaign_recipient` 🆕 021 | Log por destinatario; nombre y teléfono copiados; único (campaña, contacto) para no enviar dos veces. |
| `knowledge_entry` 🆕 024 | Material que el **equipo** envía (texto y/o archivo en `MEDIA_DIR/<org>/<id>`, `tags text[]`). El agente **no** la lee (hay test). |
| `user_preference` 🆕 022 | Preferencias por usuario (PK org+user): `nav_collapsed` y 🆕 0018 `nav_mode`. |

Migraciones del fork: `0015_roles_y_asignacion`, `0016_etiquetas_consentimiento_campanas`,
`0017_linea_de_tiempo_y_preferencias`, `0018_menu_tres_estados`,
`0019_conocimientos`. Todas usan `IF NOT EXISTS` (re-ejecutables).

---

## 4. Módulos por área

| Módulo | Estado | Bandera | Archivos clave |
|---|---|---|---|
| **Inbox (Bandeja)** | Estable, muy pulido por el fork (#5–#13) | — | `src/server/inbox/` (`ingest.ts` idempotente, `send.ts` con guard de sandbox, `window.ts` 24 h, `identity.ts`, `webhook.ts`), `src/components/inbox/`, `src/app/(app)/inbox` |
| **Pipeline** | Estable | — | `src/server/leads/` (`stage-history.ts` única puerta, `priority.ts`), `src/components/pipeline/`, rutas `pipeline/*` |
| **Resultados** | Estable; solo Propietario/Coordinador | — | `src/server/analytics/` (`sales`, `ads`, `bot`, `hygiene`, `period`, `scope`, `shared`), `src/lib/analytics.ts`, `src/components/results/` · spec 019 |
| **Plantillas** | Estable (crear, sincronizar estado, multivariable). Sin borrado desde la app | — | `src/server/whatsapp/templates.ts`, `template-events.ts`, rutas `templates`, `templates/sync` |
| **Campañas** 🆕 | Funcional, **apagada por defecto** | `CAMPAIGNS`, `CAMPAIGN_SEND_RATE` | `src/server/campaigns/` (`audience.ts` solo `opt_in`, `runner.ts`, `service.ts`, `flag.ts`), `src/app/(app)/campaigns` · spec 021 |
| **Etiquetas / CSV / consentimiento** 🆕 | Estable, siempre encendido | — | `src/server/tags/`, `src/server/contact-filter.ts`, `src/server/contacts-io/` |
| **Conocimientos** 🆕 | Estable; enviar desde la Bandeja con `/` o el botón de libro | — | `src/server/knowledge/` (`store.ts`, `deliver.ts` con `KnowledgeTarget`, `input.ts`), `src/components/knowledge/`, rutas `knowledge/*` y `conversations/[id]/messages/knowledge` · spec 024 |
| **IA de escritura** 🆕 | Estable; 503 sin `OPENROUTER_API_TOKEN`, 502 si falla el proveedor, 30/min por usuario | (implícita: token de IA) | `src/server/writing-assist/` (`prompts.ts`, `rewrite.ts`), `POST /api/writing-assist`, `src/components/inbox/writing-assist.tsx` · spec 023 |
| **Línea de tiempo** 🆕 | Estable | — | `src/server/activity/` (`log.ts`, `timeline.ts`), `src/lib/timeline.ts` · spec 022 |
| **Agente de IA** | Estable (upstream); coalesce de mensajes `AGENT_COALESCE_MS` | `OPENROUTER_*` (sin token no responde) | `src/lib/ai/` (`chatJson`), `src/server/ai/` (`prompts`, `actions`, `pipeline`, `trigger`, `handoff`) |
| **Cerebro externo** | Estable (upstream) | `BOT_API_KEY`, `BRAIN_HEALTH_URL` | `src/app/api/bot/*`, `src/server/bot/` |
| **Laboratorio** | Estable (upstream); sandbox que lanza excepción si toca la API real | `OPENROUTER_*` | `src/server/lab/` (`personas`, `judge`, `runner`) |
| **Agenda** | Funcional, **apagada por defecto**; conectores enlace-fijo, Zoom, Google Meet | `AGENDA` | `src/server/agenda/`, `src/server/agenda/connectors/`, `src/lib/agenda-connectors.ts` |
| **Anuncio de origen** | Siempre visible | — | `src/server/attribution/referral.ts`, `creativo.ts`, `store.ts`, `src/components/anuncio-origen.tsx` |
| **Atribución / CAPI** | Funcional, **apagada por defecto** | `ATRIBUCION` | `src/server/attribution/` (`conversions.ts`, `settings.ts`, `flag.ts`), `src/lib/meta/capi.ts` |
| **Canales Instagram / Messenger** | Funcional, **apagado por defecto**; solo texto | `CHANNELS`, `ZERNIO_BASE_URL`, `IG_GRAPH_BASE_URL` | `src/lib/channels.ts`, `src/server/channels/`, `src/server/instagram/`, `src/server/messenger/`, `src/server/zernio/` |
| **Roles y asignación** 🆕 | Estable; reparto automático **reservado** (solo manual) | — | `src/lib/auth/permissions.ts`, `src/server/assignment/`, `src/lib/db/tenant.ts` |
| **Marca Dashfort** 🆕 | Estable, white-label | — | `src/lib/brand.ts`, `src/components/brand-mark.tsx`, `src/app/globals.css` |

Las banderas se leen con `parse*Flag` (valores `on|1|true|si|sí|yes`) y,
apagadas, responden **404** en su superficie. Las tablas existen siempre.

---

## 5. Tiempo real (SSE)

- **Bus** (`src/server/events/bus.ts`): un `EventEmitter` in-process guardado
  en `globalThis.__voceroBus` (`setMaxListeners(200)`), canal
  `org:<organizationId>`. `publish()` se llama **después del commit**. Sin
  Redis ni colas: funciona porque la instancia es **un solo proceso**.
- **Eventos** (`SseEvent`):

  | Tipo | Datos | ¿Quién lo recibe si no ve todo? |
  |---|---|---|
  | `message.new` | `conversationId`, `message` | Asesor si la conversación es suya |
  | `message.status` | `conversationId`, `messageId`, `status`, `error?` | Ídem |
  | `conversation.updated` | `conversation` | Ídem (por `conversation.id`) |
  | `assignment.changed` 🆕 | `contactIds`, `toUserId`, `fromUserIds` | El que lo recibe y los que lo pierden |
  | `campaign.progress` 🆕 | `campaignId`, `status`, `counts` | Nadie (solo `seesAll`) |
  | `booking.updated` | `bookingId` | Asesor si la cita es de un contacto suyo |
  | `lab.run` | `runId`, `status`, `progress`, `score` | Nadie (solo `seesAll`) |

- **Ruta** `GET /api/events`: `requireSession()`, headers
  `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`,
  heartbeat `: ping` cada 25 s, `id: Date.now()`. Sin replay: el cliente se
  pone al día con `since=`.
- **Filtro por suscriptor** (`src/server/events/visibility.ts`,
  `canSeeEvent`): quien tiene `seesAll` recibe todo sin consultas; para un
  asesor cada evento pasa por una consulta con `scopedContacts`, encadenada en
  una promesa para no desordenar. Falla cerrado: si la consulta truena, el
  evento no se envía (`.catch(() => {})` intencional con comentario).

---

## 6. WhatsApp / Meta

| Tema | Lo que hay |
|---|---|
| Versión de Graph API | **`v25.0`** por defecto (`META_GRAPH_API_VERSION`), host `https://graph.facebook.com` (`META_GRAPH_BASE_URL`). Instagram usa `graph.instagram.com` con la misma versión. |
| Cliente | `src/lib/meta/client.ts` → `graphRequest()` es la única frontera de salida (salvo descarga/subida de media con `fetch` directo en `src/server/whatsapp/media.ts`). `MetaApiError.isAuthError` = 401 o código 190 y nunca ≥500. |
| Endpoints llamados | `GET {phone_number_id}?fields=display_phone_number,verified_name` (probar conexión) · `GET/POST {waba_id}/subscribed_apps` · `GET/POST {waba_id}/message_templates` · `POST {phone_number_id}/messages` (texto, media, plantilla, leído + "escribiendo…") · `POST {phone_number_id}/media` · `GET {media_id}` + descarga de su `url` · `POST {dataset_id}/events` (CAPI) · Messenger: `POST {page_id}/messages`, `GET {psid}?fields=first_name,last_name`, `GET {page_id}?fields=id,name`. |
| Webhook | `/api/webhooks/wa/[webhookToken]`: capa 1 = token secreto en la URL (`META_WEBHOOK_VERIFY_TOKEN`); capa 2 = `x-hub-signature-256` con `META_APP_SECRET` **solo si está configurado** (HMAC + `timingSafeEqual`). Campos: `messages`, estados, echoes (`smb_message_echoes`), `message_template_status_update`. |
| Guardado del token | `meta_credentials.token_cipher/iv/tag` con **AES-256-GCM** (`src/lib/crypto`, IV aleatorio de 12 bytes, clave `ENCRYPTION_KEY` de 32 bytes). Se descifra solo en servidor; la UI muestra los últimos 4. `status` pasa a `reconnect_required` ante error de auth. |
| Permisos de Meta requeridos | `whatsapp_business_messaging` y `whatsapp_business_management` (README, modo directo con usuario del sistema). Modo agencia/Tech Provider: el Embedded Signup vive **fuera** de este repo; la instancia solo recibe el token. CAPI requiere un token con acceso al dataset (**⚠️ NO VERIFICADO**: el permiso exacto no está documentado en el código). |
| Throttling existente | **Campañas**: `CAMPAIGN_SEND_RATE` (default 10 msg/s, tope 80), backoff 5 s→120 s ante códigos 4/80007/130429, alto total ante 131048 (calidad) y errores de plantilla 1320xx. **Entrada**: rate-limit in-process por IP en login/registro (10/10 min), en `/api/bot/*` (y por intentos fallidos) y 30/min por usuario en `writing-assist`. No hay límite de salida para el envío 1 a 1 ni para el agente. |
| Métricas de la API oficial | **No existen.** No se llama a `{waba_id}?fields=analytics`/`conversation_analytics`/`pricing_analytics`, a `template_analytics`, ni se lee `quality_rating`, `messaging_limit_tier`, `throughput` o `name_status` del número. Tampoco se procesan los webhooks `phone_number_quality_update`, `account_update` o `message_template_quality_update`. Resultados calcula todo con datos propios. |

### Qué falta para un módulo de métricas de Meta

1. Pedir y guardar `quality_rating`, `messaging_limit_tier`, `throughput.level`,
   `status` y `name_status` del número (`GET {phone_number_id}?fields=…`).
2. `GET {waba_id}?fields=conversation_analytics.start(..).end(..).granularity(DAILY)…`
   (o `pricing_analytics` en la versión actual) para conversaciones/costo por
   categoría; `template_analytics` para envíos/entregas/lecturas/clics por
   plantilla (requiere habilitarlo en la WABA).
3. Suscribir y procesar `phone_number_quality_update`,
   `message_template_quality_update`, `account_update` en `webhook.ts`.
4. Caché/snapshots en tabla propia (`meta_metric_snapshot`, con
   `organization_id`), porque las APIs de analítica son lentas y con límite.
5. Permiso nuevo (p. ej. `meta_metrics.read`) solo en `owner` + filas en
   `PROTEGIDAS`. Ver §11.

---

## 7. Variables de entorno

Validación central en `src/lib/env.ts` (Zod, lazy; en `next build` acepta
placeholders; los strings vacíos cuentan como ausentes). Algunas se leen
directo con `process.env` y **no** pasan por el esquema (marcadas †).

### Obligatorias

| Variable | Nota |
|---|---|
| `APP_BASE_URL` | URL pública (https). |
| `DATABASE_URL` | Postgres. |
| `BETTER_AUTH_SECRET` | ≥16 caracteres. |
| `ENCRYPTION_KEY` | 32 bytes en base64 (`openssl rand -base64 32`). **Perderla = perder todos los tokens cifrados.** |
| `META_WEBHOOK_VERIFY_TOKEN` | ≥8; es segmento secreto de la URL del webhook. |

Solo del despliegue (compose/Caddy, no las lee la app): `DOMAIN`,
`POSTGRES_PASSWORD`, `VOCERO_CRM_VERSION`.

### Opcionales

| Variable | Default / nota |
|---|---|
| `META_APP_SECRET` | Activa la verificación de firma del webhook. **Recomendada en producción.** |
| `META_GRAPH_API_VERSION` | `v25.0` |
| `META_GRAPH_BASE_URL` | `https://graph.facebook.com` (en pruebas → wa-mock) |
| `OPENROUTER_API_TOKEN` | Sin él: no hay agente, Laboratorio ni asistente de redacción. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api` |
| `OPENROUTER_MODEL`, `OPENROUTER_JUDGE_MODEL` | Modelo del agente y del juez. |
| `AGENT_COALESCE_MS` | `6000` |
| `BOT_API_KEY` | Sin ella `/api/bot/*` responde 401. |
| `BRAIN_HEALTH_URL` | Diagnóstico del cerebro externo (no se valida como URL a propósito). |
| `ALLOW_SIGNUP` | Registro público tras la primera organización. |
| `MEDIA_DIR` | `./.dev-media` (en Docker, volumen). |
| `ZOOM_BASE_URL`, `ZOOM_OAUTH_BASE_URL`, `GOOGLE_CAL_BASE_URL`, `GOOGLE_OAUTH_BASE_URL` | Solo se cambian para mocks. |
| `ZERNIO_BASE_URL` †, `IG_GRAPH_BASE_URL` † | Transporte de canales opcionales / mocks. |
| `CAMPAIGN_BACKOFF_SCALE` † | Acorta los backoffs en pruebas. |
| `SOURCE_COMMIT` † | Commit horneado en la imagen (`/api/health`). |
| `WA_MOCK_ENABLED` | Mocks de desarrollo; ignorado si `NODE_ENV=production`. |
| `NODE_ENV`, `PORT`, `MIGRATIONS_DIR` † | Runtime. |

### Banderas de módulos (todas apagadas por defecto)

| Bandera | Enciende | Valores |
|---|---|---|
| `CHANNELS` | Instagram/Messenger (`whatsapp,instagram,messenger`) | lista separada por comas |
| `AGENDA` | Motor de agenda y conectores | `on|1|true|si|sí|yes` |
| `ATRIBUCION` | Guardar `ctwa_clid`, CAPI, Ajustes → Anuncios | ídem |
| `CAMPAIGNS` 🆕 | Pantalla y rutas de Campañas | ídem |
| `CAMPAIGN_SEND_RATE` 🆕 | Ritmo de campañas | número, default 10, máx 80 |

Solo para scripts de E2E/capturas: `PW_CHROMIUM`, `PLAYWRIGHT_CHROMIUM`,
`SHOTS_DIR`, `CAPTURAS_DIR`, `CAPTURA`, `SCREENSHOTS_EMAIL`,
`SCREENSHOTS_PASSWORD`, `NEW_PASSWORD` (reset de contraseña).

---

## 8. Calidad

| Tipo | Cantidad | Cómo correr |
|---|---|---|
| Unit (Vitest) | **83 archivos**, ~**773** casos `it/test` (conteo por grep; `it.each` multiplica los casos reales) | `pnpm test` |
| E2E automatizados (Playwright + mocks) | **23 scripts** `scripts/e2e-*.mjs`; 10 con atajo en `package.json` (`test:e2e`, `:calendario`, `:resultados`, `:roles`, `:campanas`, `:panel`, `:linea`, `:redaccion`, `:conocimientos`, `:compositor`); el resto con `node --env-file=.env scripts/<archivo>` | Requiere app viva + `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock |
| Guiones E2E en prosa | **24** `tests/e2e/*.md` | Manual / guía |
| Gate técnico | — | `pnpm typecheck && pnpm lint && pnpm build && pnpm test` |

**CI** (`.github/workflows/ci.yml`): en cada PR y push a `main`, matriz
`default` (sin banderas) y `completo` (`CHANNELS=whatsapp,instagram,messenger`,
`AGENDA=on`), con typecheck, lint, test y build. `imagen.yml` construye la
imagen Docker en cada PR/push y la publica en GHCR solo con tags `v*`.
**Último estado en `main`: ✅ verde (CI #29 e Imagen #29 sobre `37d7cbe`).**

- **⚠️ NO VERIFICADO localmente**: no hay `node_modules` en este
  contenedor e instalar escribe en disco, así que **no** se corrió
  `pnpm typecheck` ni los tests aquí; el dato de verde es el de GitHub Actions.
- **⚠️ NO VERIFICADO**: los E2E no corren en CI; su último resultado verde
  solo consta en los mensajes de commit de cada PR.

---

## 9. Hallazgos y riesgos

Severidad: 🔴 alta · 🟠 media · 🟡 baja · ⚪ informativo.

| # | Sev. | Hallazgo | Detalle y recomendación |
|---|---|---|---|
| H1 | 🔴 | **Dependencias con vulnerabilidades conocidas** | `pnpm audit --prod` (sobre el lockfile): **26 avisos — 3 críticos, 11 altos, 12 moderados.** Relevantes en runtime: **`next@15.5.20`** (críticos: RCE en Image Optimization y RCE en servidores Windows; altos: SSRF en Server Actions y rewrites, DoS) → subir a **≥15.5.24**; **`drizzle-orm@0.38.4`** (alto: inyección SQL por identificadores mal escapados) → **≥0.45.2** (salto de versión: revisar cambios de API y `drizzle-kit`); `nanoid` (alto, generadores custom) y `postcss`. Solo de desarrollo: `vitest@2.1.9` (crítico con la UI de Vitest), `vite`, `esbuild`, `sharp` (lo trae Next). La app no usa `next/image` (lo evita a propósito), pero el endpoint `/_next/image` sigue activo por defecto al no haber `images.unoptimized` en `next.config.ts`, así que el aviso de Image Optimization aplica igual. |
| H2 | 🔴 | **La Ruta B instala la imagen del upstream, no la del fork** | `docker-compose.yml` usa `ghcr.io/kevinrivm/vocero-crm:${VOCERO_CRM_VERSION:-1.4.0}`. Esa imagen **no trae** 020–024 ni las migraciones 0015–0019. Quien despliegue este repo con `docker compose up` sin `--build` corre Vocero original. `imagen.yml` sí publicaría en `ghcr.io/ramirezmontielfernando7/ramirez-crm`, pero **el fork no tiene ningún tag** (`git ls-remote --tags origin` vacío), así que nunca se ha publicado su imagen. Recomendación: cambiar `image:` a la del fork y publicar un tag (p. ej. `v1.5.0`). |
| H3 | 🟠 | **Firma del webhook opcional** | Sin `META_APP_SECRET` la única defensa es el token en la URL. Recomendación: hacerlo obligatorio en producción o avisar en Ajustes. |
| H4 | 🟠 | **`.f.mjs` en la raíz** | Script suelto de depuración (1,5 KB) que llegó en el PR #9: abre Chromium, carga un `.webm` y hace una hoja de fotogramas para revisar una animación (`${SP}/video/hoja.png`, ruta fija `/opt/pw-browsers/chromium`). No lo usa nada. No tiene secretos. Recomendación: borrarlo o moverlo a `scripts/` con nombre descriptivo. |
| H5 | 🟠 | **Versión y CHANGELOG desfasados** | `package.json` dice 1.4.0 y la 1.4.0 del CHANGELOG sigue con fecha `2026-09-XX`. "Sin publicar" solo menciona 020 y 021; **faltan 022, 023, 024** y la marca Dashfort. |
| H6 | 🟠 | **README contradice el código** | (a) Cumplimiento #4: *"Sin spam ni broadcast: Vocero no incluye envíos masivos"* — **falso**: existe el módulo de Campañas (bandera `CAMPAIGNS`). (b) Roadmap: *"Broadcast con opt-in verificado"* — ya implementado. (c) README y título siguen como "Vocero CRM" mientras la app se presenta como "Dashfort by Demfort". (d) "Multi-usuario" no describe los tres roles ni la asignación. (e) Faltan Conocimientos, asistente de redacción, etiquetas/CSV y línea de tiempo en Features. |
| H7 | 🟡 | **CLAUDE.md contradice el código** | (a) Dice que las fuentes son "Archivo + Instrument Serif + IBM Plex Mono": desde el PR #12 la letra de interfaz es la del sistema. (b) Cita `memory/` y `memory/MEMORY.md`: **ese directorio no existe**. (c) `tenant.ts` cita `tests/unit/scoped-contacts-guard.test.ts`, que no existe (la vigilancia vive en `assignment-guard/scope/visibility.test.ts`). |
| H8 | 🟡 | **CI no prueba `CAMPAIGNS` ni `ATRIBUCION` encendidas** | La matriz `completo` solo pone `CHANNELS` y `AGENDA`. La constitución pide CI "apagado y encendido" para cada módulo opcional. |
| H9 | 🟡 | **Esquema sin uso** | `sales_team`, `member.sales_team_id` y `assignment_settings` (round-robin) existen pero ningún código los usa. Documentado como "reservado"; no es un bug, pero es deuda. |
| H10 | 🟡 | **`.catch` silenciosos** | Servidor: ~12, todos de limpieza (cancelar streams, borrar un archivo temporal, `clearOffers`, descarga de media en segundo plano que se reintenta bajo demanda) o de parseo (`formData()`), con comentario; aceptables. Cliente: **82** `.catch(() => null)` en 28 componentes (agente, pipeline, laboratorio, equipo, wizard de WhatsApp, contactos…). La mayoría revisa `res` después, pero el propio `src/lib/fetch-json.ts` (021) dice que ese patrón "dejaba al usuario sin saber que su cambio no se guardó"; solo 12 archivos migraron a `fetchJson`. Recomendación: migrar el resto por pantallas. |
| H11 | ⚪ | **TODO / FIXME** | **Cero** marcadores reales: todas las coincidencias de "TODO" son la palabra "todo" en mayúsculas en comentarios o mensajes ("TODO VERDE"). |
| H12 | ⚪ | **`.mcp.json` commiteado** | Contiene `{"mcpServers": {}}`: sin secretos ni URLs internas. `.mcp.json.example` usa `${GITHUB_TOKEN}` (variable, no valor). Correcto. |
| H13 | ⚪ | **Secretos en código e historial** | Búsqueda en el árbol y en **todo** el historial (`git log --all -p -G`) de patrones de OpenRouter (`sk-or-v1-`), Meta (`EAA…`), GitHub (`ghp_`, `github_pat_`), AWS, Slack, Google API y llaves privadas: **ninguno real** (dos falsos positivos: PNG de 1×1 en base64 en scripts E2E). Nunca se commiteó un `.env`, solo `.env.example` con placeholders `REEMPLAZA_…`. Hay una contraseña fija `password-e2e-123` en los scripts E2E: solo de pruebas locales. ⚠️ No se usó un escáner dedicado (gitleaks/trufflehog). |
| H14 | ⚪ | **URLs internas** | Ninguna encontrada (sin IPs privadas ni hosts `.internal`/`.local` fuera de tests de rate-limit). |
| H15 | ⚪ | **Bus SSE y ejecutores in-process** | Correcto con una réplica. Si alguna vez se escalan a 2+ réplicas, SSE, rate-limit, campañas y Laboratorio dejan de ser coherentes. Es una decisión de la constitución, no un bug. |

---

## 10. Convenciones para futuras sesiones

**Migraciones**
- Nombre `NNNN_descripcion_en_espanol_con_guiones_bajos.sql`, consecutivo
  (la siguiente es **`0020_…`**). Generar con `pnpm db:generate` tras editar
  `schema.ts` y renombrar el archivo + `tag` del journal.
- **Aditivas y re-ejecutables**: `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, defaults que no cambien el significado de filas
  existentes. Se aplican al arrancar el contenedor (`scripts/migrate.mjs`).
- Toda tabla de dominio: `organization_id NOT NULL` + cascada + índice org-first.
  Timestamps sin zona (UTC). Enums como `text({ enum })`.
- Comentario JSDoc en `schema.ts` con el número de spec (`020 —`, `024 —`).

**Rutas API**
- `src/app/api/<recurso>/route.ts`, subrecursos por carpeta (`[id]`,
  `[id]/tags`). Exportar `export const GET = withAuth(handler, { permission })`.
- **Toda ruta nueva va en una de las listas de
  `tests/unit/permissions-routes.test.ts`** o el CI falla.
- Validar el cuerpo con Zod; errores con `apiError(status, code, message)`
  (contrato `api.md`).
- Datos de clientes → `scopedContacts` / `scopedConversations` /
  `scopedMediaAssets`; nunca `scoped()` a secas en rutas de usuario.
- Módulo opcional → bandera en `src/server/<modulo>/flag.ts` con
  `parse*Flag` + `*DisabledResponse()` (404).

**Servidor**
- Lógica en `src/server/<área>/`; una "única puerta" por tabla de bitácora
  (`stage-history.ts`, `assign.ts`, `activity/log.ts`, `knowledge/store.ts`)
  con test de vigilancia.
- Publicar en el bus SSE **después** del commit. Tipos nuevos: agregar al
  `SseEvent` y a `canSeeEvent` (si no, el asesor no lo recibe: falla cerrado).
- Llamadas a Meta solo por `graphRequest`. Secretos siempre con
  `encryptSecret`/`decryptSecret`.

**UI**
- Componentes en `src/components/<área>/`, páginas en `src/app/(app)/<área>`.
- Fetch con `fetchJson` (no `fetch(...).catch(() => null)`).
- Permisos en UI con `useViewer()`; solo esconde, no protege.
- Colores por tokens de `globals.css`; movimiento con `src/components/motion.tsx`
  (≤300 ms, solo `transform`/`opacity`).

**Evitar**
- `session.role === "owner"` suelto; escribir `contact.assigned_user_id` o
  `lead.stage_id` fuera de su puerta; "arreglar" el guard de sandbox del
  Laboratorio; meter S3/email/billing en el núcleo; migraciones destructivas;
  confiar en que el E2E corre en CI (no corre).

**Proceso**
- SDD: `specs/NNN-nombre/` con `spec.md` / `plan.md` / `tasks.md`; la
  siguiente spec es **025**. Guion `tests/e2e/us-*.md` + script
  `scripts/e2e-*.mjs` + atajo en `package.json`.

---

## 11. Consideraciones para lo que viene

### Chat interno de equipo (Bloque C)

- **Punto de integración ya preparado**: `KnowledgeTarget` en
  `src/server/knowledge/deliver.ts` (hoy solo `whatsapp_conversation`) y
  `KnowledgePicker`, independiente del canal. Agregar
  `{ kind: "internal_chat"; threadId }` y su rama.
- Tablas nuevas (migración `0020`): `team_thread` (1:1, grupo, o hilo ligado
  a un `contact_id` para "hablar sobre este cliente"), `team_thread_member`,
  `team_message` (con `media_asset_id` opcional y `mentions`). Todas con
  `organization_id`.
- **Visibilidad**: un hilo ligado a un contacto debe respetar
  `scopedContacts` (un asesor no debe ver el hilo de un cliente ajeno). Los
  hilos libres se filtran por membresía, no por `scope.all`.
- **SSE**: nuevo `team.message` en `SseEvent` y su caso en `canSeeEvent`
  (hoy caería en `default → false`). Cuidar el costo: una consulta por evento
  por asesor conectado.
- Permisos: probablemente ninguno nuevo para usar el chat; quizá
  `team_chat.manage` para crear canales de grupo. Rutas en `FILTRADAS` o
  `DEL_NEGOCIO` según el caso.
- No tocar el guard de sandbox: los mensajes internos nunca salen a Meta.

### Módulo de métricas de Meta (solo Propietario)

- Nuevo permiso `meta_metrics.read` **solo en `owner`** (no reutilizar
  `results.read`, que también tiene el Coordinador) + filas en `PROTEGIDAS`.
- Ver §6 "Qué falta": campos del número (calidad, límite de mensajería,
  throughput), analítica de conversaciones/precios y de plantillas,
  webhooks de calidad. Todo por `graphRequest` y con respuestas del wa-mock
  para el E2E.
- Guardar snapshots diarios (la analítica de Meta es lenta y limitada) y
  mostrar "actualizado hace X". Degradar sin romper si el token no tiene el
  alcance (`whatsapp_business_management` es necesario para la analítica de
  WABA; ⚠️ confirmar alcance exacto para `template_analytics`).
- Encaja como sección aparte de Resultados, no dentro (Resultados usa datos
  propios y es visible para el Coordinador).

### WhatsApp no oficial (opt-in)

- **Choca con la constitución**: principio II dice que el núcleo depende solo
  de WhatsApp Cloud API; el README promete cumplimiento con Meta. Debe entrar
  como **conector opcional ADR-001**: bandera apagada por defecto (p. ej.
  `CHANNELS=…,whatsapp_web`), adaptador aislado con contrato, degradación
  definida y CI apagado/encendido. Conviene escribir un ADR-003 y enmendar la
  constitución antes de codificar.
- Técnicamente: un canal nuevo en `conversation.channel` / `contact.channel`
  (hoy el enum es `whatsapp|instagram|messenger`; agregar valor es aditivo),
  credenciales/sesión cifradas en tabla propia, y un proceso de sesión
  persistente (las librerías tipo Baileys/whatsapp-web.js mantienen un
  socket), lo que rompe el supuesto de "sin procesos externos". Probable
  sidecar opcional con su propia API, igual que el cerebro externo.
- Riesgos: baneo del número, sin plantillas ni ventana de 24 h (las reglas de
  `window.ts` y campañas `opt_in` no aplican igual), incompatible con el rol
  de **Tech Provider** de Meta si se ofrece al mismo cliente; aviso legal y
  consentimiento explícito del Propietario en la UI.
- Mantener **separado** de la identidad `wa_identity` de Cloud API para no
  mezclar contactos (el canal ya forma parte de la llave única).
