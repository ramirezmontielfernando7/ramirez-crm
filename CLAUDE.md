# Vocero CRM — Guía para Claude

Vocero es un CRM de WhatsApp open source (MIT), self-hosted, con agentes de IA y
Laboratorio para crearlos, probarlos y evaluarlos. Una instancia atiende a
VARIAS organizaciones (multi-tenant: RLS + `organization_id` en todo; ver
«Multi-tenancy» abajo); cada organización es un negocio. Este archivo guía a
Claude Code (u otro asistente) para operar y **modificar** este repositorio —
el caso típico: una agencia adaptando Vocero para un cliente.

## Stack

**Next.js 15 (App Router) + React 19** en monolito · TypeScript estricto
(`strict` + `noUncheckedIndexedAccess`) · Tailwind CSS (sistema de diseño de la
marca Vocero, el mismo de vocerocrm.com: tokens en `src/app/globals.css`, tema
claro/oscuro, marca de la casa **Dashfort by Demfort** con acento
white-label por defecto el teal `#12999d`, letra de interfaz
Inter (400/500/600, tokens por función en `globals.css`) e IBM Plex Mono self-hosted vía
`next/font`; el logo (burbuja
de chat sobre mosaico teal), el nombre y la firma viven en `src/lib/brand.ts`
y se dibujan con `src/components/brand-mark.tsx`) ·
**PostgreSQL + Drizzle ORM** (migraciones versionadas en
`drizzle/`, aplicadas al ARRANCAR el contenedor) · **Better Auth** + plugin
organization · **Zod** en todo input externo · nanoid con prefijos (`ct_`,
`cv_`, `msg_`…) · pnpm · Vitest (unit) + guiones E2E en `tests/e2e/`
conducidos con Playwright · Docker multi-stage (standalone, healthcheck
`/api/health`) · deploy en Coolify (Ruta A) o docker compose + Caddy (Ruta B).

Tiempo real por **SSE** (`/api/events`): heartbeat `: ping` ~25s, headers
anti-buffering, catch-up por refetch con `since=`. Sin WebSockets, sin colas
externas: el trabajo en segundo plano (agente, Laboratorio) es in-process.

## Mapa del código (fronteras de modificación)

