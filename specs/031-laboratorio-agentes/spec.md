# 031 — Laboratorio como Centro de Agentes

El Laboratorio deja de ser solo «correr la evaluación» y pasa a ser el lugar
donde se **crean, prueban, evalúan y publican** los agentes de IA de una
organización: varios agentes, cada uno con su configuración y (opcional) su
propio conocimiento, un editor con vista previa de chat que usa lo que está
en el formulario aunque no esté guardado, borrador vs. publicado, activación
por etapa del pipeline y recuperación de conocimiento cuando el KB es grande.
Cuatro PRs secuenciales (la fase A va en dos); cada uno se fusiona y
despliega antes de empezar el siguiente.

| PR | Contenido | Migración | Producción tras fusionar |
|---|---|---|---|
| A1 | Caracterización + prueba dorada, migración, `src/server/agents/`, refactor de `runAgentTurn`, prompt sin nombre, evaluaciones con snapshot, KB por agente y todas las rutas (incluida la vista previa). **Sin pantallas nuevas** | 0035 | **Idéntica a hoy**: solo existe el general y siempre se resuelve a él |
| A2 | Pantallas: lista de agentes, editor con vista previa, versiones, evaluaciones con selector, `/agent` con `AgentConfigForm`; componentes extraídos (`AgentConfigForm`, `MessageBubble`, `SectionTabs`) con capturas antes/después de Bandeja y Campañas | — | Idéntica a hoy (la Bandeja y Campañas se ven igual) |
| B | Asignación de agentes por etapa, resolver con etapa, mapa de etapas, «Atiende: …» en la Bandeja, `agent_changed` en la línea de tiempo | 0036 | Los agentes por etapa operan al asignarlos (solo con el módulo Laboratorio) |
| C | Recuperación de conocimiento (`search_text`, `always_include`, texto completo), modo en el medidor, evaluación del recuperador | 0037 | Un KB grande deja de inflar el prompt |

Decisiones del dueño (no se repreguntan):

- **D1** Tabla nueva `agent` para todas las identidades, incluido el
  general. `agent_profile` se conserva como dueño del interruptor global
  `enabled` y como **espejo**, escrito en la misma transacción, de la
  configuración *publicada* del general: `/api/bot/profile`, seeds, fixtures,
  e2e y el rollback a la imagen anterior siguen funcionando sin tocarlos.
- **D2** Borrador y publicado en la misma fila (`draft`, `published`, jsonb)
  + bitácora `agent_publish_log` (snapshots, últimas 30 por agente).
- **D3** Vista previa SIN estado en servidor: el cliente manda el historial
  (≤ 20 mensajes) en cada petición. Cero tablas, cero purga.
- **D4** La vista previa no ejecuta nada (ni `message`, `lead`, `booking`,
  agenda ni Meta). Solo consume cuota (`ai_usage`, tipo `lab`). Las acciones
  se muestran como chips.
- **D5** No hay «Simular como etapa»: el modelo no recibe la etapa; se prueba
  un agente, no una etapa.
- **D6** Máx. 1 agente por etapa; un agente puede tener varias etapas; máx. 1
  general; máx. 20 agentes activos (no archivados) por organización.
- **D7** Los agentes por etapa solo operan con el módulo `lab` encendido; con
  `lab` apagado todo cae al general. `/agent` sigue editando el
  comportamiento del general (el módulo `agent` puede estar encendido sin
  `lab`).
- **D8** Restaurar una versión la carga al BORRADOR, nunca a producción.
- **D9** El backfill del general conserva el nombre actual («Asistente» por
  defecto). Un agente nuevo nace sin nombre de presentación.
- **D10** RAG sin extensiones: `search_text` normalizado con `normalizeText`
  + índice GIN `to_tsvector('simple', …)`. Sin `pgvector`.

Fuera de alcance: embeddings, métricas por agente en Resultados,
`message.agent_id`, plantillas «Empezar desde», acciones permitidas por
agente, mostrar etapa o nombre del contacto al modelo, cambiar
`matchesHandoffIntent`, tocar el contrato de `/api/bot/*`.

