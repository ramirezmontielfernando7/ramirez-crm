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

Índice corto. **Antes de modificar un área, lee su fila completa en [docs/mapa-del-codigo.md](docs/mapa-del-codigo.md)** (`grep -n "palabra" docs/mapa-del-codigo.md`): ahí están las reglas, guardarraíles, specs y migraciones de cada una.

| Área | Entrada principal |
|---|---|
| El cerebro/proveedor LLM | `src/lib/ai/` |
| Qué modelo y con cuánto esfuerzo responde cada función | `src/lib/ai/choice.ts` |
| El comportamiento/prompt del agente | `src/server/ai/prompts.ts` |
| Las acciones que puede tomar el agente | `src/server/ai/actions.ts` |
| Los agentes de una organización | `src/server/agents/` |
| Qué agente atiende cada etapa del pipeline | `src/server/agents/assignments.ts` |
| El conocimiento | `src/server/agents/kb.ts` |
| Los documentos que consulta el agente | `src/server/kb-docs/` |
| La vista previa del editor de agentes | `src/server/agents/preview.ts` |
| Las pantallas del Laboratorio | `src/app/(app)/lab/` |
| Los clientes simulados del Estudio de IA | `src/server/lab/simulated.ts` |
| Mensajes automáticos sin IA, chats olvidados, primera respuesta del equipo y «Exportar todos mis datos» | `src/lib/auto-replies.ts` |
| El canal WhatsApp | `src/lib/meta/` |
| Leer o guardar credenciales de un negocio | `src/server/credentials/` |
| Eventos de webhook sin organización | `src/server/webhooks/unrouted.ts` |
| El administrador de plataforma | `src/server/platform-admin/` |
| Qué módulos opcionales tiene una organización | `src/server/modules/` |
| El apagado limpio | `src/server/shutdown.ts` |
| Cabeceras de seguridad | `src/lib/security/headers.ts` |
| Caché de prompts de Claude en Bedrock | `src/lib/ai/index.ts` |
| Límites sencillos | `src/lib/fn-caps.ts` |
| La cuota de IA por organización | `src/server/ai-quota/` |
| El almacenamiento de una organización | `src/server/usage/storage.ts` |
| «Uso y plan» del Propietario | `src/server/usage/owner.ts` |
| El asistente interno | `src/server/assistant/threads.ts` |
| Qué ve el CLIENTE de su consumo de IA | `src/lib/usage-visibility.ts` |
| El costo de la IA | `src/lib/ai/` |
| La conexión directa de WhatsApp | `src/lib/direct-connection.ts` |
| «Mi número»: el WhatsApp de cada persona | `src/lib/db/tenant.ts` |
| El conector de IA | `src/server/ai-connector/mcp.ts` |
| Plan, topes y avisos de consumo de una organización | `src/server/limits/` |
| «Uso y plan» como ventana, «Mejora tu plan» y precios de los planes | `src/components/usage/usage-dialog.tsx` |
| Vender desde Plataforma | `src/lib/billing.ts` |
| Los canales opcionales | `src/lib/channels.ts` |
| Campos/tablas | `src/lib/db/schema.ts` |
| Estados del mensaje | `src/server/inbox/status.ts` |
| Bajas por palabra clave | `src/lib/opt-out.ts` |
| Salud del número | `src/lib/phone-health.ts` |
| «Conectar con Facebook» | `src/server/whatsapp/embedded-signup.ts` |
| Webhooks a nivel WABA | `src/server/whatsapp/waba-events.ts` |
| Trabajo diario con Meta | `src/server/meta-sync/daily.ts` |
| La Pestaña Métricas de Campañas | `src/server/campaigns/metrics.ts` |
| Plantillas | `src/lib/templates.ts` |
| La ingesta/envío de mensajes | `src/server/inbox/` |
| Respuestas rápidas | `src/lib/quick-replies.ts` |
| Motivos de pérdida editables | `src/server/leads/loss-reasons.ts` |
| La fila de la Bandeja | `src/components/avatar.tsx` |
| Los chats de campaña sin respuesta | `src/server/campaigns/inbox-view.ts` |
| Cómo se identifica a un contacto | `src/server/inbox/identity.ts` |
| Conectar TU propio bot en vez del agente | `src/app/api/bot/*` |
| Tareas y Notas | `src/server/work/tasks.ts` |
| La agenda | `src/server/agenda/` |
| Cómo se entrega la reunión | `src/server/agenda/connectors/` |
| De qué anuncio llegó cada conversación | `src/server/attribution/referral.ts` |
| Los números de Resultados | `src/server/analytics/` |
| La atribución de anuncios y el reporte a Meta | `src/server/attribution/` |
| Roles y permisos | `src/lib/auth/permissions.ts` |
| A quién está asignado un chat/lead y quién lo ve | `src/server/assignment/assign.ts` |
| Consentimiento al importar | `src/lib/import-consent.ts` |
| Etiquetas, consentimiento, importar/exportar CSV y campañas | `src/server/tags/` |
| Audiencias | `src/server/campaigns/audiences.ts` |
| La línea de tiempo del chat | `src/server/activity/log.ts` |
| Menú lateral colapsable y preferencias por usuario | `src/components/app-nav.tsx` |
| El asistente de redacción del asesor | `src/server/writing-assist/` |
| Biblioteca unificada | `src/server/library/` |
| Topes de subida de archivos | `src/lib/upload-limits.ts` |
| Conocimientos | `src/server/knowledge/` |
| El chat de EQUIPO | `src/server/team-chat/` |
| Qué módulos existen | `src/lib/modules/registry.ts` |
| La personalización de la interfaz | `src/lib/appearance.ts` |
| El encabezado de cada pantalla | `src/components/ui/page-shell.tsx` |
| El movimiento | `src/components/motion.tsx` |
| Respaldos de la base y de `/data/media`, y su prueba de restauración | `scripts/respaldo.mjs` |
| UI | `src/components/` |