| Quieres cambiar… | Toca… |
|---|---|
| El cerebro/proveedor LLM | `src/lib/ai/` (adaptador OpenRouter-compatible, `chatJson<T>`) |
| El comportamiento/prompt del agente | `src/server/ai/prompts.ts` (con o sin nombre propio: `config.name` null = habla como el equipo) |
| Las acciones que puede tomar el agente | `src/server/ai/actions.ts` + el turno en `src/server/ai/pipeline.ts`: `loadTurnContext` → `decideTurn` (prompt + modelo + validación, SIN efectos en BD) → `executeAction` |
| Los agentes de una organización (varios; general; borrador/publicado; versiones) | `src/server/agents/` — ÚNICA puerta de `agent`/`agent_publish_log` (`store.ts`); forma única del JSON de config en `config.ts` (`agentConfigSchema`); qué agente atiende un turno: `resolve.ts`; `agent_profile` sigue siendo el interruptor global y el ESPEJO del general publicado (`mirror.ts`, misma transacción); `ensure.ts` garantiza el general y reconcilia en cada turno (una lectura; escribe solo si `agent_profile` cambió por fuera) · rutas `/api/lab/agents/*` · spec [031](specs/031-laboratorio-agentes/spec.md) |
| Qué agente atiende cada etapa del pipeline (PR B; solo con el módulo Laboratorio) | `src/server/agents/assignments.ts` — ÚNICA puerta de `agent_stage_assignment` (solo agentes publicados, no generales; `stage_taken` al reemplazar) · el turno: `withStageAgent` en `resolve.ts` (después de silencios y traspasos) · `conversation.last_agent_id` + `agent_changed` en `handover.ts` · «Atiende: …» de la Bandeja: `peekAgentForConversation` + `GET /api/conversations/[id]/agent` · rutas `/api/lab/assignments*` · pestaña `/lab/asignacion` (`components/lab/stage-assignments.tsx`) · el cerebro externo (`/api/bot/*`) NO usa asignaciones |
| El conocimiento (KB) que lee el agente | `src/server/agents/kb.ts` — ÚNICA puerta de escritura de `kb_entry` (test de vigilancia `kb-gate.test.ts`); `agent_id` NULL = compartido, si no, de ese agente; el general siempre lee el compartido |
| Los documentos que consulta el agente (RAG ligero: Laboratorio → Documentos; .txt/.md/.pdf con texto) | `src/server/kb-docs/` — `store.ts` ÚNICA puerta de `kb_document`/`kb_chunk` (test `kb-docs-gate.test.ts`; límites bajo el candado de la organización) · `extract.ts` (unpdf) · `indexer.ts` (in-process, 1 por organización y 2 en total; retoma al arrancar) · `retrieve.ts` (texto `tsvector` español sin acentos + coseno en Node sobre `real[]`, fusión RRF; sin pgvector) · reglas puras en `src/lib/kb-docs.ts` · interruptor de instancia `KB_DOCS` (solo `flag.ts`) + módulo `lab` · embeddings: adaptador OpenAI-compatible `src/lib/ai/embeddings.ts` (prefijos e5 «query: »/«passage: ») y ÚNICA puerta `embedForOrg` en `src/server/ai-quota/embed.ts` (`ai_usage.kind = 'embed'`, aparte del total; test `embed-gate.test.ts`) · en el prompt: sección delimitada con nonce por turno (`renderDocs` en `prompts.ts`); sin fragmentos, el prompt de siempre · límites por organización `kb_document_limit` (`scripts/kb-limits.mjs`) · rutas `/api/lab/documents*` · UI `components/lab/documents-client.tsx` · guía [docs/conocimiento-rag.md](docs/conocimiento-rag.md) · spec [035](specs/035-documentos-rag/spec.md) |
| La vista previa del editor de agentes (sin estado, no ejecuta nada) | `src/server/agents/preview.ts` (acciones → chips) · `POST /api/lab/preview` (30/min por persona) · guardarraíl `tests/unit/lab-preview-sandbox.test.ts` |
| Las pantallas del Laboratorio (Agentes, editor con vista previa, Evaluaciones) | `src/app/(app)/lab/` (`layout.tsx` guarda permiso + módulo; `page.tsx` = Agentes, `evaluaciones/`, `agents/[id]/`) · `src/components/lab/` (`lab-shell.tsx` pestañas: Agentes, Asignación por etapa, Evaluaciones · `agents-list.tsx` · `agent-editor.tsx` · `agent-preview.tsx` · `agents-api.ts`) · piezas compartidas: `AgentConfigForm` (`components/agent/`, también lo usa /agent), `MessageBubble` (`components/inbox/`, la burbuja de la Bandeja) y `SectionTabs` (`components/ui/`, también Campañas) · con Laboratorio a la vista, `resolveNav` oculta «Agente» del menú (`/agent` sigue vivo) · spec [031](specs/031-laboratorio-agentes/spec.md) A2 |
| Las personas o el juez del Laboratorio | `src/server/lab/personas.ts` · `src/server/lab/judge.ts` · lo que se evalúa se congela en `agent_test_run.agent_snapshot` (`src/server/agents/snapshot.ts`) |
| El canal WhatsApp (Graph API) | `src/lib/meta/` (cliente único) + `src/server/whatsapp/` |
| Leer o guardar credenciales de un negocio (tokens, secretos) | `src/server/credentials/` — ÚNICA puerta: `getOrgCredentials(org, tipo)` con errores tipados y `sealForStorage`; enrutamiento de webhooks (número/WABA/página → organización) en `resolve.ts`; rotación de `ENCRYPTION_KEY` al arrancar en `maintenance.ts` (nadie más importa `lib/crypto`: test de vigilancia) · guía: [docs/credenciales.md](docs/credenciales.md) · spec [027](specs/027-credenciales-webhooks/spec.md) |
| Eventos de webhook sin organización | `src/server/webhooks/unrouted.ts` (tabla de plataforma `webhook_unrouted`, cifrada, 7 días) |
| El administrador de plataforma (organizaciones: alta, suspensión, borrado suave, enlaces de contraseña, bitácora) | `src/server/platform-admin/` (`org-status.ts` decide si una organización opera; `admins.ts` quién es administrador y la reautenticación; `organizations.ts`, `links.ts`, `audit.ts`) · rutas `/api/platform/*` con `withPlatformAdmin` (404 a todos los demás) · página `src/app/(app)/platform/` · enlaces públicos `/activar/[token]` y `/restablecer/[token]` · operador: `scripts/platform-admin.mjs`, `scripts/purge-organization.mjs` (en la imagen: `/app/ops/`) · guía: [docs/plataforma.md](docs/plataforma.md) · spec [028](specs/028-plataforma/spec.md) |
| Qué módulos opcionales tiene una organización (Campañas, Agenda, Atribución, Instagram, Messenger) | `src/server/modules/` — por ORGANIZACIÓN (`organization_module`, la edita el administrador de plataforma en /platform); `defaults.ts` es el ÚNICO lector de `CAMPAIGNS`/`AGENDA`/`ATRIBUCION`/`CHANNELS`/`CAMPAIGN_SEND_RATE`, que ahora son solo el valor por defecto (test de vigilancia `modules-guard.test.ts`); relleno al arrancar en `store.ts` · las preguntas de siempre (`agendaEnabled(org)`, `campaignsEnabled(org)`, `isChannelEnabled(org, canal)`…) piden la organización · spec [029](specs/029-modulos-por-organizacion/spec.md) |
| Cabeceras de seguridad (HSTS, CSP en reporte, frame-ancestors) | `src/lib/security/headers.ts` (aplicadas en `next.config.ts`) · reportes en `POST /api/csp-report` |
| La cuota de IA por organización | `src/server/ai-quota/` (`chatJsonForOrg` es la ÚNICA forma de llamar al modelo: test de vigilancia) · topes en `ai_quota`, consumo en `ai_usage` · consumo por AGENTE en `ai_usage_agent` (solo reporta; `chatJsonForOrg(…, { agentId })` desde el turno, el Laboratorio, la vista previa y el juez; la escritura y los embeddings no tienen agente; un fallo al anotar no tumba el turno) · operador: `scripts/ai-quota.mjs` · spec [036](specs/036-uso-y-plan/spec.md) |
| Los canales opcionales (Instagram, Messenger; ADR-001) | `src/lib/channels.ts` (catálogo) · `src/server/channels/` (capacidades; canales encendidos por organización: `enabled.ts` → `src/server/modules/`) · `src/server/instagram/` · `src/server/messenger/` · `src/server/zernio/` (transporte y firma de la API unificada, compartido) |
| Campos/tablas | `src/lib/db/schema.ts` → `pnpm db:generate` → migración nueva en `drizzle/` |
| Estados del mensaje (horas, `pricing`, error de Meta; monotónico y atómico) | `src/server/inbox/status.ts` · traducción de errores en `src/lib/meta/send-errors.ts` · referencia de la API de Meta y lo NO VERIFICADO: [docs/campanas-v2-meta.md](docs/campanas-v2-meta.md) · spec [030](specs/030-campanas-v2/spec.md) |
| Bajas por palabra clave (STOP/BAJA) y su respuesta automática | `src/lib/opt-out.ts` (reglas puras) · `src/server/inbox/opt-out.ts` (llamado desde la ingesta) · ajustes por organización en `src/server/messaging-settings.ts` (`messaging_settings`) |
| Salud del número (calidad, límite, uso, alertas) | `src/lib/phone-health.ts` · `src/server/whatsapp/health.ts` (`wa_phone_health`; Meta fuera de transacción, escritura en `withTenant`) · `GET/POST /api/number-health` (permiso `number_health.read`) · UI `src/components/number-health.tsx` |
| Webhooks a nivel WABA (calidad, cuenta, categoría de plantilla) | `src/server/whatsapp/waba-events.ts` |
| Trabajo diario con Meta (salud + plantillas + analíticas) | `src/server/meta-sync/daily.ts` (arranca en `src/instrumentation.ts`) · analíticas de plantillas y precios a la base propia en `src/server/meta-sync/analytics.ts` (`wa_template_analytics_daily`, `wa_pricing_analytics_daily`, estado en `wa_analytics_sync`; reglas puras en `src/lib/meta-analytics.ts`) |
| La Pestaña Métricas de Campañas (KPIs, respuestas en la ventana, costo Estimado vs. Reportado por Meta, CSV) | `src/server/campaigns/metrics.ts` · contratos y conciliación en `src/lib/campaign-metrics.ts` · `GET /api/campaigns/metrics` (+ `/export`) · UI `src/components/campaigns/metrics-client.tsx` · spec [030](specs/030-campanas-v2/spec.md) PR 3 |
| Plantillas (componentes, importación paginada, creación con encabezado/pie/botones, pausa, categoría) | Pantalla: Campañas → Plantillas (`/campaigns/templates`) si la organización tiene Campañas; si no, Ajustes → Plantillas (que con Campañas redirige) · `src/lib/templates.ts` (borrador y requisitos de envío) · `src/server/whatsapp/templates.ts` · subida reanudable en `src/lib/meta/upload.ts` (`META_APP_ID`) |
| La ingesta/envío de mensajes | `src/server/inbox/` (ingest idempotente, send con guard de sandbox, ventana 24h) |
| La fila de la Bandeja (cápsulas Etapa · Etiquetas · Asignado, punto de IA, filtro por etiqueta) y archivar/eliminar chats | Fila y menús: `src/components/inbox/` (`conversation-list.tsx` `ConversationRow`, `chat-capsules.tsx`, `floating-menu.tsx` portal + cierre al clicar fuera, `use-long-press.ts` para touch) · el chat se archiva/elimina SOLO por `src/server/inbox/lifecycle.ts` (`conversation.archived_at`, migración `0039`; un entrante desarchiva en `ingest.ts`) · `DELETE /api/conversations/[id]` pide `conversation.delete` (Propietario y Coordinador; 403 antes de tocar BD; borra mensajes por cascada, contacto y lead se conservan) · reglas puras en `src/lib/inbox-filters.ts` · lo que pinta la lista (lead, etapa, etiquetas, ¿hay bot?) viaja en LA MISMA consulta de `listConversations` para que lleve el filtro del asesor (`assignment-scope.test.ts`) · el chat que nace de un echo (`smb_message_echoes`) crea su lead en la 1.ª etapa abierta · spec [034](specs/034-bandeja-capsulas/spec.md) |
| Cómo se identifica a un contacto | `src/server/inbox/identity.ts` (teléfono normalizado o `bsuid:<id>`) |
| Conectar TU propio bot en vez del agente | `src/app/api/bot/*` + `src/server/bot/auth.ts` (X-API-Key) · quién responde (agente incluido, cerebro externo, doble respuesta): `src/server/bot/status.ts` + `GET /api/agent/brain-status` |
| El módulo «Trabajo» (Citas + Tareas + Notas en un solo ítem del menú) | Entrada del menú: la de `agenda` en `src/lib/modules/registry.ts`, ahora «Trabajo» en `/trabajo` (`anyOf: agenda \| trabajo`, `alsoActive: /bookings`) · Citas sigue en `/bookings` y su módulo es `agenda` (sin migrar datos) · Tareas: módulo `trabajo` (`organization_module.trabajo`, DEFAULT false; perfiles Básico/Completo lo encienden) · `src/server/work/tasks.ts` ÚNICA puerta de `work_task` (cada quien lo suyo; `work.manage` = Propietario y Coordinador, todo) · reglas puras `src/lib/work.ts` · rutas `/api/work/tasks*` · UI `src/components/work/` (`WorkShell` con `SectionTabs`, `tasks-client.tsx`) · «Nueva tarea para este chat» en `contact-panel.tsx` · Notas (tipo Keep, mismo módulo `trabajo`): `src/server/work/notes.ts` ÚNICA puerta de `work_note` (sin ligar = solo de quien la escribe; ligada a un chat = de quien ve ese contacto, `assignedTo`; editar: autor o `work.manage`) · rutas `/api/work/notes*` · UI `notes-client.tsx` + «Notas de trabajo» del panel del contacto (`contact-notes.tsx`; distintas de las notas de la línea de tiempo, 022) · colores `--note-*` en `globals.css` · internas: nunca se envían · spec [033](specs/033-trabajo/spec.md) |
| La agenda (horarios, huecos, citas) | `src/server/agenda/` — detrás del módulo Agenda de la organización (`flag.ts` → `src/server/modules/`) |
| Cómo se entrega la reunión (Zoom, Meet…) | `src/server/agenda/connectors/` + catálogo en `src/lib/agenda-connectors.ts` · guía: [docs/agenda-conectores.md](docs/agenda-conectores.md) |
| De qué anuncio llegó cada conversación (siempre visible) | `src/server/attribution/referral.ts` (normalización) · `creativo.ts` (copia de la imagen, solo hosts de Meta) · `store.ts` · tarjeta en `src/components/anuncio-origen.tsx` |
| Los números de Resultados (ventas, agente, origen y anuncios, higiene) | `src/server/analytics/` (un módulo por sección; periodo en la zona del negocio en `period.ts`; exclusión del Laboratorio en `shared.ts`) · contratos y tasas en `src/lib/analytics.ts` · UI en `src/components/results/` · spec [019](specs/019-resultados/spec.md) |
| La atribución de anuncios y el reporte a Meta | `src/server/attribution/` — el `ctwa_clid`, la CAPI y Ajustes → Anuncios detrás del módulo Atribución de la organización (`flag.ts` → `src/server/modules/`) + `src/lib/meta/capi.ts` · guía: [docs/atribucion-capi.md](docs/atribucion-capi.md) |
| Roles y permisos (Propietario / Coordinador / Asesor) | `src/lib/auth/permissions.ts` (la matriz, única; `can(session, "…")`) · 403 en servidor con `withAuth(handler, { permission })` de `src/lib/api.ts` · UI: `useViewer()` de `src/components/viewer-context.tsx` · spec [020](specs/020-roles-asignacion/spec.md) |
| A quién está asignado un chat/lead y quién lo ve | `src/server/assignment/assign.ts` (ÚNICA puerta que escribe `contact.assigned_user_id` + bitácora `contact_assignment_event`) · participantes (ven y atienden además del asignado, 026): `src/server/assignment/participants.ts` (única puerta de `contact_participant` + bitácora) · aviso de handoff solo al asignado y a quien ve todo: `src/server/inbox/handoff-notice.ts` · filtro central `scopedContacts()`/`scopedConversations()` en `src/lib/db/tenant.ts` (nunca `scoped()` a secas para datos de clientes en rutas de usuario: hay test de vigilancia) · reparto de leads nuevos: `src/server/assignment/strategy.ts` · SSE: `src/server/events/visibility.ts` |
| Consentimiento al importar (pregunta obligatoria «¿aceptaron?», tratamiento de quien ya tiene opt_out, conteo final) | `src/lib/import-consent.ts` (contrato) · `src/server/contacts-io/import.ts` (`importValidated`, `findOptOutConflicts`; bitácora `consent_changed` en la misma transacción) · `consent-form.ts` (cambiar una baja pide `contacts.consent_override`: Propietario y Coordinador) · UI `src/components/import-consent.tsx` · migración inicial del operador: `scripts/set-consent-inicial.mjs` (`/app/ops/`) |
| Etiquetas, consentimiento, importar/exportar CSV y campañas | `src/server/tags/` (`contact_tag.system_origin` = etiqueta de SISTEMA, la automática «Import: archivo» de la importación: `listTags`/`tagsForContacts` NO la traen salvo `system: "include"|"only"` / `includeSystem`; `setContactTags` conserva siempre las de sistema; `mergeTags` fusiona en una transacción, re-apunta `audience_import.tag_id` y rechaza un destino de sistema · `POST /api/contact-tags/[id]/merge` · UI Ajustes → Etiquetas «Automáticas de importación» y `tag-merge-panel.tsx` · etiqueta opcional «para todos los contactos de la base» de Audiencias: `src/lib/import-tag.ts` + `contacts-io/extra-tag-form.ts`) · `src/server/contact-filter.ts` (EL filtro: lista, export y público) · `src/server/contacts-io/` (import; `.xlsx` en `spreadsheet.ts`) · `src/server/campaigns/` (público **solo `opt_in`** en `audience.ts`, módulo Campañas de la organización) · spec [021](specs/021-campanas/spec.md) |
| Audiencias (.xlsx/.csv), asistente, cola de envío POR NÚMERO, pausa de seguridad | `src/server/campaigns/audiences.ts` (sobre `importValidated`) · `dispatcher.ts` (un despachador por número + programador cada 15 s) · `queue.ts` (concesión `wa_send_lease`, reclamo `SKIP LOCKED`, recuperación sin reenviar) · `lifecycle.ts` · `outcome.ts` · `safety.ts` · `settings.ts` (`campaign_settings`: umbrales y tarifas ESTIMADAS) · UI `src/components/campaigns/` · spec [030](specs/030-campanas-v2/spec.md) |
| La línea de tiempo del chat (notas, etapas, asignación, IA, consentimiento, etiquetas) | `src/server/activity/log.ts` (ÚNICA puerta de `contact_activity_event`) · `timeline.ts` (junta las bitácoras al leer) · palabras en `src/lib/timeline.ts` · UI `src/components/inbox/chat-timeline.tsx` · spec [022](specs/022-linea-de-tiempo/spec.md) |
| Menú lateral colapsable y preferencias por usuario | `src/components/app-nav.tsx` · `src/server/preferences.ts` (`user_preference`) · default por rol en `src/lib/preferences.ts` |
| El asistente de redacción del asesor (varita del editor; NO es el agente) | `src/server/writing-assist/` (prompts + `rewrite.ts` sobre `chatJson`) · `POST /api/writing-assist` · UI `src/components/inbox/writing-assist.tsx` · spec [023](specs/023-asistente-redaccion/spec.md) |
| Conocimientos (material que el EQUIPO envía; el agente NO lo lee) | `src/server/knowledge/` (`store.ts` única puerta de `knowledge_entry` · `deliver.ts` con `KnowledgeTarget`, punto de integración del chat interno) · API `src/app/api/knowledge/` + `conversations/[id]/messages/knowledge` · UI `src/components/knowledge/` (`KnowledgePicker` independiente del canal) · permiso `knowledge.manage` · spec [024](specs/024-conocimientos/spec.md) |
| El chat de EQUIPO (directos, grupos, Avisos; interno, nada sale a Meta) | `src/server/team-chat/` (única puerta de `team_chat_*`: `threads.ts` acceso por membresía y supervisión · `messages.ts` · `audience.ts` quién recibe cada evento SSE · `settings.ts` supervisión y delegación) · reglas puras en `src/lib/team-chat.ts` · API `src/app/api/team-chat/` · UI `src/components/team-chat/` (globo aislado en `unread-store.ts`) + Ajustes → Chat de equipo · permisos `team_chat.*` (`create_groups` delegable al Coordinador en `DELEGABLE`) · menciones de chats de cliente (se resuelven por quien lee, sin filtrar nada al que no tiene acceso): `src/lib/team-chat-mentions.ts` · specs [025](specs/025-chat-equipo/spec.md) y [026](specs/026-participantes-menciones/spec.md) |
| Qué módulos existen (registro central: ruta, ícono, núcleo, roles por defecto, dependencias) y el menú lateral | `src/lib/modules/registry.ts` · menú por rol (puro) `src/lib/modules/nav-layout.ts` · 404 por módulo en rutas `moduleOff(org, clave)` y páginas `requireModulePage` (`src/server/modules/`; test de vigilancia `modules-routes-guard.test.ts`) · el menú de quien pide `src/server/navigation/resolve.ts` · Ajustes → Navegación (solo con `custom_nav`): `src/server/navigation/store.ts` (única puerta de `nav_layout` + bitácora `nav_layout_event`) · UI `src/components/settings/navigation-settings.tsx` · ocultar es SOLO estético · spec [030](specs/030-campanas-v2/spec.md) PR 4 |
| La personalización de la interfaz (Ajustes → Personalización: Apariencia, Marca, Navegación) | `src/lib/appearance.ts` (opciones y reglas puras; cookie personal > organización > fábrica) · `src/server/appearance.ts` (`organization.metadata.appearance`, sin migración) · `PUT /api/settings/appearance` (`settings.manage`) · UI `src/components/settings/appearance-client.tsx` · páginas `src/app/(app)/settings/personalization/` (Marca y Navegación se movieron aquí; sus rutas viejas redirigen) · estilos `[data-font]` / `[data-chat]` al final de `globals.css` (la burbuja solo expone clases `bubble*`) · la preferencia personal es una cookie por navegador (pasarla a BD pide migración) · spec [032](specs/032-personalizacion/spec.md) |
| El movimiento (resortes, presión táctil) | `src/components/motion.tsx` (`motion`, `LazyMotion` estricto; nada > 300 ms salvo los paneles que entran y salen: `NAV` = `duration-nav` + `ease-panel`, 360 ms, menú lateral y Detalles) |
| UI | `src/components/` + `src/app/(app)/` |

