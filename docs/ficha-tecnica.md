# Ficha técnica — Vocero CRM (fork `ramirez-crm`, marca Dashfort by Demfort)

> Documento de contexto para pegar en Claude web (u otro asistente). Resume
> QUÉ hace el CRM, CÓMO está construido y DÓNDE vive cada cosa. Estado del
> código: versión `1.4.0` en `package.json` + cambios sin publicar (propuesta
> `1.5.0`), migraciones `0000`–`0034`. Fecha de corte: 2026-10-06.

---

## 1. Qué es

CRM de WhatsApp **open source (MIT), self-hosted**, con:

- Bandeja de WhatsApp en tiempo real (y opcionalmente Instagram/Messenger).
- Pipeline kanban de ventas, contactos, etiquetas, consentimiento.
- **Agente de IA** configurable (proveedor OpenRouter-compatible) que responde,
  mueve leads, escala a humano y agenda citas.
- **Laboratorio**: 6 clientes simulados prueban al agente en sandbox y un juez
  LLM da score 0–100, hallazgos y sugerencias aplicables.
- Campañas masivas por plantilla, agenda, atribución de anuncios (CAPI),
  resultados, chat interno de equipo, conocimientos, asistente de redacción.
- **Multi-organización** (multi-tenant con RLS) con **administrador de
  plataforma** que da de alta negocios y enciende/apaga módulos por negocio.
- API para **cerebro externo** (`/api/bot/*`) si se quiere usar un bot propio.

Público objetivo: agencias de IA/automatización que despliegan una instancia
para sus clientes, y negocios que venden por WhatsApp sin ceder sus datos.

---

## 2. Stack y arquitectura

| Capa | Tecnología |
|---|---|
| App | Next.js 15 (App Router) + React 19, monolito, TypeScript estricto (`strict` + `noUncheckedIndexedAccess`) |
| Estilos | Tailwind CSS; tokens en `src/app/globals.css`; tema claro/oscuro; acento teal `#12999d`; Inter + IBM Plex Mono vía `next/font`; marca en `src/lib/brand.ts` |
| Movimiento | `motion` (LazyMotion), `src/components/motion.tsx` (≤300 ms salvo paneles 360 ms) |
| BD | PostgreSQL + Drizzle ORM; migraciones en `drizzle/` aplicadas al arrancar el contenedor |
| Auth | Better Auth + plugin `organization` (roles) |
| Validación | Zod en todo input externo |
| IDs | nanoid con prefijos (`ct_`, `cv_`, `msg_`, …) |
| Tiempo real | SSE en `/api/events` (heartbeat `: ping` ~25 s, catch-up con `since=`). Sin WebSockets ni colas externas |
| Trabajo de fondo | In-process (agente, Laboratorio, despachador de campañas, sync diario con Meta en `src/instrumentation.ts`) |
| Tests | Vitest (~120 unit), tests de BD (`pnpm test:db`), E2E con Playwright + mocks (`scripts/e2e-*.mjs`, guiones en `tests/e2e/*.md`) |
| Deploy | Docker multi-stage standalone, healthcheck `/api/health`; Coolify (Ruta A) o docker compose + Caddy (Ruta B). El fork construye desde código (no hay imagen publicada) |
| Paquetes | pnpm; deps clave: `@dnd-kit` (kanban), `frimousse` (emojis), `fflate` (xlsx), `lucide-react` |

**Seguridad de datos**
- Secretos cifrados AES-256-GCM (`lib/crypto`) con `key_version` por fila; rotación de `ENCRYPTION_KEY` al arrancar (`src/server/credentials/maintenance.ts`). Única puerta: `getOrgCredentials(org, tipo)`.
- Multi-tenancy: `organization_id NOT NULL` en toda tabla de dominio; `scoped()` / `scopedContacts()` / `scopedConversations()` en `src/lib/db/tenant.ts`.
- **RLS** `FORCE ROW LEVEL SECURITY` con `organization_id = current_setting('app.org_id')`. La app conecta como `vocero_app`; `vocero_system` solo para decidir organización (sesión, webhook, llave) o datos de plataforma.
- Webhook de WhatsApp: URL secreta + firma `x-hub-signature-256` (`META_APP_SECRET` obligatoria en producción).
- Cabeceras de seguridad (HSTS, CSP en reporte → `POST /api/csp-report`) en `src/lib/security/headers.ts`.
- Rate-limit en `/api/bot/*` (1200/min con llave; 30/min sin llave → 401/429).
- Muchos **tests de vigilancia** (guard tests) que fallan si alguien se salta una puerta única (crypto, LLM, system DB, módulos, permisos, RLS).

---

## 3. Roles y permisos

Matriz única en `src/lib/auth/permissions.ts`; el servidor valida cada ruta con
`withAuth(handler, { permission })`. La UI usa `useViewer()`.