Los mocks del entorno de pruebas viven en `src/app/api/dev/` (wa-mock +
ai-mock) tras un gate único (`src/lib/dev-guard.ts`): 404 incondicional en
producción. Única excepción: la app COMPILADA del job e2e de CI (`next start`)
los abre con `WA_MOCK_ENABLED=true` + `ALLOW_CI_MOCKS=true` + `APP_BASE_URL`
en `localhost`/`127.0.0.1`, los tres a la vez (`isMockEnabled` en
`src/lib/env.ts`; `tests/unit/dev-guard.test.ts`). Con mocks, el freno propio
de Better Auth se apaga como en `next dev` (el FR-062 por IP sigue).

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

## Ahorro de cuota

CLAUDE.md es corto a propósito: el detalle vive en `docs/`. Lee solo lo que toques. Ver [docs/ahorro-cuota.md](docs/ahorro-cuota.md) (context7 incluido en `.mcp.json`; rtk opcional).

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
OPENROUTER_ANALYSIS_MODEL=anthropic/claude-haiku-4.5  # opcional: análisis de conversaciones del asistente
```

Claude en Amazon Bedrock (créditos de AWS): `OPENROUTER_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com`,
`OPENROUTER_API_TOKEN` = llave de API de Bedrock y modelos `global.anthropic.claude-…`
(p. ej. `global.anthropic.claude-haiku-5-5`). Un modelo con ese nombre va por el
formato Messages (`/anthropic/v1/messages`, `src/lib/ai/anthropic-messages.ts`);
cualquier otro sigue por Chat Completions como siempre.

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

## Cómo trabajar con el dueño

- Fer no programa: háblale en español sencillo, sin jerga, con el resultado
  primero.
- Nunca fusionar un PR ni desplegar sin que Fer escriba «fusiona». Cada
  fusión a `main` es un deploy a producción (Coolify Auto Deploy).
- Una migración a la vez (no abrir dos PRs con migraciones en paralelo) y un
  deploy de Coolify a la vez.
- Cada PR con CI en verde y reporte en español: qué cambió / qué no se probó /
  riesgos / cómo revertir.

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
