# 047 — Conector de IA (la IA de cada persona actúa como ella)

Plan y decisiones de Fer (27 oct 2026): documento «Conector de IA para
Dashfort» del proyecto; Fer aceptó las cinco recomendaciones.

Cada persona del equipo conecta SU propia IA (Claude, ChatGPT, n8n, Cursor…)
a Dashfort por MCP y le pide cosas como «revisa mis chats de hoy, etiqueta a
los interesados y contesta a los que preguntaron precio». La IA usa
herramientas del conector (leer un chat, enviar un mensaje, etiquetar…); no
navega pantallas. Complemento OCULTO: solo /platform lo enciende. La IA la
paga cada persona: Dashfort no gasta tokens.

## Reglas de producto

- **Un solo conector** (`/mcp`, servidor MCP remoto dentro del CRM) y **cada
  quien con su llave**: «Iniciar sesión» OAuth 2.1 con PKCE para Claude y
  ChatGPT, o llave personal para herramientas técnicas.
- **La IA es la persona.** Mismos permisos (`can()`), mismo alcance
  (`scopedContacts()`/`scopedConversations()`), mismas reglas de envío
  (ventana de 24 h, plantillas, bajas, sandbox). Lo que la persona no ve en
  el CRM, su IA tampoco.
- **Decisión 1:** el Propietario enciende el conector para su empresa y
  elige qué roles pueden usarlo (él siempre puede); luego cada persona
  conecta la suya.
- **Decisión 2:** la IA puede enviar mensajes, con tope de 100 por persona
  en 24 h que el Propietario puede bajar (0 = solo leer).
- **Decisión 3:** «Mi número»: quinto interruptor del dueño del número,
  APAGADO: «Mi IA puede ver y contestar los chats que marqué como cliente».
  Los chats privados nunca.
- **Decisión 4:** gratis en el piloto (la universidad); precio después.
- **Decisión 5:** lo que mandó la IA lleva un distintivo «enviado por IA»
  visible solo para el equipo. El cliente no ve nada distinto.
- **Nunca** (no existe herramienta): exportar contactos, campañas masivas,
  borrar, cambiar ajustes, roles, usuarios o conexiones de WhatsApp.
- Llaves revocables desde Ajustes; mueren todas si la persona sale de la
  organización o la organización se suspende. Acceso 1 h, renovación 30 días.
  Solo se guarda el SHA-256.
- «Qué hizo tu IA»: cada herramienta queda anotada (nunca el texto del
  mensaje). El Propietario ve la de su empresa.
- Riesgo de inyección: el texto de los clientes llega a la IA. Por eso no hay
  herramientas peligrosas, hay topes, y los resultados marcan el contenido
  del cliente como datos.

## Normas técnicas (MCP, revisión 2026-07-28)

Metadatos del recurso protegido (RFC 9728) y del servidor de autorización,
`resource` (RFC 8707) con validación de audiencia antes de cada herramienta,
autorización en CADA solicitud (sin `Mcp-Session-Id`), CIMD preferido y
registro dinámico (RFC 7591) por compatibilidad, `iss` en la respuesta
(RFC 9207).

## PR 1 — Datos (este PR; nada visible)

Migración `0060_conector_ia` (solo aditiva, idempotente; reversa
`scripts/sql/0060-reversa.sql`):

- `ai_connector_settings` (por organización; sin fila = apagado): `enabled`,
  `allowed_roles` (`coordinador`/`asesor`), `daily_message_limit` (0–1000,
  100 por defecto).
- `ai_connection`: IA de una persona (`oauth`|`key`), `scopes` ⊆
  {`read`,`write`} con `read` siempre, revocada nunca borrada.
- `ai_token`: SHA-256 de cada llave (`access`/`refresh` con caducidad, `key`
  sin ella), FK compuesta a su conexión (misma organización).
- `ai_oauth_code`: código de un solo uso con PKCE y `resource`.
- `ai_oauth_client`: tabla de PLATAFORMA (registro dinámico, antes de saber la
  organización): sin RLS, solo pool de sistema (`SOLO_SISTEMA`).
- `ai_action_log`: «Qué hizo tu IA»; `tool` `^[a-z_]{1,40}$`, resumen ≤ 200.
- `direct_number.ai_connector` (APAGADO), `message.ai_connection_id` (NULL),
  `organization_module.conector_ia` (APAGADO; `orgHasConectorIa`).

RLS con la política de siempre en las cinco tablas con organización. Prueba:
`tests/db/conector-ia-datos.test.ts`.

## PR 2 — Conector que solo lee (sin pantallas)

- `POST /api/mcp` (`src/app/api/mcp/route.ts`): JSON-RPC 2.0 sin sesión,
  responde JSON (sin streams; `GET`/`DELETE` → 405). `initialize` y
  `server/discover` negocian versión (`2026-07-28`, `2025-11-25`,
  `2025-06-18`, `2025-03-26`); notificaciones → 202; lotes → error.
- Autenticación `src/server/ai-connector/auth.ts`: `Authorization: Bearer`
  con llave `dfk_` (personal) o `dfa_` (acceso OAuth, PR 3); `dfr_` nunca
  abre. La llave dice organización y persona; el rol sale de la membresía de
  HOY (`resolveMembership`) + delegaciones y se arma `sessionContext`. No
  abre si: revocada/caducada, la persona salió, organización suspendida,
  complemento apagado, conector apagado o rol fuera (403 `connector_off`).
  401 con `WWW-Authenticate: Bearer resource_metadata=…`. Topes: 120/min
  por conexión, 30 fallos/min por IP.
- Metadatos RFC 9728: `/.well-known/oauth-protected-resource[/api/mcp]`.
- Catálogo cerrado `src/server/ai-connector/tools.ts` (Zod en cada
  argumento): `list_chats`, `read_chat` (no marca leído; avisa que el texto
  de clientes son datos), `list_stages`, `list_tags`, `list_quick_replies`,
  `list_tasks` (solo con `trabajo`). Usan `listConversationsPage`,
  `getConversation`, `scopedConversations`: chats de «Mi número» fuera.
- Llaves `src/server/ai-connector/keys.ts` (ÚNICA puerta de `ai_connection`
  y `ai_token`): `createPersonalKey`, `listMyConnections`,
  `revokeConnection`, `resolveToken` (pool de sistema, por hash). Ajustes
  del Propietario `settings.ts`. Bitácora `log.ts` (ÚNICA puerta de
  `ai_action_log`; también lo inventado o negado).
- Pruebas: `tests/unit/conector-ia.test.ts`,
  `tests/db/conector-ia-lectura.test.ts` (alcance por rol, otra
  organización, revocar, apagar, salir).

## PRs siguientes

3. «Iniciar sesión» OAuth + Ajustes → «Conecta tu IA» (maquetas en Clásico
   claro ANTES de programar).
4. Acciones (enviar, etiquetar, etapa, perdido con motivo, tareas, notas,
   asignar) con topes y distintivo.
5. «Qué hizo tu IA», vista del Propietario, contador en /platform y prueba
   con Claude real en el piloto.

Después: asistente dentro del CRM sobre las mismas herramientas (Bedrock).