| Permiso | Propietario | Coordinador | Asesor |
|---|:-:|:-:|:-:|
| `settings.manage` (WhatsApp, marca, agenda, anuncios, canales) | ✅ | — | — |
| `agent.manage` (Agente y Laboratorio) | ✅ | — | — |
| `users.manage` / `users.read` | ✅ / ✅ | — / ✅ | — |
| `pipeline.edit` (etapas) | ✅ | ✅ | — |
| `templates.manage` | ✅ | ✅ | — |
| `contacts.export` / `import` / `consent_override` | ✅ | ✅ | — |
| `tags.manage` | ✅ | ✅ | — |
| `campaigns.manage` | ✅ | ✅ | — |
| `assignment.manage` (asignar/reasignar, también en lote) | ✅ | ✅ | — |
| `scope.all` (ver todos los chats/leads/citas) | ✅ | ✅ | — |
| `results.read` / `results.all` | ✅ | ✅ | — |
| `knowledge.manage` | ✅ | ✅ | — |
| `team_chat.announce` | ✅ | ✅ | — |
| `team_chat.create_groups` | ✅ | delegable | — |
| `team_chat.oversee` (supervisión) | ✅ | — | — |
| `number_health.read` | ✅ | ✅ | — |

El **Asesor** solo ve y atiende sus chats/leads asignados (o donde es
participante), envía Conocimientos y usa el asistente de redacción.
Registro público se cierra tras la primera organización (`ALLOW_SIGNUP`).

---

## 4. Módulos (registro central `src/lib/modules/registry.ts`)

Dos capas: **plataforma** (`organization_module`: módulo apagado = 404 en
servidor) y **organización** (`nav_layout`: el Propietario reordena/oculta
entradas por rol; ocultar es solo estético).

| Módulo | Ruta | Núcleo | Roles por defecto | Notas |
|---|---|:-:|---|---|
| Bandeja | `/inbox` | ✅ | todos | globo de no leídos |
| Chat de equipo | `/chat` | — | todos | globo propio |
| Citas (Agenda) | `/bookings` | — | todos | variable `AGENDA` como default |
| Pipeline | `/pipeline` | ✅ | todos | |
| Contactos | `/contacts` | ✅ | todos | |
| Conocimientos | `/knowledge` | — | todos | |
| Campañas | `/campaigns` | — | Prop., Coord. | `CAMPAIGNS` default |
| Resultados | `/results` | — | Prop., Coord. | |
| Agente | `/agent` | — | Prop. | |
| Laboratorio | `/lab` | — | Prop. | requiere Agente |
| Ajustes | `/settings` | ✅ | Prop., Coord. | anclado abajo |
| Atribución | (en Ajustes → Anuncios) | — | — | `ATRIBUCION` default |
| Instagram | (en Bandeja) | — | — | `CHANNELS` default |
| Messenger | (Ajustes → Messenger) | — | — | `CHANNELS` default |

Perfiles de alta: **Básico** (sin Agente, Laboratorio, Campañas, Agenda,
Atribución, menú personalizable) y **Completo** (todo). Además existe la
bandera `customNav` (menú personalizable).

Menú lateral de 3 estados en escritorio (expandido → íconos → oculto),
guardado por usuario (`user_preference`); Asesor arranca en íconos.

---

## 5. Pantallas, subpestañas y funciones

### 5.1 Autenticación (`src/app/(auth)/`)
- `/login`, `/register` (solo mientras se permita registro).
- `/activar/[token]` y `/restablecer/[token]`: enlaces de un solo uso generados por el administrador de plataforma para poner contraseña.

### 5.2 Bandeja `/inbox` (núcleo)
Tres columnas: lista de conversaciones · hilo · panel de Detalles.
- **Lista**: buscador (sin acentos), filtros «Mostrar» (Todas / No leídas / Anuncios), «Etapa», «Quién atiende» (Míos / Sin asignar / Todo el equipo / persona), insignia de canal (WhatsApp/IG/Messenger), etiqueta «Anuncio · titular» si vino de Click-to-WhatsApp.
- **Hilo**: mensajes en ≤2 s vía SSE; estados enviado/entregado/leído/fallido (monotónicos, con error de Meta traducido); mensajes del agente marcados como IA; adjuntos entrantes y salientes (imagen, audio, video, documento, ubicación, contacto) guardados en el volumen propio (`/data`).
- **Editor (composer)**: texto, emojis, pegar imágenes con Ctrl+V, adjuntar (archivo/contacto/ubicación con pie), **Conocimientos** (picker), **varita del asistente de redacción** (Mejorar, Tono Formal/Casual/Empático, Resumir, Más corto, Más largo, Deshacer), **ventana de 24 h** visible: cerrada → solo plantilla aprobada (`template-sender`).
- **Panel de Detalles**: datos del contacto, etapa del pipeline, IA en esta conversación (activa / en pausa, con motivo: el cliente pidió humano, el agente escaló, error del proveedor, cuota agotada, respondiste desde el teléfono), aviso de «doble respuesta» si hay agente + cerebro externo, asignación y **participantes**, etiquetas, consentimiento, tarjeta de **anuncio de origen** (creativo, texto, enlace), **línea de tiempo** (notas con autor, etapas, asignaciones, pausas de IA, consentimiento, etiquetas).
- Handoff a humano con un clic; avisos de handoff solo al asignado y a quien ve todo.
- Bajas automáticas por palabra clave (STOP/BAJA) con respuesta configurable.