Todas las migraciones son **aditivas** (expand): Coolify despliega `main` y
las migraciones corren al arrancar mientras el contenedor anterior sigue
sirviendo. Revertir = redesplegar la imagen anterior. Cada PR trae su
`scripts/sql/00NN-reversa.sql` opcional.

## PR A (A1 + A2) — Agentes, borrador/publicado y vista previa

### Historias

1. **Varios agentes.** En `/lab` (pestaña Agentes, por defecto) el
   Propietario ve sus agentes en tarjetas: nombre interno, nombre de
   presentación o «Sin nombre · habla como el negocio», insignia «General»,
   estado (Publicado / Borrador / Cambios sin publicar), último score con
   fecha y acciones Editar · Evaluar · Duplicar · Archivar. «Crear agente»
   pide el nombre interno, crea el borrador y abre el editor. Estado vacío
   con una línea. Tope: 20 agentes activos (`agent_limit`).
2. **Agente general.** Toda organización con `agent_profile` tiene
   exactamente un agente general publicado (backfill en la migración +
   `ensureGeneralAgent` perezoso para seeds y fixtures que solo insertan
   `agent_profile`). El general no se archiva (`agent_general`). «Hacer
   general» promueve otro agente publicado en una transacción (nunca 0 ni 2
   generales).
3. **Nombre de presentación opcional.** Con nombre, el prompt arranca igual
   que hoy (`Eres "<nombre>", …`, prueba dorada). Sin nombre: «Eres el
   asistente de WhatsApp de este negocio. No tienes nombre propio: no te
   presentes con uno y habla como el equipo del negocio. …». El juez recibe
   `Nombre: (sin nombre propio)`.
4. **Editor de dos columnas** (`/lab/agents/[id]`; escritorio ≈45/55, móvil
   con pestañas Configurar / Probar). Izquierda: Identidad (nombre interno
   obligatorio; nombre de presentación opcional con ayuda), Comportamiento
   (el mismo `AgentConfigForm` de `/agent`), Conocimiento (interruptor «Usar
   el KB compartido» + KB propio con medidor). Pie fijo: «Cambios sin
   publicar», Guardar borrador, Publicar (diálogo con resumen; aviso suave si
   nunca se evaluó) e Historial de versiones con «Cargar al borrador».
5. **Vista previa.** Derecha: burbujas de la Bandeja (componente extraído, no
   copiado), «escribiendo…», insignia «Sandbox · no se envía a WhatsApp»,
   Reiniciar, chips de acción y panel plegable «Por qué respondió así»
   (acción, modelo, tokens, latencia, entradas de KB usadas). Usa el estado
   ACTUAL del formulario aunque no esté guardado. Estados: cargando, vacío,
   error de red, cuota agotada, IA no configurada, permiso/módulo apagado.
   `aria-live` en la respuesta.
6. **Borrador vs. publicado.** Editar y guardar el borrador nunca cambia
   producción. Publicar copia el borrador a `published`, registra la versión
   y, si es el general, actualiza el espejo `agent_profile` en la misma
   transacción (sin tocar `enabled`).
7. **Evaluaciones por agente.** `/lab/evaluaciones` es lo que hoy es el
   Laboratorio. Al correr se elige agente y fuente (borrador o publicado;
   default: general publicado). La corrida guarda el snapshot (config + texto
   del KB tal como se evaluó) y el runner y el juez usan ese snapshot.
   «Agregar al conocimiento» puede ir al KB compartido o al del agente.
8. **`/agent` se conserva**: interruptor global, «Quién responde», cuota y el
   comportamiento del general con `AgentConfigForm`; con `lab` encendido,
   enlace «Gestionar todos los agentes → Laboratorio».

### Diseño

