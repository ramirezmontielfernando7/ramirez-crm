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

## PRs siguientes

2. Conector que solo lee (`/mcp`, llave personal, metadatos RFC 9728) con
   herramientas de lectura sobre las consultas del CRM y pruebas de alcance.
3. «Iniciar sesión» OAuth + Ajustes → «Conecta tu IA» (maquetas en Clásico
   claro ANTES de programar).
4. Acciones (enviar, etiquetar, etapa, perdido con motivo, tareas, notas,
   asignar) con topes y distintivo.
5. «Qué hizo tu IA», vista del Propietario, contador en /platform y prueba
   con Claude real en el piloto.

Después: asistente dentro del CRM sobre las mismas herramientas (Bedrock).