Los mocks del entorno de pruebas viven en `src/app/api/dev/` (wa-mock +
ai-mock) tras un gate único (`src/lib/dev-guard.ts`): 404 incondicional en
producción.

**Identidad de contacto**: Meta está migrando de teléfono a Business-Scoped
User IDs, así que `from` puede no venir. La llave estable es
`contact.wa_identity` (teléfono normalizado 521→52, o `bsuid:<id>`); `phone` es
un atributo OPCIONAL. Nunca asumas que un contacto tiene teléfono.

**Cerebro externo**: `/api/bot/*` (autenticada por `X-API-Key` contra
`bot_api_key`, una organización por llave: `src/server/bot/keys.ts`) deja que
un microservicio propio conduzca la conversación sin que el token de WhatsApp
salga del CRM: marcar leído + "escribiendo…", descargar adjuntos y reiniciar la
conversación de pruebas. Respeta `conversation.ai_enabled`/`handoff_at` igual
que el agente in-process. La organización la dice la LLAVE, nunca "la primera
organización". `BOT_API_KEY` (env) se liga al arrancar solo a
`PLATFORM_ORG_ID`; otras llaves las crea el operador con
`scripts/bot-key.mjs`. Sin llave, esa superficie responde 401 y el CRM
funciona igual.

**Organización de la plataforma** (`PLATFORM_ORG_ID`, `src/server/platform.ts`):
solo ella ve los secretos de la plataforma (token del webhook) y solo sus
miembros pueden ser administradores de plataforma (Fase 3, `platform_admin`).
Sin la variable, nadie: jamás hay respaldo a "la primera organización"
(guardarraíl en `tests/unit/tenant-query-guard.test.ts`).