- **Datos (0035):** `agent` (`agt_`; `internal_name`, `is_general`, `draft`,
  `published`, `published_at/by`, `archived_at`, `created_by`, timestamps;
  `unique (organization_id, id)`; índice único parcial `agent_general_uq` en
  `(organization_id) WHERE is_general AND archived_at IS NULL`; CHECKs de
  `jsonb_typeof`). `agent_publish_log` (`apl_`; append-only con disparador
  como `nav_layout_event`; acciones `publish|restore|legacy_put|make_general`).
  `kb_entry.agent_id` (NULL = compartido; FK compuesta cascade).
  `agent_test_run.agent_id` (FK compuesta `SET NULL (agent_id)`) y
  `agent_snapshot`. RLS + política `aislamiento_por_organizacion` en las
  tablas nuevas. Backfill idempotente del general desde `agent_profile`.
- **Forma de la config** (`agentConfigSchema`, única lectura/escritura del
  JSON): `{ v: 1, displayName, tone, greeting, instructions,
  escalationRules, useSharedKb }` con los límites del `putSchema` actual.
- **`src/server/agents/`** es la única puerta de las tablas nuevas:
  `config.ts`, `store.ts`, `ensure.ts`, `mirror.ts`, `resolve.ts`,
  `kb.ts` (única puerta de escritura de `kb_entry`).
- **Reconciliación del espejo** (`ensure.ts`): en CADA turno, una lectura
  barata (una consulta: `agent_profile` + el general) compara
  `agent_profile.updated_at` con `published_at` del general. Solo si hay
  desfase (escritura de la imagen anterior durante el despliegue o tras un
  rollback, o del seed de la demo) escribe: copia el perfil al general como
  `legacy_put`. El espejo escribe ambos con la misma hora: no hay vaivén.
- **Turno del agente:** `runAgentTurn(conversationId, opts?)` =
  `loadTurnContext` → `decideTurn` (prompt + `chatJsonForOrg` + validación;
  sin efectos en BD) → `executeAction`. La vista previa reutiliza
  `decideTurn` con un contexto armado en memoria.
- **Vista previa** `POST /api/lab/preview`: permiso `agent.manage`, módulos
  `lab` y `agent`, IA configurada, 30/min por usuario (`checkRateLimit`),
  patrón de respaldo sin LLM (chip + el acuse fijo), `decideTurn` y traducción
  a chips sin ejecutar nada.
- **Compatibilidad:** `/api/agent/profile` crece solo de forma aditiva (el
  PUT acepta `name: null`; el GET añade `displayName` y
  `hasUnpublishedDraft`). `/api/bot/profile` conserva su forma; su KB es el
  compartido + el propio del general. El general siempre usa el KB
  compartido.
- **Rutas** `/api/lab/agents/*`, `/api/lab/preview` (tabla del plan). Errores
  tipados: `agent_limit`, `agent_assigned`, `agent_general`,
  `not_published`, `preview_rate_limited`.
- **UI:** `/lab` (Agentes) · `/lab/evaluaciones` · `/lab/agents/[id]`;
  pestañas con un `SectionTabs` genérico extraído de `CampaignsTabs`;
  burbuja `MessageBubble` extraída de `MessageThread`.

### Pruebas

- Caracterización de `runAgentTurn` (BD real, LLM y emisor simulados) y
  prueba dorada del prompt, verdes antes y después del refactor.
- Migración re-ejecutable; una organización con `agent_profile` queda con un
  general publicado equivalente; `ensureGeneralAgent` concurrente crea uno.
- Unicidad (2.º general falla), atomicidad de publicar + espejo + bitácora,
  «hacer general» nunca deja 0 ni 2, el espejo nunca toca `enabled`,
  `bot-profile.test.ts` sin editar.
- Sandbox de la vista previa (nada escribe salvo `ai_usage`), rate limit
  (31.ª → 429), cuota, prompt con y sin nombre.
- RLS, FKs compuestas, permisos (Coordinador/Asesor → 403), módulos
  (`lab`/`agent` apagado → 404), `tenant-query-guard` y `system-db-guard`
  sin excepciones nuevas.
