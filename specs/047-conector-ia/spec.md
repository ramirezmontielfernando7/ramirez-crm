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

## PR 4 — Acciones (alcance `write`)

- Herramientas en `tools.ts`, cada una por la MISMA puerta que la pantalla y
  empezando por `getConversation` (chat ajeno = no existe):
  `send_message` (`sendText({ aiConnectionId })`: origen `operator`, SIEMPRE
  por Meta, nunca por el dispositivo; ventana de 24 h; tope diario
  `daily_message_limit` contado en `ai_action_log`, 0 = solo lee; una a la
  vez por persona en el proceso para que dos envíos simultáneos no pasen el
  tope), `tag_chat` (por nombre, nunca crea etiquetas; `setContactTags`),
  `move_stage` (`moveLeadToStage`; a una etapa perdida exige motivo activo),
  `add_note` (`logActivity`, a nombre de la persona), `create_task` (módulo
  `trabajo`, para la persona), `assign_chat` y `list_people` (solo con
  `assignment.manage`: `ToolSpec.permission`).
- Marca en la burbuja (`message.ai_connection_id` →
  `MessageDto.viaAiConnector`), solo para el equipo. Fer (2026-10-27): cada
  persona puede ponerle nombre a su IA («Joe», opcional, hasta 30 letras) en
  Mi IA o al crear su llave; la burbuja dice ese nombre con estrellitas en
  azul, y sin nombre «Asistente». El agente interno sigue con «IA» y su
  color. El nombre se copia al mensaje al enviar (`ai_sender_name`, migración
  0062): renombrar no cambia lo ya enviado.
- Prueba: `tests/db/conector-ia-acciones.test.ts`.

## PR 4b — Los chats de cliente de «Mi número» (sin migración)

- Quinto interruptor `direct_number.ai_connector` en Ajustes → Mi número
  («Mi IA puede ver y contestar mis chats de cliente», APAGADO; solo se
  muestra si la empresa tiene el conector: `visibleSwitches`,
  `aiConnectorOffered`). En un número de la empresa lo deciden quienes
  autorizan, como los demás.
- `src/server/ai-connector/my-number.ts`: solo el número VIVO de quien
  conectó la IA, con «Compartir mis clientes» y el interruptor encendidos, y
  solo chats con `client_marked_at`. Los privados y los números de otros no
  existen para la IA.
- `list_chats` con `inbox: "mi_numero"`; `read_chat` y `send_message`
  aceptan esos chats (nada más los toca: etiquetas, etapas, notas siguen
  siendo de la Bandeja). Enviar sale por el dispositivo del número
  (`sendFromMyNumber` con `aiConnectionId`/`aiSenderName`, sus límites y su
  fila), cuenta en el mismo tope diario y lleva la firma de la IA.
- Guardarraíl `tests/unit/conexion-directa-envio.test.ts` (la IA conectada
  es el único otro llamador de `mi-numero/send`) y prueba
  `tests/db/conector-ia-mi-numero.test.ts`.

## PR 5 — «Qué hizo tu IA» (sin migración)

- `listActions` en `log.ts` (`mine` / `team`, de 50 en 50 con `before`): la
  herramienta en palabras (`ACTION_LABEL`), el resultado («No le tocaba»,
  «Llegó al tope diario»), la IA (su nombre o «Asistente») y la conexión.
  Nunca texto de mensajes. El contacto (nombre y enlace a la Bandeja) solo
  si quien mira lo ve HOY (`scopedContacts`): un chat privado de «Mi
  número» o uno reasignado salen sin nombre.
- Mi IA → «Qué hizo tu IA» (`GET /api/ai-connector/activity`, lo de quien
  pide). Ajustes del conector → «Qué hizo la IA del equipo»
  (`GET /api/settings/ai-connector/activity`, `settings.manage`).
- /platform → Complementos ocultos: el interruptor «Conector de IA» (antes
  no había forma de encenderlo desde la pantalla) y, encendido, «N personas
  conectadas · N acciones este mes · N mensajes enviados por IA»
  (`OrgUsageSummary.aiConnector`, solo números).
- Pruebas en `tests/db/conector-ia-acciones.test.ts`.

## PR 6 — Funciones avanzadas (migración 0063)

Decisiones de Fer (2026-10-27/28): apagadas de fábrica; el Propietario
siempre, el Coordinador solo si el Propietario se lo da, el Asesor nunca;
cada herramienta pide ADEMÁS el permiso de la persona en el CRM (`can()`),
así que esto solo quita, nunca da.

- `ai_connector_settings`: `advanced_enabled`, `advanced_roles` (solo
  `coordinador`, CHECK), `advanced_areas` (`contacts`, `campaigns`, `tags`,
  `agents`, `settings`, CHECK) y `advanced_launch_campaigns`. Reversa
  `scripts/sql/0063-reversa.sql`. `saveConnectorSettings` sin `advanced`
  no las toca.