**Estado de la organización** (Fase 3): `active | suspended | deleted`. Todo
camino que actúe a nombre de una organización (sesión, login, webhook, envío,
plantillas, campañas, agente, cerebro externo) consulta
`src/server/platform-admin/org-status.ts`. Un camino nuevo que envíe algo a
Meta o gaste IA también. El administrador de plataforma NUNCA lee contenido
de un negocio (conversaciones, mensajes, contactos, notas): solo metadatos.

## Reglas de la constitución (no negociables)

Ver [.specify/memory/constitution.md](.specify/memory/constitution.md).

- **Soberanía (II, endurecida — 1.4.0)**: el NÚCLEO depende solo de WhatsApp
  Cloud API + proveedor LLM OpenRouter-compatible opcional; prohibido meterle
  S3/R2, email, billing u otros terceros. Un servicio de terceros solo entra
  como **conector opcional**: apagado por defecto tras bandera (patrón
  ADR-001), aislado tras adaptador con contrato público, con camino sin
  dependencia externa y degradación definida (su fallo jamás bloquea la
  operación core), credenciales del negocio cifradas, y CI que lo prueba
  apagado y encendido. Auth y BD self-hosted.
- **Seguridad (I)**: secretos cifrados en reposo (AES-256-GCM, `lib/crypto`,
  con `key_version` por fila: la llave se rota sin volver a pegar nada);
  jamás al cliente ni a logs. El token de WhatsApp solo muestra sus últimos 4.
  Una tabla nueva con columnas `*_cipher` lleva `key_version` y entra en
  `src/server/credentials/maintenance.ts`, o `credentials-gate.test.ts` falla.