- E2E `scripts/e2e-agentes.mjs` (parte A): crear agente sin nombre, vista
  previa con chips, publicar, evaluar con snapshot.

## PR B — Agentes por etapa

### Historias

1. **Activación por etapa.** En el editor, sección Activación: el agente
   (publicado, no general) atiende una o varias etapas; si una etapa ya tiene
   otro agente se muestra y reemplazarlo pide confirmación (`stage_taken`
   con la lista de conflictos). Publicar puede asignar en la misma
   transacción.
2. **Mapa de etapas** arriba de la lista de agentes: cada etapa del pipeline
   con su agente o «General».
3. **Resolución:** conversación real + módulo `lab` encendido → etapa del
   lead → agente asignado (no archivado y publicado); si no, el general. Una
   asignación a un agente archivado o sin publicar se ignora (`log.warn`).
4. **Bandeja:** en «IA en esta conversación», «Atiende: <nombre> · etapa X»
   o «Agente general» (`peekAgentForConversation`, solo lectura).
5. **Línea de tiempo:** `agent_changed` cuando el agente que responde cambia
   entre turnos reales (`conversation.last_agent_id`; el primer turno solo
   fija el valor).

### Diseño

- **Datos (0036):** `agent_stage_assignment` (PK `(organization_id,
  stage_id)` = 1 agente por etapa; FKs compuestas cascade a `pipeline_stage`
  y `agent`; RLS). `conversation.last_agent_id` (sin FK).
- Rutas `PUT /api/lab/agents/[id]/assignments`, `GET /api/lab/assignments`.
- «Hacer general» quita las etapas del agente promovido en la misma
  transacción (el general no tiene etapas).

### Pruebas

- Resolución completa (etapa con agente, sin agente, archivado, sin
  publicar, `lab` apagado, override de prueba, silencios de siempre).
- Unicidad por etapa y carrera de dos publicaciones (una gana, la otra
  `stage_taken`).
- `agent_changed` solo cuando cambia, solo en turnos reales.
- E2E (parte B): publicar en «Interesado» → un lead ahí recibe respuesta de
  ese agente → moverlo a «Nuevo» → responde el general → la línea de tiempo
  registra el relevo → apagar `lab` desde `/platform` → responde el general.

## PR C — Recuperación de conocimiento

### Historias

1. **KB grande sin inflar el prompt.** Si el KB del agente renderizado mide
   ≤ `AGENT_KB_FULL_INJECT_MAX_CHARS` (default 24 000) se inyecta completo
   como hoy; si no, se recuperan las 8 entradas más relevantes para los
   últimos 3 mensajes del cliente + las marcadas «Incluir siempre», con tope
   duro de caracteres, y el prompt avisa que solo ve una parte.
2. **Medidor con modo**: «completo» o «por relevancia».
3. **«Por qué respondió así»** lista las entradas usadas.

### Diseño

- **Datos (0037):** `kb_entry.search_text text NOT NULL default ''`,
  `always_include boolean NOT NULL default false`, índice GIN
  `to_tsvector('simple', search_text)`. `search_text` lo calcula la única
  puerta de escritura del KB; las filas existentes se rellenan con un paso
  de arranque idempotente por lotes, y mientras una organización tenga
  filas sin rellenar se inyecta completo (sin perder entradas).
- `retrieveKnowledge({ entries, query, historyUserTexts })` en
  `src/server/agents/retrieval.ts` tras una interfaz estable; tokens
  saneados y pasados como parámetro (nunca interpolados en `to_tsquery`).

### Pruebas

- Modo completo vs. por relevancia, `always_include`, saneo (comillas, `&`,
  `|`, `:`, `'`).
- Evaluación del recuperador: ≥ 40 entradas en español mexicano y ≥ 15
  preguntas (modismos, sin acentos, faltas de ortografía) con la entrada
  correcta en el top-8. Si no pasa, no se fusiona.