- Regla pura `advancedAllows(role, settings, area)` en
  `src/lib/ai-connector.ts`; `ToolSpec.area` y `ToolSpec.launch` los aplica
  `toolsFor` (lista Y llamada).
- Herramientas en `src/server/ai-connector/advanced-tools.ts`, por las
  puertas de siempre:
  - Contactos (`contacts.export` / `contacts.import`): `export_contacts`
    (CSV por `exportContactsCsv`, la misma función de la ruta de exportar,
    hasta 2,000; resaltada «Exportación» en «Qué hizo tu IA»),
    `import_contacts` (hasta 500, pregunta de consentimiento OBLIGATORIA,
    las bajas se respetan siempre).
  - Campañas (`campaigns.manage`, módulo Campañas): `list_templates`,
    `list_campaigns`, `prepare_campaign` (BORRADOR: una persona la lanza con
    «Enviar ahora») y `launch_campaign` (solo con «Puede lanzar campañas»).
  - Etiquetas (`tags.manage`): `create_tag`, `update_tag`, `tag_contacts`
    (`tagContactsInBulk`, solo contactos que la persona ve, nunca de
    sistema). Sin borrar.
  - Agentes (`agent.manage`, Laboratorio): `list_agents`, `read_agent`,
    `update_agent_draft` (solo el borrador; publicar es de una persona).
  - Algunos ajustes: respuestas rápidas (`templates.manage`) y motivos de
    pérdida (`pipeline.edit`); crear y editar, sin borrar.
- UI: tarjeta «Funciones avanzadas» en Ajustes → Conector de IA.
- Pruebas en `tests/db/conector-ia-avanzadas.test.ts`.

## Ajuste 2026-10-28 — la IA envía por la vía del chat

En la prueba con Claude real, `send_message` rechazaba los chats con la
ventana de 24 h cerrada aunque el chat estuviera en Conexión directa o
híbrida: la IA conectada salía SIEMPRE por Meta. Fer pidió que mande igual
que él desde la Bandeja. Ahora `send_message` llama `sendText` con
`allowDirect: true`: la misma vía de la persona (Meta, Directa o
Automática), con los límites y la fila del dispositivo, el tope diario del
conector y la marca de la IA en el mensaje. Solo texto. El agente interno
sigue sin salir por el dispositivo (salvo «Mi número» y empresa sin Meta,
como antes). Pruebas en `tests/db/conexion-directa-envio.test.ts` y el
guardarraíl `tests/unit/conexion-directa-envio.test.ts`.

## Ajuste 2026-10-28 — conocimiento y documentos de los agentes

Fer pidió herramientas «de todo lo que se pueda». Primera parte: el
conocimiento del Estudio de IA (`src/server/ai-connector/knowledge-tools.ts`),
dentro del área «Ajustar agentes de IA» de Funciones avanzadas y con
`agent.manage` (hoy solo el Propietario), como la pantalla:
`list_knowledge`/`add_knowledge`/`update_knowledge` (preguntas y bloques,
compartido o de un agente, por `agents/kb.ts`; aplican al momento, no tienen
borrador) y `list_documents`/`read_document` (páginas de 20,000
caracteres)/`add_document` (texto ya extraído, a un grupo por nombre o
exclusivo de un agente, por `kb-docs/store.ts`, con el tope de almacenamiento
y el indexador de siempre; solo con `KB_DOCS` y Laboratorio). Ninguna borra.
Pruebas en `tests/db/conector-ia-conocimiento.test.ts`.

## Ajuste 2026-10-28 — ficha, embudo, tareas y notas

Segunda parte (`src/server/ai-connector/crm-tools.ts`), SIN Funciones
avanzadas porque la pantalla ya lo deja a cualquier rol, con la misma
visibilidad (el asesor solo lo suyo): `read_contact` (ficha, notas, datos,
consentimiento, etapa, monto, prioridad, etiquetas y línea de tiempo),
`update_contact` (nombre, notas y parche de la ficha por `upsertFicha`; el
consentimiento NO), `list_pipeline` (leads por etapa con totales),
`update_lead` (monto y prioridad por `src/server/leads/fields.ts`, la misma
regla que `PATCH /api/pipeline/leads/[id]`), `update_task` (editar y marcar
hecha) y `list_work_notes`/`create_work_note`/`update_work_note` (por
`work/notes.ts`; archivar sí, borrar no). Pruebas en
`tests/db/conector-ia-crm.test.ts`.

## PRs siguientes

5b. Prueba con Claude real en el piloto.

Después: asistente dentro del CRM sobre las mismas herramientas (Bedrock).