- **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio;
  toda query pasa por `scoped()` de `src/lib/db/tenant.ts` — y, si responde a
  una persona con datos de clientes, por `scopedContacts()` (020).
  Además (PR 3 multitenant, [docs/roles-de-bd.md](docs/roles-de-bd.md)): la app
  conecta como `vocero_app` y cada consulta de `getDb()` fija `app.org_id` con
  la organización del contexto (`withAuth`, `runWithOrganization`) o de
  `withTenant(org, fn)`. Trabajo fuera de una request (timers, arranque,
  webhooks ya enrutados) abre su propio contexto. `getSystemDb()`
  (`vocero_system`) solo para lo que decide la organización (sesión, webhook,
  llave) o es de plataforma; cada uso va en
  `tests/unit/system-db-guard.test.ts`. Jamás llames al LLM dentro de
  `withTenant` ni de `db.transaction()`: `chatJson` lanza.
  **RLS (PR 4, [docs/rls.md](docs/rls.md))**: toda tabla de dominio tiene
  `FORCE ROW LEVEL SECURITY` con la política `organization_id =
  current_setting('app.org_id', true)`: fuera de un contexto de organización
  la app (`vocero_app`) ve CERO filas. Una tabla nueva con `organization_id`
  lleva la política en su migración o `tests/db/rls.test.ts` falla.