### 5.3 Chat de equipo `/chat` (opcional)
Interno, nada sale a Meta. Directos 1:1, grupos (creados en Ajustes), canal
**Avisos** para todo el equipo (`team_chat.announce`). Adjuntos, reacciones,
estado de lectura, globo de no leídos, **menciones de chats de cliente**
(se resuelven según el acceso de quien lee). Supervisión de solo lectura para
el Propietario, con aviso opcional al equipo.

### 5.4 Citas `/bookings` (módulo Agenda)
Calendario en la zona del negocio: vistas **Día, Semana, Mes, Lista**. Panel
de cita: abrir conversación, reprogramar, marcar realizada / «no asistió»,
cancelar. Clic en hueco vacío → bloquear horario. El agente ofrece huecos
reales y solo reserva un horario ofrecido (`offered_slot`); nunca confirma una
cita no creada. **Conectores** de reunión: Enlace fijo (default), Zoom
(Server-to-Server), Google Calendar + Meet; si el proveedor falla, la cita se
agenda igual con enlace pendiente. Citas de prueba jamás tocan un conector.

### 5.5 Pipeline `/pipeline` (núcleo)
Kanban con drag & drop (etapas por defecto: Nuevo → En conversación →
Interesado → Cliente → Perdido; editables con `pipeline.edit` en el gestor de
etapas). Tarjetas con prioridad (alta/media/baja), asignado, última
actividad. **Cajón del trato**: monto (moneda), prioridad, motivo de pérdida
(diálogo al mover a Perdido), ficha del lead, anuncio de origen, abrir
conversación. El agente o el bot externo también mueven etapas (misma puerta,
que además dispara la CAPI si Atribución está activa).

### 5.6 Contactos `/contacts` (núcleo)
Lista con búsqueda (nombre/teléfono), filtros por etapa, etiqueta,
consentimiento (acepta / no quiere / sin confirmar) y fuente; archivar /
desarchivar; nuevo contacto; editar; **escribir primero** (con plantilla);
**importar** CSV/XLSX con pregunta obligatoria de consentimiento («¿aceptaron?»),
tratamiento de quienes ya tienen opt_out (cambiarlo exige
`contacts.consent_override`) y conteo final de filas que no entraron;
**exportar** CSV respetando filtros. Identidad: `wa_identity` (teléfono
normalizado 521→52 o `bsuid:<id>`); el teléfono es OPCIONAL.

### 5.7 Conocimientos `/knowledge` (opcional)
Material que el EQUIPO envía (catálogo, políticas, fichas): título, texto y/o
archivo, etiquetas, búsqueda sin acentos. Se envía desde el editor de la
bandeja o del chat de equipo. Ver/enviar: todos; mantener: Prop. y Coord.
**El agente NO lo lee.**

### 5.8 Campañas `/campaigns` (opcional) — subpestañas
- **Campañas** (lista + detalle `/campaigns/[id]`: estado, destinatarios, pausar/reanudar, prueba a un número, banner de pausa de seguridad).
- **Nueva campaña** `/campaigns/new` (asistente por pasos): nombre interno → plantilla aprobada → audiencia (etiquetas o base guardada, solo `opt_in`, filtro por fuente) → variables (texto fijo, nombre del contacto o columna de la base) → revisar (cuántos recibirán, costo **Estimado**, margen del límite de 24 h) → enviar ahora o **programar**.
- **Audiencias** `/campaigns/audiences`: subir bases `.xlsx/.csv` (vista previa, muestra, fallos por fila).
- **Métricas** `/campaigns/metrics`: KPIs, respuestas dentro de la ventana, costo Estimado vs. Reportado por Meta, exportación CSV.
- **Plantillas** `/campaigns/templates` (`templates.manage`): ver Ajustes → Plantillas.
- **Ajustes de envío** `/campaigns/settings`: pausa de seguridad (al llegar a X % del límite, si fallan X %, sobre N envíos), horas de la ventana de respuesta, tarifas y moneda para el costo estimado.
- Motor: un despachador **por número** (concesión `wa_send_lease`, reclamo `SKIP LOCKED`, recuperación sin reenviar), programador cada 15 s, ritmo `CAMPAIGN_SEND_RATE` (1–80 msg/s).
- **Salud del número** (calidad, límite de mensajería, uso del día, alertas; `GET/POST /api/number-health`).

