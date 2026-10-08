# 037 — Plan técnico

## Datos (una migración, solo aditiva, en el PR 1)

- `kb_document_group` (`id`, `organization_id`, `name`, `created_at`,
  `updated_at`): `UNIQUE(organization_id, id)` para las FK compuestas,
  índice único `(organization_id, lower(name))`, CHECK de 1 a 40 caracteres,
  RLS forzado con `aislamiento_por_organizacion`.
- `kb_document.group_id` NULL = General. FK compuesta
  `(organization_id, group_id)` → grupo con `ON DELETE SET NULL (group_id)`:
  quitar un grupo en la BD jamás deja documentos huérfanos.
- `kb_document.agent_id` NULL = de la empresa; si no, exclusivo. FK
  compuesta `(organization_id, agent_id)` → `agent` con CASCADE (el agente
  solo se borra de verdad con su organización; archivar lo resuelve D3).
- CHECK `kb_document_owner_chk`: `group_id IS NULL OR agent_id IS NULL`.
- Índices `(organization_id, group_id)` y `(organization_id, agent_id)`.

## Código

- `src/server/kb-docs/store.ts` sigue siendo la ÚNICA puerta de
  `kb_document`/`kb_chunk` y ahora también de `kb_document_group`
  (`kb-docs-gate.test.ts`). Crear, renombrar y borrar grupos bajo el candado
  de la organización (el tope de grupos no se pasa con altas simultáneas).
- Reglas puras en `src/lib/kb-docs.ts`: nombre de grupo, tope, clave de la
  pestaña (`general` | id), y (PR 2) `DocScope`.
- Rutas: `GET/POST /api/lab/document-groups`, `PATCH/DELETE
  /api/lab/document-groups/[id]` (DELETE con `?documents=move|delete`),
  `PATCH /api/lab/documents/[id]` (mover de grupo), `GET
  /api/lab/documents?group=` y `groupId` en la subida. Todas con
  `agent.manage`, módulo `lab` y `KB_DOCS`.
- Pantalla: `/lab/documentos` (General) y `/lab/documentos/[grupo]`, con
  `SectionTabs` como segunda fila de pestañas.

## Recuperación (PR 2)

- `retrieveForTurn(org, scope, history)` y `retrieveChunks(org, scope, q)`
  reciben `scope` OBLIGATORIO: `{ agentId, mode: "all" }` o
  `{ agentId, mode: "groups", groupIds }`.
- `scopeCondition(scope)` en `store.ts`, SIEMPRE dentro de `scoped(org, …)`:
  `(agent_id IS NULL AND <all | coalesce(group_id,'general') = ANY(ids)>) OR
  agent_id = scope.agentId`. La usan `lexicalSearch`, `chunksByIds` y
  `hasReadyDocuments`.
- Caché de vectores: una por organización (igual que hoy) con el
  `documentId` de cada vector; por turno, `allowedDocumentIds(org, scope)` y
  el coseno descarta lo que no está ahí. Mover un documento o cambiar la
  selección nunca deja permisos viejos en memoria.
- `docSources` en `agentConfigSchema` (`{ mode: "all" }` por defecto; lectura
  tolerante con `.catch`). `sameConfig`, `emptyConfig`, `configFromProfile`
  y la reconciliación de `ensure.ts` lo conservan.
- El snapshot congela `config.docSources` (+ `docScope` legible); el runner
  pasa el override y `loadTurnContext` arma el scope con él.

## Exclusivos (PR 3)

- Subida con `agentId`; lista del agente; aviso «aplican al momento».
- `archiveAgent(org, id, { exclusiveDocs: "delete" | "move_to_general" })`
  llama a `store.ts` dentro de su transacción.