- **Permisos (020)**: se validan en el SERVIDOR, en cada ruta, con la matriz
  de `src/lib/auth/permissions.ts`. Nunca `session.role === "owner"` suelto;
  una ruta nueva va en la tabla de `tests/unit/permissions-routes.test.ts`.
- **Idempotencia (IV)**: webhooks dedup por `wa_message_id` UNIQUE; estados
  monotónicos; seeds y migraciones re-ejecutables.
- **Sandbox del Laboratorio**: las conversaciones `is_test` JAMÁS tocan la API
  real — el sender lanza excepción (no lo "arregles": es un guardrail). Lo
  mismo vale para la agenda: una cita de prueba nunca llega a un conector.
- **Módulos opcionales (015, 016; por organización desde 029)**: lo que no usa
  todo negocio va detrás de un módulo de la ORGANIZACIÓN (`src/server/modules/`;
  la variable de despliegue es solo el valor por defecto), apagado por
  defecto, con su superficie en 404 para quien no lo tiene y la migración
  aplicada igual. Un camino nuevo pregunta por la organización a nombre de la
  cual actúa. Nunca en una rama aparte
  ([ADR-001](docs/adr-001-canales-opcionales.md),
  [ADR-002](docs/adr-002-conectores-de-agenda.md)).

## Variables de entorno