### 5.9 Resultados `/results` (opcional)
Selector de periodo (Desde/Hasta) contra el periodo anterior; días cortados
en la zona del negocio. Secciones:
- **Ventas**: prospectos nuevos, tratos ganados/perdidos, tasa de cierre, dinero ganado, dinero en tratos abiertos, ticket promedio, tratos sin monto, embudo.
- **El agente**: conversaciones nuevas, contestó el agente, primera respuesta, pasaron a humano.
- **Origen y anuncios**: de qué fuente/anuncio llegan las que terminan en venta (con miniatura del creativo).
- **Citas** (con Agenda): realizadas, no llegaron, canceladas, asistencia.
- **Qué se está cayendo** (higiene): leads en silencio, mensajes no entregados, ventanas de 24 h por cerrarse.
El Laboratorio no cuenta. No hay gasto publicitario (a propósito).

### 5.10 Agente `/agent` (opcional, Propietario)
- Tarjeta **«Quién responde a tus clientes»**: agente incluido vs. cerebro externo (última llamada a la API, salud por `BRAIN_HEALTH_URL`), alerta roja si hay doble respuesta.
- Interruptor **Agente encendido**.
- **Comportamiento**: nombre, tono, saludo para conversaciones nuevas, instrucciones, reglas de escalado.
- **Knowledge base del agente** (`kb_entry`): pares pregunta/respuesta y bloques de texto libre; medidor de tamaño.
- Funcionamiento: agrupa ráfagas (debounce `AGENT_COALESCE_MS`), responde solo con lo que sabe, **una acción tipada por turno**: `reply`, `update_lead` (nota), `move_stage`, `handoff`, `none`, y con Agenda `offer_slots`, `book_slot`. Lo que no valida se degrada a `reply`/`none`. Escala si el cliente pide humano (con detección de respaldo), si lo decide o si falla algo. Cuota de IA por organización (`ai_quota`/`ai_usage`, `chatJsonForOrg` única puerta).

### 5.11 Laboratorio `/lab` (opcional, requiere Agente)
Botón «Correr evaluación». Seis personas simuladas: **Comprador decidido,
Preguntón de precios, Cliente enojado, Pregunta fuera del conocimiento, Pide
humano, Errores/modismos** («ke onda si benden pintura»). Conversan contra el
agente real en sandbox (`is_test`: el sender lanza excepción si intenta tocar
Meta). Juez LLM independiente (`OPENROUTER_JUDGE_MODEL` opcional) → reporte con
**score 0–100**, hallazgos con evidencia (alucinación, fuera del conocimiento,
debió escalar, tono), **sugerencias con botón «Guardar en el KB»** e historial
de corridas con delta.

### 5.12 Ajustes `/settings` — subpestañas
| Pestaña | Ruta | Quién | Qué |
|---|---|---|---|
| WhatsApp | `/settings/whatsapp` | Prop. | Asistente de conexión: Phone Number ID, WABA ID, token (se muestran solo últimos 4), probar conexión, URL de webhook + verify token, estado de firma, modo directo / modo agencia (Tech Provider), respeta override de callback de la WABA; bajas STOP/BAJA (`opt-out-settings`) |
| Marca | `/settings/branding` | Prop. | Nombre, color, logo, favicon (white-label) |
| Plantillas | `/settings/templates` | Prop./Coord. | (Con Campañas redirige a `/campaigns/templates`.) Crear con encabezado (texto/medio, subida reanudable), cuerpo con `{{1}}…{{n}}`, pie y botones; sincronizar/importar paginado desde Meta; estados Borrador/Pendiente/Aprobada/Rechazada y Pausada/Desactivada/En apelación por Meta; aviso de cambio de categoría |
| Etiquetas | `/settings/tags` | Prop./Coord. | Crear/renombrar/borrar etiquetas |
| Equipo | `/settings/team` | Prop. (Coord. lee) | Altas de usuarios y roles Coordinador/Asesor (el reparto de leads nuevos vive en `src/server/assignment/strategy.ts`, sin pantalla propia) |
| Chat de equipo | `/settings/team-chat` | Prop. (grupos: delegable) | Grupos y participantes; supervisión; delegar creación de grupos |
| Agenda | `/settings/calendar` | Prop. (con Agenda) | Horario semanal, zona, duración, vista de huecos, conector (Enlace fijo / Zoom / Google) con credenciales cifradas y prueba |
| Anuncios | `/settings/ads` | Prop. (con Atribución) | Dataset de Meta, etapa = «lead calificado», tabla de eventos CAPI enviados con acuse/error |
| Navegación | `/settings/navigation` | Prop. (con `customNav`) | Reordenar/ocultar entradas del menú por rol (bitácora `nav_layout_event`) |
| Messenger | `/settings/messenger` | Prop. (con Messenger) | Conexión del canal (vía Zernio o Meta) |

### 5.13 Plataforma `/platform` (solo administradores de plataforma; 404 a los demás)
Organizaciones: crear (nombre del negocio, nombre y correo del Propietario,
módulos al crear: Básico / Completo / los de las variables), estado
**Activa / Suspendida / Borrada** (con motivo en bitácora y reautenticación),
**interruptores de módulos** por organización (Campañas, Agenda, Atribución,
Instagram, Messenger, Conocimientos, Agente, Laboratorio, Resultados, Chat de
equipo, Menú personalizable; ritmo de envío 1–80), ver personas, generar
**enlaces de activación / contraseña**, **bitácora de plataforma**. Nunca lee
contenido de un negocio, solo metadatos.

