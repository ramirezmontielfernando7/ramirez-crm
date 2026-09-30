# Diagnóstico multitenant de Vocero (solo lectura)

- Fecha: 2026-09-30 · Base: `main` en `f300202` (merge del PR #19).
- Alcance: pasar de "una instancia por cliente" a ~100 organizaciones en una
  sola instancia (16 GB / 8 núcleos), con aislamiento blindado y conexión de
  WhatsApp por Embedded Signup (Tech Provider).
- Método: lectura del código real (se cita `archivo:línea`), `pnpm install` y
  `pnpm test` locales, y consulta de la documentación oficial de Meta. No se
  cambió código ni base de datos.

> **Limitación con Meta:** desde este entorno el proxy de salida bloquea
> `developers.facebook.com`, así que no pude abrir las páginas completas. Lo
> que se afirma de Meta sale de los extractos que el buscador devolvió de las
> páginas **oficiales** citadas (no de memoria). Antes de implementar hay que
> releer esas páginas completas; ver "Lo que no pude verificar".

---

## 1. Resumen ejecutivo

1. **Veredicto: la base es buena, pero hoy NO está lista para multitenant.** Diría que está al 60 %: el modelo de datos ya es multi-organización y la puerta de consultas (`scoped()`/`scopedContacts()`) está bien usada en las rutas de usuario, pero varios supuestos de "una sola organización" están fijos en el código.
2. Las **49 tablas** de `schema.ts` están bien clasificadas: las 42 de dominio tienen `organization_id NOT NULL` con FK, y las 7 sin él son de plataforma/auth (correcto).
3. No encontré ninguna ruta de usuario que lea datos de otra organización por id: las rutas `[id]` filtran por organización y responden 404 a ids ajenos.
4. **Riesgo 1 — superficies "instancia única":** la API del cerebro externo (`/api/bot/*`) opera sobre "la primera organización" (`resolveInstanceOrg`, `src/server/bot/auth.ts:80`). El login muestra la marca de "la primera organización" (`src/server/branding.ts:40`). Y cargar la demo **borra contactos de otras organizaciones** (`src/server/seed/demo.ts:143`).
5. **Riesgo 2 — alta de organizaciones sin control:** el plugin de organización de better-auth está expuesto completo en `/api/auth/*`. Cualquier usuario con sesión, incluso un Asesor, puede crear organizaciones (`/organization/create`, que por defecto está permitido). Un Propietario puede borrar su organización en cascada desde ese mismo plugin. Además, la app ignora la organización activa y toma "la primera membresía" sin orden (`src/server/auth/on-signup.ts:68-80`). No existe un administrador de plataforma.
6. **Riesgo 3 — no hay segunda línea de defensa:** la app se conecta a Postgres como el superusuario `postgres` (`docker-compose.yml`), así que RLS no aplicaría aunque se definiera. Las FK no obligan a que el hijo sea de la misma organización que el padre, y no hay ni un test que pruebe dos organizaciones intentando leerse entre sí.
7. Las credenciales de WhatsApp ya son **por organización y van cifradas** (AES-256-GCM, `meta_credentials`), y el webhook **ya enruta por `phone_number_id`** con un índice único. Es el mejor punto de partida para Embedded Signup.
8. Sigue siendo global: la IA (`OPENROUTER_*`), las banderas de módulos (`CAMPAIGNS`, `AGENDA`, `ATRIBUCION`, `CHANNELS`), la `BOT_API_KEY`, el token secreto del webhook y la llave de cifrado.
9. La escala de ~100 organizaciones es alcanzable en un solo proceso. Faltan: pool de BD más grande que 10 (`src/lib/db/index.ts:43`), concurrencia acotada para la IA y las campañas, ritmo de envío por número y no por campaña, e índices que empiecen por la organización en 4 tablas.
10. Hoy **sí se guardan** los estados `sent`/`delivered`/`read`/`failed` que manda Meta en `message.status`, pero sin marca de tiempo por estado, y `campaign_recipient` solo conoce `pending/sent/failed`.

---

## 2. Tabla de hallazgos

Esfuerzo: S ≤ 1 día · M 2-4 días · L 1-2 semanas · XL > 2 semanas.

| # | Área | Hallazgo | Evidencia | Severidad | Esfuerzo |
|---|---|---|---|---|---|
| H1 | Aislamiento | `seedDemo` borra los contactos (y sus conversaciones, mensajes y leads) **de cualquier organización** cuyo teléfono coincida con los de la demo. Se dispara con `POST /api/seed/demo` desde cualquier organización vacía. | `src/server/seed/demo.ts:140-161`; `src/app/api/seed/demo/route.ts:21` | Crítica | S |
| H2 | Webhooks / bot | La API `/api/bot/*` resuelve "la organización de la instancia" con `select … from organization limit 1` sin orden y la guarda en caché. Con varias organizaciones, el cerebro externo opera sobre una organización arbitraria. La `BOT_API_KEY` es global. | `src/server/bot/auth.ts:80-90`; se usa en las 10 rutas de `src/app/api/bot/*` | Crítica | M |
| H3 | Alta / sesiones | Los endpoints del plugin de organización están expuestos (`/api/auth/[...all]`). Por defecto `allowUserToCreateOrganization` es verdadero (better-auth 1.6.23, `crud-org.mjs:56`): **cualquier usuario con sesión crea organizaciones**. El Propietario (`ownerAc`) puede usar `/organization/delete` (borrado en cascada), `remove-member`, `update-member-role` e `invite-member`, saltándose la bitácora y las reglas de la app. | `src/lib/auth/index.ts:68`; `src/app/api/auth/[...all]/route.ts`; `src/lib/auth/permissions.ts:62-63` | Crítica | S |
| H4 | Sesiones | `resolveMembership` toma la **primera** membresía sin `ORDER BY` e ignora `session.activeOrganizationId`. Un usuario con dos membresías cae en una organización no determinista, y `set-active` no sirve de nada. | `src/server/auth/on-signup.ts:68-80`; `src/lib/auth/session.ts:58` | Alta | M |
| H5 | RLS / BD | La app se conecta como superusuario `postgres` (que se salta RLS) y el mismo rol ejecuta las migraciones. No hay ninguna política RLS. | `docker-compose.yml` (`DATABASE_URL: postgresql://postgres:…`); `scripts/migrate.mjs` | Alta | L |
| H6 | Integridad | Las FK hijo→padre son solo por `id` (p. ej. `message.conversation_id`, `campaign.template_id`, `campaign_recipient.contact_id`). La BD no impide que un hijo de la organización A apunte a un padre de B; el aislamiento depende de que cada escritura lo valide. | `src/lib/db/schema.ts:637-639`, `1350-1352`, `1398-1403` | Media | M |
| H7 | Secretos | `GET /api/settings/webhook` entrega a **cada Propietario** el `META_WEBHOOK_VERIFY_TOKEN` global, que es el segmento secreto de la URL. Sin `META_APP_SECRET`, la firma queda apagada (`isValidSignature` devuelve verdadero), y con esa URL un Propietario podría inyectar webhooks falsos para el número de otra organización. | `src/app/api/settings/webhook/route.ts:16-31`; `src/server/inbox/webhook.ts:36` | Alta (Crítica si falta `META_APP_SECRET`) | S |
| H8 | Webhooks | El `waba_id` no es único ni se valida contra el número. Al guardar a mano, una organización puede declarar el WABA de otra, y los eventos de plantillas (`getCredentialsByWabaId`, que toma el primero) podrían actualizar las plantillas de la organización equivocada. | `src/server/whatsapp/credentials.ts:51-61`; `src/app/api/settings/whatsapp/route.ts:27-51`; `src/server/whatsapp/templates.ts:243-249` | Media | S |
| H9 | Recursos | Los adjuntos de clientes se sirven `inline` con el `Content-Type` que declaró el remitente, sin `nosniff` ni `CSP: sandbox` (el chat de equipo sí los tiene). Un `text/html` o `svg` enviado por WhatsApp se ejecuta en el origen de la app con la sesión de quien lo abre. | `src/app/api/media/[assetId]/route.ts:61-72` vs `src/app/api/team-chat/attachments/[id]/route.ts:21-29`; `src/server/whatsapp/media.ts:48` (documentos: cualquier MIME) | Alta | S |
| H10 | Cabeceras | No hay cabeceras de seguridad globales (CSP, `X-Frame-Options`/`frame-ancestors`, HSTS, `Referrer-Policy`) ni en Next ni en Caddy. | `next.config.ts` (sin `headers()`); `Caddyfile` | Media | S |
| H11 | Marca | Sin sesión (en el login), la marca y el favicon son los de "la primera organización": filtra el nombre y el logo de un cliente a cualquiera. | `src/server/branding.ts:40-44` | Media | S (M si se resuelve por dominio) |
| H12 | Alta | El registro público se cierra tras la primera organización (`isPublicSignupAllowed`) y `onUserCreated` solo crea la organización si no existe ninguna. Con `ALLOW_SIGNUP=true` se crean usuarios **sin organización**, que se quedan en 401. No hay alta controlada ni rol de plataforma. | `src/server/auth/registration.ts:9-14`; `src/server/auth/on-signup.ts:22-31`; `slug: "principal"` fijo (`:37`) | Alta | M |
| H13 | Enumeración | El alta de miembros responde 409 "Ya existe una cuenta con ese correo" con correos de **cualquier** organización. El correo es único globalmente, así que un usuario no puede pertenecer a dos negocios con la misma cuenta. | `src/app/api/settings/team/route.ts:62-77`; `schema.ts:31` | Baja | S |
| H14 | Credenciales globales | La IA (`OPENROUTER_API_TOKEN`/`MODEL`/`JUDGE_MODEL`) es una sola llave para todas las organizaciones: sin cuota ni costo por organización. `BOT_API_KEY` y `BRAIN_HEALTH_URL` son globales. `ENCRYPTION_KEY` es una sola llave, sin versión ni rotación. | `src/lib/ai/index.ts:32-45,107`; `src/server/bot/auth.ts:26,67`; `src/lib/crypto/index.ts:17` | Media | M |
| H15 | Banderas | `CAMPAIGNS`, `AGENDA`, `ATRIBUCION` y `CHANNELS` son banderas de **despliegue** (variables de entorno), así que se encienden para todas las organizaciones o para ninguna. `CAMPAIGN_SEND_RATE` también es global. | `src/server/campaigns/flag.ts`; `src/server/agenda/flag.ts`; `src/server/attribution/flag.ts`; `src/server/channels/` | Media | M |
| H16 | Estado en memoria | Esto funciona en una sola réplica y por diseño no escala horizontalmente: el bus SSE (`EventEmitter` en proceso), el agrupamiento de turnos de la IA, los ejecutores de campañas, el rate limit, `botLastSeen` y el Laboratorio. `markBotSeen` es global ("quién responde" se mezcla entre organizaciones). Los tokens de Zoom y Google en caché están bien aislados (llave = hash de la credencial). | `src/server/events/bus.ts:108-120`; `src/server/ai/pipeline.ts:41-72`; `src/server/campaigns/runner.ts:47-66`; `src/lib/rate-limit.ts`; `src/server/bot/status.ts:40-50`; `src/server/agenda/connectors/zoom.ts:49-53` | Media | M |
| H17 | Escala | Pool de Postgres `max: 10` por proceso, compartido por la web, el SSE, los webhooks, la IA, las campañas y el Laboratorio de 100 organizaciones. | `src/lib/db/index.ts:41-45` | Alta | S |
| H18 | Escala | Turnos de IA sin límite global de concurrencia: una ráfaga de 100 organizaciones lanza N llamadas simultáneas al LLM y a la BD. | `src/server/ai/pipeline.ts:52-72` | Media | M |
| H19 | Campañas | El ritmo va **por campaña** (`1000 / campaignSendRate()`), no por número: dos campañas de la misma organización comparten número y duplican el ritmo. No hay tope global. El ritmo por defecto es de 10 mensajes/s con tope de 80, que coincide con el límite por número de Meta. | `src/server/campaigns/runner.ts:56-66,127`; `src/server/campaigns/flag.ts` | Media | M |
| H20 | Índices | Tablas sin índice que empiece por `organization_id` (clave para RLS y para consultas por organización): `offered_slot` (`conv_idx`), `agent_test_case` (`run_idx`), `campaign_recipient` (`campaign_*`), `team_chat_message`/`attachment` (`thread_*`). `campaign_status_idx` es global (`resumeCampaigns` recorre todas las organizaciones, lo cual está bien, pero es la única). | `schema.ts:1099`, `1183`, `1417-1421`, `1382`, bloque de `team_chat_*` | Baja | S |
| H21 | Plantillas | `syncTemplates` solo **actualiza** plantillas que ya existen en local: no importa las que ya tiene la WABA (clave en Embedded Signup), no pagina y solo maneja `BODY`. | `src/server/whatsapp/templates.ts:183-240`, `69-120` | Media | M |
| H22 | Estados | Se guardan `sent/delivered/read/failed` en `message.status` de forma monotónica, pero un `failed` tardío pisa un `delivered` (Meta documenta que ambos pueden llegar si hay varios dispositivos). No hay `delivered_at`/`read_at` ni se guarda `pricing`/`conversation` del webhook. `campaign_recipient.status` solo es `pending/sent/failed`. | `src/server/inbox/status.ts:8-20,48-60`; `schema.ts:1406` | Media | M |
| H23 | Pruebas | No hay ningún test de aislamiento entre organizaciones: `tenant.test.ts` solo verifica el contrato de `scoped()` y dice textualmente "una sola org por instancia". Los E2E corren con una organización. Sí existe un buen guardarraíl estático (`assignment-guard.test.ts`) para `scopedContacts`. | `tests/unit/tenant.test.ts:8-12`; `tests/unit/assignment-guard.test.ts` | Alta | M |
| H24 | Laboratorio | `cleanupOrphanRuns` marca como fallidas las corridas `running` de **todas** las organizaciones al arrancar. Es correcto con una réplica, pero incorrecto si algún día hay dos. | `src/instrumentation-node.ts:58-69` | Baja | S |
| H25 | Conexión manual | Al guardar se valida teléfono y token, pero **no** que el número pertenezca al `waba_id` declarado. `saveCredentials` con un `phone_number_id` que ya usa otra organización choca con el índice único y termina en un 500 genérico. | `src/app/api/settings/whatsapp/route.ts:38-51`; `src/server/whatsapp/connect.ts:15-39`; `schema.ts:751` | Media | S |
| H26 | Modelo | Una organización = un número (`meta_credentials_org_uq`). Hay que decidirlo antes de Embedded Signup, porque un cliente puede tener varios números en su WABA. | `schema.ts:749-751` | Media (decisión) | M |
| H27 | Logs | Los logs usan `describeError` (sin SQL ni parámetros), pero todos los logs son de un solo flujo, sin `organization_id`. No detecté teléfonos ni textos en los logs revisados, aunque no auditaré todos los `console.*`. | `src/lib/api.ts:57-60`; `src/lib/log-safe.ts` | Baja | S |

**Lo que está bien** (evidencia, para no rehacerlo):

- Las 42 tablas de dominio tienen `organization_id NOT NULL` con FK y borrado en cascada (script sobre `schema.ts`).
- `scoped()` lanza un error si la organización viene vacía (`src/lib/db/tenant.ts:31`).
- Las rutas `[id]` revisadas filtran por organización y responden **404** (no 403) a ids ajenos: `media/[assetId]:40`, `campaigns/[id]` vía `getCampaign`, y el chat de equipo vía `scoped(...)` en `threads.ts:81`/`messages.ts:486`.
- La membresía y el rol se releen de la BD en **cada** request (`session.ts:58`): quitar a alguien del negocio corta su acceso de inmediato.
- Los estados del webhook se buscan con `organization_id` + `wa_message_id` (`status.ts:40-46`).
- Los adjuntos van en `MEDIA_DIR/{organizationId}/{assetId}` (`media.ts:96-111`) y el id se valida con una regex (`media/[assetId]:22`).
- El SSE está separado por canal `org:{id}` y tiene filtros por rol y asignación (`bus.ts:119`, `api/events/route.ts:52-65`).

---

## 3. Detalle por área

### 3.1 Aislamiento de datos (todas las tablas)

**Sin `organization_id` (7): correcto, son de plataforma o de auth.**
`user`, `session` (lleva `active_organization_id`, sin FK), `account`, `verification`, `organization`. Además `member` e `invitation` sí llevan la organización. Ninguna tabla de dominio queda sin organización.

**Con `organization_id` + FK a `organization` (42):**
`member`, `sales_team`, `invitation`, `contact`, `contact_tag`, `contact_tag_assignment`, `pipeline_stage`, `lead`, `lead_stage_event`, `contact_assignment_event`, `contact_participant`, `contact_participant_event`, `assignment_settings`, `conversation`, `message`, `media_asset`, `meta_credentials`, `instagram_credentials`, `messenger_credentials`, `agent_profile`, `kb_entry`, `knowledge_entry`, `template`, `agent_test_run`, `calendar_settings`, `booking`, `offered_slot`, `zoom_credentials`, `google_credentials`, `agent_test_case`, `ad_attribution`, `conversion_event`, `capi_settings`, `campaign`, `campaign_recipient`, `contact_activity_event`, `user_preference`, `team_chat_thread`, `team_chat_member`, `team_chat_attachment`, `team_chat_message`, `team_chat_reaction`, `team_chat_read_state`, `team_chat_settings`.

**Consultas que no pasan por `scoped()`.** Hay 239 `.where(` sin `scoped*` en `src/`. Los clasifiqué:

- **Por id interno ya resuelto dentro de la organización.** Es seguro hoy, pero depende de la disciplina. Ejemplos: `ai/pipeline.ts:105` (carga la conversación por id y *deriva* la organización de la fila), `inbox/send.ts:103` (compara la organización después de leer), `whatsapp/media.ts:207-241`, `lab/runner.ts`, `campaigns/runner.ts` y `agenda/service.ts`. Ninguno recibe el id directamente del usuario sin validarlo antes.
- **Resolución global legítima:** el webhook (`credentials.ts:45,58`, `instagram/credentials.ts:64,76`) y el arranque (`resumeCampaigns`, `cleanupOrphanRuns`).
- **Huecos reales:** H1 (`seed/demo.ts:143-160`), H2 (`bot/auth.ts:85`), H11 (`branding.ts:43`), H4 (`on-signup.ts:78`) y H8 (`credentials.ts:58`).
- `participants.ts:64` lee nombres de `user` por id sin organización, pero los ids salen de filas que sí la filtran. Lo marco como **aceptable**.

### 3.2 Row Level Security: viabilidad y diseño

Es viable con este stack. Propuesta:

1. **Roles de BD.**
   - `vocero_owner`: dueño del esquema, solo para migraciones.
   - `vocero_app`: `NOLOGIN` → `LOGIN`, **sin** `BYPASSRLS` ni superusuario, con `GRANT SELECT/INSERT/UPDATE/DELETE`.
   - `vocero_system`: con `BYPASSRLS`, solo para el ruteo de webhooks, el arranque y el administrador de plataforma, con su propio pool pequeño.

   Hoy todo corre como `postgres` (H5). Además hace falta `ALTER TABLE … FORCE ROW LEVEL SECURITY` en las 42 tablas, para que ni el dueño se salte las políticas.
2. **Política única por tabla:**
   ```sql
   ALTER TABLE contact ENABLE ROW LEVEL SECURITY;
   ALTER TABLE contact FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON contact
     USING (organization_id = current_setting('app.org_id', true))
     WITH CHECK (organization_id = current_setting('app.org_id', true));
   ```
   Con `current_setting(..., true)` se obtiene NULL si no se fijó la variable: **cero filas en vez de error**, así que un olvido falla cerrado.
3. **Variable por transacción.** Un helper `withTenant(orgId, fn)` que hace `db.transaction(async tx => { await tx.execute(sql\`select set_config('app.org_id', ${orgId}, true)\`); return fn(tx); })`. El `true` equivale a `SET LOCAL`: muere con la transacción, así que es seguro con el pool de `postgres-js` y también con PgBouncer en modo *transaction*. Para no pasar `tx` por 200 funciones, conviene un `AsyncLocalStorage` que `getDb()` consulte: si hay un `tx` de tenant activo, lo devuelve. `withAuth` (`src/lib/api.ts:37`) es el punto único para abrirlo en las rutas.
4. **Drizzle.** Drizzle 0.45 tiene `pgPolicy`/`pgRole` en el esquema y `drizzle-kit` genera las políticas. También sirve una migración SQL escrita a mano; propongo la manual para controlar `FORCE`.
5. **Lo que se rompería** (hay que migrarlo al rol `system` o a `withTenant` explícito):
   - El ruteo del webhook: busca por `phone_number_id` antes de conocer la organización.
   - `resumeCampaigns` y `cleanupOrphanRuns`.
   - better-auth (tablas `member`/`invitation`): no deben llevar RLS, o hay que darle a better-auth su propio pool `system`.
   - `resolveMembership`.
   - Los turnos de IA y el Laboratorio: corren fuera de una request (`after()`, `setTimeout`) y tienen que abrir su propio `withTenant(orgId)`.
   - Los seeds y los scripts E2E, que hoy escriben como superusuario.
   - Las subconsultas de `tenant.ts` (`contact_participant`, etc.) sí siguen funcionando: RLS se aplica también dentro de subconsultas.
6. **Costo.** Cada request de API pasa a ser una transacción. Son unos microsegundos más; lo relevante es que **retiene una conexión durante toda la request**, así que el SSE nunca debe abrirla mientras la conexión siga abierta (solo por evento). Esto obliga a subir el pool (H17).
7. **Complemento: FK compuestas (H6).** Un `UNIQUE (organization_id, id)` en los padres y `FOREIGN KEY (organization_id, conversation_id) REFERENCES conversation (organization_id, id)` en los hijos. Eso hace imposible en la BD un hijo que cuelgue de otra organización. Se puede hacer tabla por tabla.

### 3.3 Credenciales de Meta y variables de entorno

**Cómo se guardan hoy.** La tabla es `meta_credentials` (`schema.ts:728-753`): `waba_id`, `phone_number_id`, `display_phone_number`, `verified_name`, `token_cipher/iv/tag` (AES-256-GCM con `ENCRYPTION_KEY`) y `status` (`connected|reconnect_required`). Son únicas por organización y por `phone_number_id`. Se guardan en `PUT /api/settings/whatsapp`: prueba el token contra `GET {phone}?fields=display_phone_number,verified_name`, lo cifra, hace upsert y llama a `subscribeAppToWaba`, que respeta un override de callback. La UI solo ve los últimos 4 caracteres del token (`route.ts:22`).

**Lugares que leen credenciales o secretos de variables de entorno:**

| Variable | Dónde | Por organización |
|---|---|---|
| `META_APP_SECRET` | `api/webhooks/wa/[webhookToken]/route.ts:51`, `ig/...:74`, `messenger/...:75`, `settings/webhook/route.ts:30`, `instrumentation-node.ts:46`, `dev/wa-mock-inbound.ts:20` | No (correcto: es de la app de Meta, y con Tech Provider hay **una sola app**) |
| `META_WEBHOOK_VERIFY_TOKEN` | rutas de webhook y `settings/webhook/route.ts:19-28` (se **expone** a cada Propietario, H7) | No (correcto que sea global, incorrecto exponerlo) |
| `META_GRAPH_BASE_URL` / `META_GRAPH_API_VERSION` | `lib/meta/client.ts:48`, `attribution/creativo.ts`, `instagram/send.ts`, `settings/instagram/route.ts` | No (correcto) |
| `OPENROUTER_API_TOKEN/MODEL/JUDGE_MODEL/BASE_URL` | `lib/ai/index.ts:32-45,107` (agente, Laboratorio, juez y asistente de redacción) | **No** (H14) |
| `BOT_API_KEY`, `BRAIN_HEALTH_URL` | `server/bot/auth.ts:26,67`, `api/agent/brain-status/route.ts:26` | **No** (H2) |
| `ENCRYPTION_KEY` | `lib/crypto/index.ts:17` | No (una sola llave, sin versión) |
| `ZERNIO_BASE_URL`, `IG_GRAPH_BASE_URL` | `zernio/index.ts`, `instagram/send.ts` | No (correcto: son URLs) |
| Tokens de CAPI | **No** están en variables de entorno: `capi_settings` va cifrada por organización (`schema.ts:1302-1330`) | Sí |
| Zoom / Google | `zoom_credentials` y `google_credentials` cifradas por organización | Sí |

**Función central propuesta** (`src/server/credentials/index.ts`, la única puerta):

```ts
type OrgWhatsApp = { wabaId; phoneNumberId; token; tokenKind: "manual"|"business_integration"; status; ... };
getOrgCredentials(orgId, "whatsapp" | "instagram" | "messenger" | "capi" | "zoom" | "google" | "ai")
  -> Promise<Result<T, "not_connected" | "reconnect_required" | "decrypt_failed">>
```

- Lee con `withTenant(orgId)`, descifra y devuelve un error **tipado** en vez de `null`.
- Para `"ai"`: si la organización tiene llave propia se usa esa; si no, la de la plataforma con cuota.
- Guarda un registro de auditoría (quién leyó, sin el secreto) y una versión de llave (`key_version`) para poder rotar `ENCRYPTION_KEY`.
- La resolución inversa (`phone_number_id` → organización, `waba_id` → organización) vive **aparte**, en `resolveOrgBy*`, y es la única que usa el rol `system`.

### 3.4 Webhooks

- **Ruta:** `/api/webhooks/wa/{META_WEBHOOK_VERIFY_TOKEN}` en dos capas. El segmento secreto se compara con `safeEqual` (si no coincide, 404). Después se verifica la firma `x-hub-signature-256` con `META_APP_SECRET` sobre el cuerpo crudo (si falla, 401), pero **solo si la variable existe**; si no, la capa se apaga (`webhook.ts:36`). La ruta responde 200 y procesa en `after()` (`route.ts:63-71`).
- **Ruteo:** `processMessagesValue` toma `value.metadata.phone_number_id` → `getCredentialsByPhoneNumberId` → `organizationId` (`ingest.ts:220-235`). Los ecos van igual (`:273-280`). Las plantillas van por `entry.id` = WABA → `getCredentialsByWabaId` (`template-events.ts`, `templates.ts:243-249`), que **no es único** (H8).
- **Número desconocido:** se registra un `console.warn` con el `phone_number_id` y el evento **se descarta** con 200 (`ingest.ts:224-233`). No se guarda nada, así que un mensaje que llegó justo antes de terminar la conexión se pierde. Propuesta: una tabla de plataforma `webhook_unrouted` con retención de 7 días, para poder reprocesar esos eventos cuando termine el alta.
- **Rutear por `phone_number_id`:** sí, y es lo correcto. Para Embedded Signup hay que sumar el ruteo de los eventos a nivel WABA (`account_update`, plantillas, calidad del número) por `waba_id` con un índice **único** (o `(waba_id, organization_id)` si se permiten varios números).
- **Multitenant:** con Tech Provider hay **una sola app de Meta**, así que un único `META_APP_SECRET` y una única URL de webhook sirven para todos. `META_APP_SECRET` debe volverse **obligatorio** (que el arranque falle sin él) y el token de la URL no debe mostrarse a los Propietarios (H7).

### 3.5 Alta de organizaciones y usuarios

- **Hoy:** el primer registro crea la organización con `slug: "principal"` fijo, siembra las 5 etapas y el perfil del agente (`on-signup.ts:22-58`), y cierra el registro (`registration.ts`). El Propietario crea cuentas de equipo con `runInternalSignup` (`settings/team/route.ts:62`).
- **Huecos:** H3 (el plugin crea y borra organizaciones sin control), H4 (una sola membresía efectiva), H12 (no hay alta controlada, y `ALLOW_SIGNUP` deja usuarios huérfanos) y el `slug` fijo (una segunda organización creada por la app chocaría con `UNIQUE`).
- **Qué hace falta:**
  1. `organization({ allowUserToCreateOrganization: false, disableOrganizationDeletion: true, ... })`, además de filtrar en `hooks.before` todas las rutas `/organization/*` que la app no use. Hay que decidir si se permite `set-active`.
  2. Un servicio `createOrganization({ name, ownerEmail })` que haga lo mismo que `onUserCreated` (etapas, perfil y, si aplica, anuncios del chat de equipo) con un slug único, y que envíe una invitación o una contraseña temporal al Propietario.
  3. Un **administrador de plataforma** separado: hoy **no existe** (los roles son `owner/coordinador/asesor`, `permissions.ts:62-102`). Propongo una tabla `platform_admin(user_id)`, o el plugin `admin` de better-auth, y una superficie propia `/platform/*` protegida por un permiso que **no** sea un rol de organización. Esa superficie abre sesión en `vocero_system` y deja auditoría (`platform_audit_log`). La opción de "entrar como" (impersonate) debe ser explícita, limitada en tiempo y registrada.
  4. Resolver la organización activa desde `session.activeOrganizationId`, validada contra `member`, con `ORDER BY created_at` como respaldo.

### 3.6 Recursos compartidos

- **Media:** están en `MEDIA_DIR/{org}/{asset}` (`media.ts:96-111`) y se sirven con sesión y `scopedMediaAssets`. Falta endurecer las cabeceras (H9). El logo y el favicon están en `MEDIA_DIR/{org}/favicon`, servidos por una ruta **pública** que hoy elige "la primera organización" sin sesión (H11). Recomiendo una cuota de disco por organización (medirla desde `media_asset.file_size`).
- **SSE:** `EventEmitter` con canal `org:{id}` y `setMaxListeners(200)` por organización (`bus.ts:108-120`); `canSeeEvent` consulta la BD por evento y por asesor. Hay aislamiento entre organizaciones y el contrato está documentado como "una instancia = un proceso". **Límite:** una sola réplica. Para más de una se necesitaría `LISTEN/NOTIFY` de Postgres (sin terceros, compatible con la constitución II).
- **Cachés en memoria:** rate limit (`lib/rate-limit.ts`), tokens de Zoom y Google (llave = hash de la credencial: seguro), estado del cerebro (`bot/status.ts`: global, H16) y `cachedOrgId` (H2).
- **Trabajos en segundo plano** (todos en proceso):
  - Agente: agrupamiento por conversación, sin tope global (H18).
  - Campañas: un ejecutor por campaña, reanudable (`runner.ts`).
  - Laboratorio: `lab/runner.ts`.
  - Descarga de creativos: `attribution/creativo.ts`.
  - Sincronización de plantillas: **no** es un trabajo, es manual (`POST /api/templates/sync`).

  No hay ninguno que recorra todas las organizaciones de forma periódica. Solo `resumeCampaigns` y `cleanupOrphanRuns`, al arrancar.

### 3.7 Integraciones: por organización o globales

| Integración | Estado | Evidencia |
|---|---|---|
| WhatsApp | Por organización (una por organización) | `meta_credentials` |
| Instagram / Messenger | Por organización, pero la bandera `CHANNELS` es global | `instagram_credentials`, `messenger_credentials`; `server/channels/` |
| Zoom / Google | Por organización y cifrado; bandera `AGENDA` global | `zoom_credentials`, `google_credentials`, `calendar_settings` |
| CAPI / atribución | Por organización y cifrado; bandera `ATRIBUCION` global | `capi_settings`, `ad_attribution`, `conversion_event` |
| Agente de IA | Perfil, KB y etapas por organización; **proveedor, llave y modelo globales** | `agent_profile`, `kb_entry`; `lib/ai/index.ts` |
| Asistente de redacción | Llave global | `server/writing-assist/` sobre `chatJson` |
| Conocimientos | Por organización | `knowledge_entry`; `server/knowledge/store.ts` |
| Cerebro externo | **Global** (H2) | `server/bot/auth.ts` |
| Campañas | Datos por organización; bandera y ritmo globales | `campaign*`; `campaigns/flag.ts` |

### 3.8 Escala para ~100 organizaciones

- **Pool:** `max: 10` (`db/index.ts:43`). Con RLS, cada request retiene una conexión. Recomiendo 30-40 en la app, 5 en `system` y `max_connections` de Postgres en 100-150 (16 GB alcanzan). PgBouncer (en modo transaction) es opcional y compatible con `set_config(..., true)`; con `postgres-js` y PgBouncer anterior a 1.21 hay que usar `prepare: false`.
- **Índices:** casi todo empieza por la organización (bien). Los que faltan están en H20. `message.wa_message_id` es `UNIQUE` global (`schema.ts:642`) y así debe seguir, porque el wamid es único en Meta. `media_asset_wa_media_idx` es global (aceptable).
- **Trabajos que recorren todas las organizaciones:** solo en el arranque (arriba). No hay cron.
- **Memoria:** no hay caché por organización que crezca de forma relevante. Los mapas en memoria crecen por conversación activa o por campaña, y se limpian. Estimo que 100 organizaciones caben en un proceso Node de 1-2 GB, pero **no lo medí** (no hay prueba de carga).
- **Límites de Meta que afectan a las colas** (fuentes al final):
  - 80 mensajes/s **por número** de forma predeterminada.
  - 1 mensaje cada 6 s al mismo usuario.
  - Límite de mensajería de 24 h **por portafolio** (250 destinatarios únicos al inicio). El campo `messaging_limit_tier` está deprecado en favor de `whatsapp_business_manager_messaging_limit`.

  Consecuencia: el ejecutor de campañas debe tener un **limitador por `phone_number_id`**, compartido entre campañas, y consultar el límite de 24 h antes de lanzar (hoy no lo hace). Con un número por organización y un número por portafolio, 100 organizaciones no compiten entre sí en Meta; solo compiten por CPU y BD.

### 3.9 Pruebas

- **Hay:** contrato de `scoped()` (`tenant.test.ts`), guardarraíl estático de `scopedContacts` (`assignment-guard.test.ts`), tabla de permisos por ruta (`permissions-routes.test.ts`), firma del webhook, sandbox del Laboratorio y estados monotónicos.
- **Resultado de `pnpm test` en este diagnóstico:** 94 archivos y 1142 pruebas en verde. Ninguna ejercita dos organizaciones.
- **Faltan:**
  1. Un **test de esquema** que recorra `schema.ts` y exija que toda tabla que no esté en la lista de plataforma tenga `organization_id NOT NULL`, un índice que empiece por la organización y (tras la fase 1) política RLS con `FORCE`. Complementado con una consulta a `pg_policies`/`pg_class.relforcerowsecurity` en CI contra Postgres real.
  2. Un **test de integración RLS**: con `vocero_app`, sin `app.org_id`, todo `SELECT` devuelve 0 filas; con A no se ve nada de B; un `INSERT` con `organization_id` de B falla.
  3. **E2E de dos organizaciones** (`scripts/e2e-selftest.mjs`): crear A y B, sembrar datos y, con la sesión de A, pedir cada ruta `[id]` con ids de B, esperando 404 y cuerpo sin datos. También: SSE de A sin eventos de B; webhook para el número de B que no aparece en A; `seed/demo` en B que no toca A (H1); `/api/auth/organization/create` que responde 403.
  4. Un **guardarraíl estático** contra `from(schema.organization)` sin `where` y contra `.limit(1)` sobre `member` sin `orderBy`.

### 3.10 Seguridad general del aislamiento

- **Cabeceras:** no hay (H10); el chat de equipo sí las pone en sus adjuntos.
- **Sesiones:** la organización se decide por la membresía en BD en cada request (bien). Una sesión *no puede* cambiar de organización de forma útil (`set-active` se ignora), pero el plugin sí deja crear organizaciones (H3/H4).
- **Enumeración de ids:** los ids son nanoid con prefijo (`src/lib/db/ids.ts`), no secuenciales. Las rutas responden 404 a ids ajenos (bien). El alta de miembros permite enumerar correos (H13).
- **404 vs 403:** es consistente: 404 para "no es tuyo o no existe", 403 para "existe en tu organización pero tu rol no puede" (`api.ts:16`).
- **Logs:** `describeError` evita volcar SQL y parámetros (`api.ts:57-60`). Los avisos del webhook incluyen `phone_number_id` (no es un dato del cliente). Faltan: `organization_id` en cada línea de log, para poder investigar incidentes por organización sin mezclar, y no registrar `err.message` crudo de Graph en `connect.ts:113,125` (puede incluir ids de WABA ajenos, lo cual es menor).

### 3.11 Embedded Signup (Tech Provider)

**Lo que exige Meta hoy** (según los extractos oficiales, ver fuentes):

- Hay que ser Tech Provider con **negocio verificado** y **acceso avanzado** a `whatsapp_business_messaging` y `whatsapp_business_management`, aprobados por App Review. "No podrás incorporar clientes hasta que tu app tenga acceso avanzado para cada permiso".
- **Front:** SDK de JS con `FB.login({ config_id, response_type: 'code', override_default_response_type: true, extras: { sessionInfoVersion: '3', ... } })`. El flujo devuelve a la ventana, como *message event*, `waba_id`, `phone_number_id` y `business_id`, y en el callback el **código** intercambiable. La configuración se crea a partir de la plantilla "WhatsApp Embedded Signup Configuration With 60 Expiration Token".
- **Servidor:**
  1. Intercambiar el código: `GET https://graph.facebook.com/v25.0/oauth/access_token?client_id=<APP_ID>&client_secret=<APP_SECRET>&code=<CODE>`. Da un **token de negocio** (*Business Integration System User access token*), acotado al cliente. "Si eres Tech Provider, usarás exclusivamente tokens de negocio".
  2. Suscribir la app a los webhooks de la WABA del cliente (`POST {WABA_ID}/subscribed_apps`; ya existe en `connect.ts:117-122`).
  3. Registrar el número: `POST {PHONE_NUMBER_ID}/register` con `{"messaging_product":"whatsapp","pin":"<6 dígitos>"}`. Límite: 10 intentos por número en 72 h.
  4. Suscribirse al campo de webhook `account_update`, que se dispara al completar el flujo.
  5. El cliente debe agregar un **método de pago** a su WABA (requisito para clientes de un Tech Provider).
- **Pruebas antes de la aprobación:** la app de tipo Business tiene **acceso estándar** automático, que sirve para probar con cuentas propias. Se puede completar el flujo con tu propia cuenta de Facebook (crea portafolios, WABAs y números reales de prueba) o con una **cuenta sandbox de prueba** que devuelve `waba_id`, `phone_number_id` y código igual que un cliente real, válida 30 días.
- **Campos de estado del número:** `display_phone_number`, `verified_name`, `quality_rating`, `code_verification_status`, `name_status`, `throughput` y `whatsapp_business_manager_messaging_limit` (`messaging_limit_tier` está deprecado). Hay que confirmar la lista exacta en la referencia del número.

**Qué se reutiliza:**

- `testConnection` (se amplía a más campos).
- `subscribeAppToWaba`, que ya respeta los overrides. Para Embedded Signup es la app propia, así que debe suscribir siempre y verificar con `GET subscribed_apps`.
- `saveCredentials` con cifrado.
- `syncTemplates` (hay que hacerlo **importador**, H21).
- `markReconnectRequired` y la detección `isAuthError` (`client.ts:33`).
- El asistente de configuración de Ajustes → WhatsApp (`components/settings/whatsapp-wizard.tsx`), que pasa a "Avanzado".

**Diseño propuesto: máquina de estados idempotente por paso.** Una tabla `whatsapp_connection_attempt`:

- `id`, `organization_id`, `status`, `waba_id`, `phone_number_id`, `business_id`.
- `steps` (jsonb: `{exchange, subscribe, register, fetch_info, sync_templates}` → `pending|ok|failed|skipped`, con `error_code`, `error_message` y `attempts`).
- `created_by`, marcas de tiempo.

Además, la columna `token_kind` en `meta_credentials`.

1. `POST /api/settings/whatsapp/embedded-signup { code, waba_id, phone_number_id, business_id }` (permiso `settings.manage`). Crea el intento y ejecuta los pasos en orden:
   - **exchange** (código → token). El código es de un solo uso: si falla aquí, el único reintento es volver a abrir Embedded Signup.
   - **validate**: `GET {phone}?fields=…` y comprobar que el `phone` pertenece a la `waba` con `GET {waba}/phone_numbers`. Esto cierra H25.
   - **save**: cifrado, con `status = 'connecting'` (nuevo estado) para que no se envíe nada mientras tanto.
   - **subscribe**.
   - **register**: solo si `code_verification_status`/estado lo exige. El PIN lo genera el servidor y se guarda cifrado; nunca se le pide al cliente.
   - **fetch_info**: nombre, número, `quality_rating`, límite.
   - **sync_templates**.
2. Cada paso es **idempotente** y guarda su resultado. La respuesta devuelve el mapa de pasos. La pantalla muestra "Conectado" solo si los pasos obligatorios (exchange, validate, save, subscribe, register) están en `ok`. Si falla un paso obligatorio, muestra "Falta: <paso> — <motivo>" con el botón "Reintentar este paso" (`POST …/attempts/{id}/steps/{step}/retry`). `fetch_info` y `sync_templates` son **no bloqueantes**: la conexión queda en "Conectado (con avisos)".
3. **Sin conexiones a medias:** el ruteo del webhook solo acepta credenciales en `connected`. Si `subscribe` o `register` fallan de forma definitiva, la fila queda en `connecting` (no enruta ni envía) y el intento conserva todo lo necesario para reintentar. "Cancelar" borra la fila e intenta `DELETE {waba}/subscribed_apps`.
4. **"Re-sincronizar"** vuelve a ejecutar `validate`, `subscribe` (verificación y reparación), `fetch_info` y `sync_templates` sobre la conexión existente. Si el token está vencido, marca `reconnect_required` y ofrece volver a abrir Embedded Signup.
5. **Webhook `account_update`:** hay que añadirlo a `processPayload` (`route.ts:74-89`) y enrutar por WABA. Sirve para confirmar el alta, detectar bajas o desvinculaciones y marcar `reconnect_required`.

**Qué se puede construir y probar YA, antes de la aprobación:**

- Toda la máquina de estados, las rutas, la UI (Conectado / Avanzado / Re-sincronizar) y el registro de fallos parciales, **contra el wa-mock** (`src/app/api/dev/wa-mock`): se extiende con `oauth/access_token`, `{waba}/phone_numbers`, `{phone}/register` y `subscribed_apps`, con modos de fallo por paso. Esto cumple la "Definición de Hecho reforzada" con E2E de punta a punta.
- El flujo real con la app en modo desarrollo y acceso estándar, usando **tu propio portafolio** o una **cuenta sandbox** de Meta. No sirve con negocios de terceros hasta la aprobación.
- Lo que **no** se puede hasta la aprobación: incorporar clientes reales ajenos y pedir los permisos avanzados en su nombre.

### 3.12 Campañas y métricas: qué dejar listo desde ya

- **Estados:** sí se guardan `sent`, `delivered`, `read` y `failed` en `message.status` (`status.ts:8-13,56-60`), buscados por organización y wamid, con avance monotónico. **Faltan:**
  - `sent_at`, `delivered_at`, `read_at`, `failed_at` y `error_code` numérico: sin ellos no hay KPIs de tiempo ni desglose de errores.
  - Guardar `pricing` (categoría y si se cobra) y `conversation` del webhook de estado, en columnas o en una tabla `message_status_event` de solo inserción.
  - Decidir qué hacer con `failed` después de `delivered` (H22).
- **`campaign_recipient`:** hay que ampliar `status` a `pending|sent|delivered|read|failed` o, mejor, **derivarlo** con un join a `message` por `message_id`, que ya existe (`schema.ts:1409`), para no duplicar la verdad. Además:
  - Índice `(organization_id, campaign_id, status)`.
  - Guardar el `wa_message_id` para conciliar.
  - Campos `email` y `variables` por destinatario.
- **Audiencias:** hoy el público es un filtro sobre `contact` (`contact-filter.ts`), **solo `opt_in`** (`campaigns/audience.ts`). Para "Audiencias" como entidad:
  - Tabla `audience` + `audience_member` con organización, o listas guardadas.
  - `contact` **no tiene `email`** (bloque `schema.ts:151-260`), así que la columna de correo exige una migración.
  - El importador solo acepta CSV (`contacts-io/validate.ts:28-38`: `nombre`, `telefono`/`numero`, `etiquetas`; no `correo`) y no hay dependencia para Excel en `package.json`. Hay que decidir la librería para `.xlsx` (Constitución II: debe ser una librería local, no un servicio).
  - `parseImportPhone` normaliza para México (`normalizeMx`, `validate.ts:100`): para otras ladas hace falta la lada por organización.
- **Plantillas:**
  - `createTemplate` solo manda `BODY` (`templates.ts:98-118`): faltan encabezado (texto o media), pie y botones.
  - `template` no guarda `components` (jsonb) ni `quality_score`.
  - `syncTemplates` no importa ni pagina (H21).
  - El evento de plantilla se enruta por WABA, que no es único (H8).
- **Métricas de Meta:**
  - `GET {WABA}?fields=template_analytics...` (enviados, entregados, leídos y clics por día, con hasta 90 días hacia atrás; lecturas y clics solo durante los 7 días posteriores al envío).
  - `pricing_analytics`.
  - Hay que "confirmar" las analíticas de plantillas en la WABA antes de usarlas.

  Conviene una tabla `meta_template_daily_stat(organization_id, template_id, date, sent, delivered, read, clicked, cost)`, llenada por un trabajo por organización (el primer trabajo periódico: tiene que respetar el tope de concurrencia de la fase 4).
- **Ejecución:** limitador por `phone_number_id` compartido entre campañas; comprobar el límite de 24 h del portafolio antes de lanzar; banderas por organización (H15).

---

## 4. Plan en fases

Orden recomendado: **0 → 1 → (2 ∥ 3) → 4**. Cada PR con migración nueva en `drizzle/`, aplicada al arrancar como hoy.

### Fase 0: parches previos (1-2 días, sin cambiar el diseño)

- **PR-0a:** `seedDemo` acotado a la organización (H1); cerrar el plugin: `allowUserToCreateOrganization: false`, `disableOrganizationDeletion: true` y bloqueo de `/organization/*` no usadas (H3); cabeceras de adjuntos iguales a las del chat de equipo (H9); `META_APP_SECRET` obligatorio en producción (H7). Sin migración.
- Se puede probar ya, y con los E2E actuales.

### Fase 1: aislamiento y RLS (2-3 semanas)

1. **PR-1a — Tests primero:** test de esquema (lista de tablas de plataforma, `organization_id`, índices), guardarraíles estáticos y E2E de dos organizaciones (con el alta hecha por script, porque la UI llega en la fase 3). Tienen que salir **rojos** donde hoy hay huecos. Sin migración.
2. **PR-1b — Organización activa y superficies "primera organización":** `resolveMembership` por `activeOrganizationId` (H4); marca por dominio o genérica en el login (H11); `BOT_API_KEY` por organización (tabla `bot_api_key` con hash y prefijo, H2); `/api/settings/webhook` sin el token secreto (H7). **Migración:** `bot_api_key`.
3. **PR-1c — Índices y FK compuestas:** los índices de H20; `UNIQUE (organization_id, id)` en los padres y FK compuestas en los hijos (H6). **Migración** (conviene en dos pasos: `CREATE INDEX CONCURRENTLY` y FK `NOT VALID` + `VALIDATE`).
4. **PR-1d — Roles de BD y `withTenant`:** roles `vocero_owner`/`vocero_app`/`vocero_system`, `DATABASE_URL` + `DATABASE_URL_SYSTEM`, helper `withTenant` con `AsyncLocalStorage` integrado en `withAuth`, en los trabajos (IA, Laboratorio, campañas) y en el webhook (resolución con `system` y luego `withTenant`). Todavía **sin** políticas: se verifica que todo pasa. **Migración:** roles y grants. Toca `docker-compose.yml`, `vocero-entrypoint.sh` y `.env.example`.
5. **PR-1e — Activar RLS:** `ENABLE` + `FORCE` + la política `tenant_isolation` en las 42 tablas, y el test de `pg_policies` en CI. **Migración.**

Todo esto se puede hacer **sin** Tech Provider. Paralelo posible: PR-1a con PR-1b; PR-1c con PR-1d.

### Fase 2: credenciales y webhooks por organización + Embedded Signup (2-3 semanas)

1. **PR-2a — Puerta única de credenciales** (`getOrgCredentials`) y `key_version` para rotar `ENCRYPTION_KEY`; llave de IA por organización opcional, con cuota y medición de uso (H14). **Migración:** columnas `key_version`, tabla `org_ai_settings`/`usage`.
2. **PR-2b — Webhook:** `account_update`, índice único por `waba_id` (o modelo de varios números, según la decisión 3), tabla `webhook_unrouted` y validación teléfono↔WABA en el guardado manual (H8, H25). **Migración.**
3. **PR-2c — Embedded Signup:** tabla `whatsapp_connection_attempt`, `token_kind`, estado `connecting`; rutas de alta, reintento por paso y re-sincronización; UI Conectado / Avanzado; wa-mock ampliado y E2E con fallos por paso. **Migración.**
4. **PR-2d — Plantillas:** importación y paginación de plantillas remotas, `components` jsonb (H21). **Migración.**

Antes de la aprobación: se puede **construir y probar todo** con el wa-mock y probar de verdad con tu propio portafolio o la cuenta sandbox de Meta. Solo la incorporación de clientes ajenos espera a la aprobación.

### Fase 3: alta de organizaciones y administrador de plataforma (1-2 semanas; en paralelo con la 2 una vez cerrada la 1)

- **PR-3a:** `platform_admin` (o el plugin `admin` de better-auth), superficie `/platform` (crear, suspender y listar organizaciones, con uso), `platform_audit_log`, servicio `createOrganization` con siembra y slug único, invitación al Propietario, estado `organization.status` (activa/suspendida) comprobado en `requireSession` y en el webhook. **Migración.**
- **PR-3b:** banderas de módulos **por organización** (`organization_feature(org, feature, enabled)`), donde la variable de entorno queda como techo de la plataforma (H15). **Migración.**
- Condiciona a la reventa: modela desde ya `organization.parent_id` (nulo = cliente directo) o una tabla `reseller`, **sin** construir la superficie de agencias. Así la reventa no exigirá reescribir los permisos.

### Fase 4: escala y colas (1-2 semanas)

- **PR-4a:** pool configurable (`DB_POOL_MAX`, 30-40), semáforo global de turnos de IA (p. ej. 16) con cola justa por organización (H17, H18).
- **PR-4b:** limitador de envío por `phone_number_id` compartido entre campañas; lectura del límite de mensajería antes de lanzar; `delivered_at`/`read_at`, `message_status_event`, `pricing` (H19, H22). **Migración.**
- **PR-4c:** logs estructurados con `organization_id`; métricas por organización (mensajes, tokens de IA, disco); prueba de carga con 100 organizaciones sintéticas en el arnés.
- **PR-4d (opcional):** SSE sobre `LISTEN/NOTIFY` si se quiere más de una réplica.

---

## 5. Decisiones que necesito de ti antes de empezar

1. **¿Un número por organización o varios?** Hoy es uno (`meta_credentials_org_uq`). Embedded Signup puede traer una WABA con varios números.
2. **IA:** ¿una llave de la plataforma con cuota por organización (tú pagas y revendes), llave propia de cada organización, o ambas?
3. **Módulos:** ¿se activan por organización (planes) o siguen iguales para todas?
4. **Infraestructura de BD:** ¿Postgres en el mismo servidor, con PgBouncer o sin él? ¿Aceptas que la app deje de usar el superusuario (cambia `docker-compose.yml`, Coolify y los respaldos)?
5. **Dominio:** ¿un solo dominio para todos (`app.tudominio`) o subdominio por organización? Afecta al login con marca (H11) y, más adelante, a la marca blanca para agencias.
6. **Usuarios en varias organizaciones:** ¿un mismo correo puede pertenecer a dos negocios (con selector de organización) o cada cuenta vale para un solo negocio? Hoy el correo es único global y la membresía efectiva es una.
7. **Borrado de organizaciones:** ¿solo el administrador de plataforma, con periodo de gracia y exportación? ¿Qué retención de datos y de media?
8. **Cerebro externo (Nea u otro):** ¿se mantiene como función por organización (llave por organización) o solo para tu propia organización?
9. **Cambio de llave `ENCRYPTION_KEY`:** ¿se rota al pasar a multitenant? Sin clientes en producción, es el momento barato.
10. **Excel:** ¿se acepta una dependencia local para `.xlsx`, o basta con CSV más una plantilla descargable?

---

## 6. Lo que no pude verificar

- **Documentación de Meta completa:** el proxy de este entorno bloquea `developers.facebook.com` (`EGRESS_BLOCKED`). Lo citado sale de los extractos del buscador sobre las páginas oficiales listadas abajo. Hay que releer completas, sobre todo:
  - La lista exacta de campos de `extras` (versión de sesión y `featureType`).
  - Si el token de negocio caduca o no (el extracto habla de una configuración "con token de 60 días de expiración").
  - El payload exacto de `account_update` (tipo de evento de alta).
  - La lista vigente de campos del número.
  - Si el registro es necesario cuando Embedded Signup ya verificó el número (el extracto dice que el flujo hace los pasos 1-3 y queda el paso 4, el registro).
- **Comportamiento real con dos organizaciones:** no levanté Postgres ni la app con dos organizaciones (la tarea era de solo lectura y sin tocar BD). Los hallazgos H1-H4 se deducen del código, no se reprodujeron.
- **better-auth:** verifiqué los defaults en la versión **instalada** (1.6.23; `package.json` pide `^1.1.14`) leyendo `node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs`. No probé cada endpoint del plugin en vivo.
- **Consumo de memoria y CPU por organización:** no hubo prueba de carga.
- **Auditoría exhaustiva de logs:** revisé los puntos centrales, no todos los `console.*`.
- **Producción y Coolify:** no los toqué, así que no sé qué rol de BD usa hoy el despliegue real. Asumí el de `docker-compose.yml`.
- **`pnpm test`:** el resultado está abajo. No corrí `typecheck`, `lint`, `build` ni E2E (no hubo cambios de código).

### Resultado de `pnpm test` (main `f300202`)

`Test Files 94 passed (94) · Tests 1142 passed (1142)`: todo en verde, pero ninguna prueba ejercita dos organizaciones.

---

## Fuentes (Meta, documentación oficial)

- Embedded Signup, visión general: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/
- Embedded Signup, implementación: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/
- Incorporar clientes como Tech Provider: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
- Guía de tokens de acceso: https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/
- Convertirse en Tech Provider: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- App Review: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- Registrar un número: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration
- Números de negocio: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
- Throughput: https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput
- Límites de mensajería: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- Webhook de estados: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
- Webhooks, visión general: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- Analíticas: https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics/