Ver `.env.example` (cada una con guía inline). Las claves: `APP_BASE_URL`,
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (32 bytes base64),
`META_WEBHOOK_VERIFY_TOKEN` (segmento secreto del webhook), `META_APP_SECRET`
(firma; **obligatoria en producción**: sin ella el webhook de WhatsApp
responde 401 a todo, salvo con los mocks fuera de producción), y para IA:

```bash
OPENROUTER_API_TOKEN=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_JUDGE_MODEL=anthropic/claude-haiku-4.5   # opcional: juez más barato
```

Para el self-test local existe además el modo de pruebas interno (mocks) —
ver `specs/001-vocero-core/quickstart.md`. Nunca actives mocks en producción.

## Manejo de credenciales (obligatorio)

Cuando una feature necesite una variable/credencial nueva: (1) agrégala a
`.env` como placeholder `REEMPLAZA_...` (append), (2) deja guía inline `#` de
cómo obtenerla, (3) resume en el chat y sigue. `.env` está gitignored; para
deploy, las vars van también en la plataforma de hosting (runtime, no build).

## Definición de Hecho REFORZADA (obligatoria)

"Typecheck + lint + build (+ tests)" es el piso, NO el techo. Una feature no
está "Hecha" hasta correr el **self-test de COMPORTAMIENTO de punta a punta**
(Playwright + mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock) y dejarlo verde: flujo real como usuario,
resultado observable, y el camino infeliz degradando sin colgarse. Prohibido
delegar la prueba al usuario. Si algo depende de un LLM/proveedor externo,
todo turno tolera formato inesperado con extracción robusta + reintentos — un
hipo del proveedor nunca tumba el turno. Al detectar un fallo: diagnostica,
corrige y re-verifica tú mismo hasta verde (loop de auto-corrección).