---

## 6. Integraciones externas

| Integración | Dónde | Notas |
|---|---|---|
| WhatsApp Cloud API (Graph) | `src/lib/meta/`, `src/server/whatsapp/` | Envío, plantillas, medios, salud del número, webhooks WABA (calidad, cuenta, categoría), analíticas diarias de plantillas y precios (`src/server/meta-sync/`) |
| Webhooks entrantes | `/api/webhooks/wa/[token]`, `/ig/[token]`, `/messenger/[token]` | Enrutados número/WABA/página → organización (`src/server/credentials/resolve.ts`); sin dueño → `webhook_unrouted` (cifrado, 7 días). Idempotentes por `wa_message_id` |
| LLM OpenRouter-compatible | `src/lib/ai/` (`chatJson<T>`) | Extracción robusta + reintentos; nunca dentro de `withTenant`/transacción |
| Meta Conversions API | `src/lib/meta/capi.ts`, `src/server/attribution/` | Lead calificado y venta con importe; `ctwa_clid` |
| Instagram / Messenger | `src/server/instagram/`, `src/server/messenger/`, `src/server/zernio/` | Conectores opcionales (ADR-001) |
| Zoom / Google Calendar | `src/server/agenda/connectors/` | Contrato de 4 operaciones (`docs/agenda-conectores.md`) |
| Cerebro externo | `/api/bot/*` + `X-API-Key` (`bot_api_key`, una org por llave) | context, messages, profile, ficha, handoff, typing, media, reset, availability, bookings; 409 tipados (`ai_paused`, `window_closed`, `sandbox_violation`) |

Mocks de desarrollo en `src/app/api/dev/` (wa-mock, ai-mock, google-mock,
zoom-mock, zernio-mock) tras `src/lib/dev-guard.ts` (404 en producción).

---

## 7. API interna (rutas `src/app/api/`)

- **Auth/cuenta**: `auth/[...all]`, `account-link/[token]`, `preferences`
- **Bandeja**: `conversations`, `conversations/[id]`, `…/messages`, `…/messages/media`, `…/messages/template`, `…/messages/knowledge`, `media/[assetId]`, `events` (SSE)
- **Contactos**: `contacts`, `contacts/[id]`, `…/notes`, `…/tags`, `…/assignments`, `…/participants`, `…/timeline`, `…/start-conversation`, `contacts/import`, `contacts/import/preview`, `contacts/export`, `contact-tags`, `contact-tags/[id]`
- **Asignación**: `assignments`, `assignments/bulk`
- **Pipeline**: `pipeline/board`, `pipeline/stages`, `pipeline/stages/[id]`, `pipeline/leads/[id]`
- **Agente/KB/Lab**: `agent/profile`, `agent/brain-status`, `kb`, `kb/[id]`, `kb/size`, `lab/runs`, `lab/runs/[id]`, `lab/suggestions/apply`, `writing-assist`
- **Conocimientos**: `knowledge`, `knowledge/[id]`, `knowledge/[id]/file`
- **Campañas**: `campaigns`, `campaigns/[id]` (+ `recipients`, `send`, `state`, `test`), `campaigns/preview`, `campaigns/alerts`, `campaigns/settings`, `campaigns/audiences` (+ `[id]`, `[id]/failures`, `preview`, `sample`), `campaigns/metrics` (+ `export`), `number-health`
- **Plantillas**: `templates`, `templates/sync`, `templates/category-seen`
- **Agenda**: `bookings`, `bookings/[id]`, `calendar/settings`, `calendar/availability`
- **Resultados**: `analytics/sales`, `analytics/bot`, `analytics/ads`, `analytics/hygiene`
- **Chat de equipo**: `team-chat/threads`, `…/[id]/messages`, `…/[id]/messages/knowledge`, `…/[id]/read`, `team-chat/groups` (+ `[id]`), `team-chat/messages/[id]` (+ `reactions`), `team-chat/attachments/[id]`, `team-chat/people`, `team-chat/unread`, `team-chat/settings`
- **Ajustes**: `settings/whatsapp` (+ `test`), `settings/webhook`, `settings/branding` (+ `favicon`), `branding/favicon`, `settings/team` (+ `[id]`), `settings/messaging`, `settings/navigation`, `settings/capi` (+ `events`), `settings/instagram`, `settings/messenger`, `settings/zoom` (+ `test`), `settings/google` (+ `test`)
- **Plataforma**: `platform/organizations`, `…/[id]/members`, `…/[id]/modules`, `…/[id]/status`, `platform/users/[id]/link`, `platform/audit`
- **Bot externo**: `bot/context`, `bot/messages`, `bot/profile`, `bot/ficha`, `bot/handoff`, `bot/typing`, `bot/media/[mediaId]`, `bot/reset`, `bot/availability`, `bot/bookings`
- **Otros**: `health`, `csp-report`, `seed/demo`, webhooks (`webhooks/wa|ig|messenger/[webhookToken]`)

---

## 8. Modelo de datos (tablas, `src/lib/db/schema.ts`)

- **Auth/organización**: `user`, `session`, `account`, `verification`, `organization` (estado active/suspended/deleted), `member` (rol), `invitation`, `sales_team`
- **Contactos y ventas**: `contact` (wa_identity, phone opcional, consentimiento con origen/fecha, archivado, asignado), `contact_tag`, `contact_tag_assignment`, `pipeline_stage`, `lead` (monto, prioridad, motivo de pérdida, ficha), `lead_stage_event`, `contact_assignment_event`, `contact_participant`, `contact_participant_event`, `assignment_settings`, `contact_activity_event`
- **Mensajería**: `conversation` (canal, `ai_enabled`, `handoff_at`, `is_test`), `message` (estado, pricing, error), `media_asset`, `whatsapp_business_account`, `template`, `messaging_settings`
- **Credenciales (cifradas)**: `meta_credentials`, `instagram_credentials`, `messenger_credentials`, `zoom_credentials`, `google_credentials`, `bot_api_key`, `webhook_unrouted`
- **IA**: `agent_profile`, `kb_entry`, `agent_test_run`, `agent_test_case`, `ai_quota`, `ai_usage`
- **Conocimientos**: `knowledge_entry`
- **Agenda**: `calendar_settings`, `booking`, `offered_slot`
- **Atribución**: `ad_attribution`, `conversion_event`, `capi_settings`
- **Campañas**: `campaign`, `campaign_recipient`, `audience_import`, `audience_member`, `campaign_settings`, `wa_send_lease`, `wa_phone_health`, `wa_template_analytics_daily`, `wa_pricing_analytics_daily`, `wa_analytics_sync`
- **Chat de equipo**: `team_chat_thread`, `team_chat_member`, `team_chat_message`, `team_chat_attachment`, `team_chat_reaction`, `team_chat_read_state`, `team_chat_settings`
- **Navegación/preferencias**: `user_preference`, `organization_module`, `nav_layout`, `nav_layout_event`
- **Plataforma**: `platform_admin`, `platform_audit_log`, `account_link_token`

---

## 9. Variables de entorno (`.env.example`)