Gate técnico:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Guiones E2E por historia en `tests/e2e/*.md`. Parte de ellos ya están
automatizados: con la app viva y los mocks encendidos, `pnpm test:e2e`
(`scripts/e2e-selftest.mjs`) los conduce contra la app real y sale distinto de
cero si algo falla. Al agregar una historia, extiende el arnés en vez de dejar
solo el `.md`.

## Modo Objetivo — Loop SDD

Cuando el dueño da una META (no prompts paso a paso): Discover → Plan →
Execute → Verify → Iterate, de forma autónoma, volviendo solo con el objetivo
verificado en vivo o con un bloqueo real (decisión de producto, credenciales,
acción irreversible/costosa). Agrupa TODAS las preguntas bloqueantes al inicio.
El estado durable son los artefactos SDD en `specs/` (spec/plan/tasks) —
manténlos al día. Invocable como `/loop-sdd <objetivo>`.

## Memoria persistente

Los subagentes con `memory: project` usan `.claude/agent-memory/`. Lo demás
que deba sobrevivir entre sesiones (decisiones, gotchas) va en el repo: specs,
ADRs en `docs/` o este archivo.

## Arquitectura de agentes

1. **Orquestador** = la sesión principal de Claude Code (este CLAUDE.md + skill
   `loop-sdd`).
2. **Subagentes** (`.claude/agents/`): `deploy-ops` (deploy/logs/healthchecks,
   no escribe código de app) · `public-site-builder` (páginas públicas/legales
   y config de paneles externos).