- **Base**: `APP_BASE_URL`, `DOMAIN`, `SOURCE_COMMIT`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `DATABASE_URL_SYSTEM`, `DATABASE_URL_MIGRATE`, `VOCERO_APP_DB_PASSWORD`, `VOCERO_SYSTEM_DB_PASSWORD`, `DB_POOL_MAX`, `DB_SYSTEM_POOL_MAX`, `MEDIA_DIR`
- **Seguridad**: `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (+ `_VERSION`, `_OLD`, `_OLD_VERSION`), `ALLOW_SIGNUP`
- **Meta**: `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET` (obligatoria en prod), `META_GRAPH_API_VERSION`, `META_APP_ID`
- **IA**: `OPENROUTER_API_TOKEN`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `OPENROUTER_JUDGE_MODEL`, `AI_DEFAULT_MONTHLY_TURNS`, `AI_DEFAULT_MONTHLY_TOKENS`, `AGENT_COALESCE_MS`
- **Defaults de módulos** (solo valor inicial; el real es por organización): `CHANNELS`, `ATRIBUCION`, `CAMPAIGNS`, `CAMPAIGN_SEND_RATE`, `AGENDA`
- **Conectores**: `ZERNIO_BASE_URL`, `ZOOM_BASE_URL`, `ZOOM_OAUTH_BASE_URL`, `GOOGLE_CAL_BASE_URL`, `GOOGLE_OAUTH_BASE_URL`
- **Plataforma / bot**: `PLATFORM_ORG_ID`, `BOT_API_KEY`, `BRAIN_HEALTH_URL`
- **Pruebas** (nunca en producción): `WA_MOCK_ENABLED`, `META_GRAPH_BASE_URL` → wa-mock, `OPENROUTER_BASE_URL` → ai-mock

---

## 10. Scripts de operador (`scripts/`, en la imagen bajo `/app/ops/`)

`migrate.mjs` · `platform-admin.mjs` (dar/quitar admin de plataforma) ·
`purge-organization.mjs` · `bot-key.mjs` (llaves del cerebro externo) ·
`ai-quota.mjs` (topes de IA) · `reset-password.mjs` ·
`set-consent-inicial.mjs` · `seed:demo` · ~35 arneses E2E `e2e-*.mjs`.

---

## 11. Reglas no negociables (constitución, `.specify/memory/constitution.md`)

1. **Soberanía**: núcleo solo depende de WhatsApp Cloud API + LLM opcional; cualquier tercero es conector opcional, apagado por defecto, aislado y con degradación.
2. **Seguridad**: secretos cifrados con `key_version`; nunca al cliente ni a logs; token de WhatsApp solo últimos 4.
3. **Multi-tenancy**: `organization_id` + `scoped()`/`scopedContacts()` + RLS; nunca «la primera organización».
4. **Idempotencia**: dedup por `wa_message_id`, estados monotónicos, migraciones re-ejecutables.
5. **Sandbox del Laboratorio**: conversaciones `is_test` jamás tocan la API real.
6. **Permisos**: siempre `can(session, "…")` en servidor; nunca `role === "owner"`.
7. **Módulos opcionales**: por organización, 404 si están apagados, nunca en rama aparte.
8. **Estado de organización**: todo camino que actúe a nombre de una organización consulta `org-status.ts`.

**Definición de Hecho**: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
+ self-test E2E de comportamiento con mocks en verde.

---

## 12. Historial de specs (`specs/`)

001 núcleo · 002 diseño white-label · 003 paridad bandeja WhatsApp · 014
Instagram · 015 motor de agenda · 016 atribución CAPI · 017 Messenger · 018
anuncio de origen · 019 Resultados · 020 roles y asignación · 021 etiquetas,
consentimiento y campañas · 022 línea de tiempo · 023 asistente de redacción ·
024 Conocimientos · 025 chat de equipo · 026 participantes y menciones · 027
credenciales y webhooks · 028 plataforma · 029 módulos por organización · 030
campañas v2 (datos de Meta, envío por número, métricas, registro de módulos y
navegación).

Docs útiles: `docs/credenciales.md`, `docs/plataforma.md`, `docs/rls.md`,
`docs/roles-de-bd.md`, `docs/campanas-v2-meta.md`, `docs/atribucion-capi.md`,
`docs/agenda-conectores.md`, ADR-001 (canales opcionales), ADR-002
(conectores de agenda).

---

## 13. Material de marketing (capturas y videos)

Capturas PNG en Full HD (1920×1080) y videos MP4 H.264 en 1920×1080 a 30 fps, sin audio. Se tomaron de una instancia de demostración con datos ficticios (Ferretería El Martillo); no aparece ningún cliente real.

**Descarga con botón:** [Kit de medios Dashfort](https://claude.ai/artifact/Em1gNuEcf2WLzCnsHaohc7) (página con vista previa, botón «Descargar» en cada pieza y paquetes .zip de capturas y de videos).

Los archivos también viven en este repositorio, en [`docs/marketing/`](marketing/). En GitHub, cada enlace abre el archivo y tiene botón de descarga.

### Videos por función

| Video | Qué muestra |
|---|---|
| [Bandeja en tiempo real](marketing/videos/01-bandeja-tiempo-real.mp4) | Llega un mensaje nuevo y el agente de IA lo contesta solo. |
| [Asistente de redacción](marketing/videos/02-asistente-redaccion.mp4) | El asesor escribe rápido y la IA le ajusta el tono antes de enviar. |
| [Pipeline de ventas](marketing/videos/03-pipeline.mp4) | Arrastrar un trato de etapa y abrir su detalle. |
| [Contactos](marketing/videos/04-contactos.mp4) | Filtrar por etiqueta y consentimiento, y buscar. |
| [Citas](marketing/videos/05-citas.mp4) | Cambiar entre semana, mes y lista, y abrir una cita. |
| [Chat de equipo](marketing/videos/06-chat-equipo.mp4) | Escribir al grupo y revisar el canal de avisos. |
| [Conocimientos](marketing/videos/07-conocimientos.mp4) | Buscar material y enviarlo desde el chat. |
| [Campañas](marketing/videos/08-campanas.mp4) | Revisar una campaña y armar una nueva en el asistente. |
| [Métricas de campañas](marketing/videos/09-metricas.mp4) | Entrega, lectura, respuesta y costo. |
| [Resultados](marketing/videos/10-resultados.mp4) | Recorrido por ventas, origen, agente y alertas. |
| [Agente de IA](marketing/videos/11-agente.mp4) | Configuración del agente y su base de conocimiento. |
| [Laboratorio](marketing/videos/12-laboratorio.mp4) | Reporte de la evaluación y sugerencia aplicada al conocimiento. |
| [Plataforma](marketing/videos/13-plataforma.mp4) | Organizaciones y módulos por negocio. |

### Capturas

| Captura | Área | Qué muestra |
|---|---|---|
| [Inicio de sesión](marketing/capturas/00-login.png) | Acceso | Pantalla de acceso con la marca Dashfort. |
| [Bandeja de WhatsApp](marketing/capturas/01-bandeja.png) | Bandeja | Lista de chats, hilo con respuestas del agente de IA y panel de detalles. |
| [Bandeja · tema oscuro](marketing/capturas/01-bandeja-oscuro.png) | Bandeja | La misma bandeja en tema oscuro. |
| [Chat que llegó por un anuncio](marketing/capturas/02-bandeja-anuncio.png) | Bandeja | Tarjeta del anuncio Click-to-WhatsApp de origen en el panel del contacto. |
| [Asistente de redacción](marketing/capturas/03-asistente-redaccion.png) | Bandeja | La varita reescribe el borrador del asesor: mejorar, tono, resumir, acortar o alargar. |
| [Pipeline de ventas](marketing/capturas/04-pipeline.png) | Ventas | Tablero kanban con montos, prioridad y responsable por trato. |
| [Pipeline · tema oscuro](marketing/capturas/04-pipeline-oscuro.png) | Ventas | El tablero en tema oscuro. |
| [Detalle del trato](marketing/capturas/05-pipeline-trato.png) | Ventas | Monto, prioridad, etapa, responsable y ficha del lead. |
| [Contactos](marketing/capturas/06-contactos.png) | Ventas | Etiquetas, consentimiento, etapa y filtros; importar y exportar. |
| [Citas · semana](marketing/capturas/07-citas-semana.png) | Agenda | Calendario semanal en la zona horaria del negocio. |
| [Citas · tema oscuro](marketing/capturas/07-citas-semana-oscuro.png) | Agenda | Vista semanal en tema oscuro. |
| [Citas · mes](marketing/capturas/08-citas-mes.png) | Agenda | Vista mensual con todas las citas. |
| [Chat de equipo](marketing/capturas/09-chat-equipo.png) | Equipo | Grupos, directos y canal de avisos internos. |
| [Chat de equipo · tema oscuro](marketing/capturas/09-chat-equipo-oscuro.png) | Equipo | El chat interno en tema oscuro. |
| [Conocimientos](marketing/capturas/10-conocimientos.png) | Equipo | Catálogo, políticas y fichas que el equipo envía con dos clics. |
| [Campañas](marketing/capturas/11-campanas.png) | Campañas | Salud del número y campañas enviadas, programadas y en borrador. |
| [Detalle de campaña](marketing/capturas/12-campana-detalle.png) | Campañas | Entregados, leídos, respuestas y estado por destinatario. |
| [Nueva campaña](marketing/capturas/13-nueva-campana.png) | Campañas | Asistente en tres pasos: audiencia, mensaje y revisión. |
| [Audiencias](marketing/capturas/14-audiencias.png) | Campañas | Bases importadas desde Excel o CSV con su consentimiento. |
| [Métricas de campañas](marketing/capturas/15-metricas-campanas.png) | Campañas | Entrega, lectura, respuesta y costo reportado por Meta. |
| [Plantillas de WhatsApp](marketing/capturas/16-plantillas.png) | Campañas | Crear plantillas con encabezado, pie y botones; estado de aprobación. |
| [Ajustes de envío](marketing/capturas/17-ajustes-envio.png) | Campañas | Pausa de seguridad y tarifas para el costo estimado. |
| [Resultados](marketing/capturas/18-resultados.png) | Resultados | Ventas, embudo, dinero ganado y tratos abiertos del periodo. |
| [Resultados · tema oscuro](marketing/capturas/18-resultados-oscuro.png) | Resultados | El tablero de resultados en tema oscuro. |
| [Agente de IA](marketing/capturas/19-agente.png) | IA | Comportamiento, tono, reglas de escalado y base de conocimiento. |
| [Laboratorio](marketing/capturas/20-laboratorio.png) | IA | Seis clientes simulados evalúan al agente y un juez le da calificación. |
| [Laboratorio · tema oscuro](marketing/capturas/20-laboratorio-oscuro.png) | IA | El reporte del Laboratorio en tema oscuro. |
| [Conexión de WhatsApp](marketing/capturas/21-ajustes-whatsapp.png) | Ajustes | Asistente para conectar el número y el webhook. |
| [Marca](marketing/capturas/22-ajustes-marca.png) | Ajustes | Nombre, color, logo y menú: marca blanca. |
| [Equipo y roles](marketing/capturas/23-ajustes-equipo.png) | Ajustes | Propietario, Coordinador y Asesor. |
| [Etiquetas](marketing/capturas/24-ajustes-etiquetas.png) | Ajustes | Etiquetas de contacto con color. |
| [Horario de la agenda](marketing/capturas/25-ajustes-agenda.png) | Ajustes | Horario semanal, duración de citas y conector de reunión. |
| [Conversiones de anuncios](marketing/capturas/26-ajustes-anuncios.png) | Ajustes | Reporte a Meta del lead calificado y la venta. |
| [Menú por rol](marketing/capturas/27-ajustes-navegacion.png) | Ajustes | Reordenar u ocultar entradas del menú para cada rol. |
| [Ajustes del chat de equipo](marketing/capturas/28-ajustes-chat-equipo.png) | Ajustes | Supervisión, grupos y permisos delegables. |
| [Administración de plataforma](marketing/capturas/29-plataforma.png) | Plataforma | Alta de negocios, módulos por organización y bitácora. |
