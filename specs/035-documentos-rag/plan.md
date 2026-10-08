# 035 — Plan técnico

## Datos (migración `0040_documentos_rag.sql`, solo aditiva)

- `kb_document` (`kbd_`): `organization_id` → organization CASCADE, `title`,
  `filename`, `mime` (CHECK txt/md/pdf), `byte_size`, `char_count`,
  `content_sha256` (UNIQUE por organización: no se sube dos veces), `text`
  (para reindexar), `status` (CHECK `pending|processing|ready|failed`),
  `error_code`, `chunk_count`, `embedding_model` (NULL = solo texto),
  `uploaded_by_user_id` → user SET NULL, `created_at`, `updated_at`,
  `indexed_at`. `UNIQUE(organization_id, id)`.
- `kb_chunk` (`kbc_`): `organization_id`, `document_id`, `ordinal`,
  `content` (CHECK ≤ 2 000), `tsv` (`to_tsvector('spanish', content)`
  generada, índice GIN), `embedding real[]`, `embedding_model`. FK compuesta
  `(organization_id, document_id)` → `kb_document` CASCADE.
- `kb_document_limit`: `organization_id` PK, `max_file_bytes`,
  `max_documents`, `max_chunks` (NULL = valor del entorno). La edita el
  operador con `scripts/kb-limits.mjs` (`/app/ops/`).
- Las tres con `ENABLE` + `FORCE ROW LEVEL SECURITY` y la política
  `aislamiento_por_organizacion`.

## Código

| Pieza | Archivo |
|---|---|
| Adaptador `/v1/embeddings` (prefijos e5, lotes, timeout, sin excepciones) | `src/lib/ai/embeddings.ts` |
| Única puerta + uso por organización | `src/server/ai-quota/embed.ts` (+ `recordEmbedUsage` en `quota.ts`) |
| Reglas puras (formatos, fragmentación, coseno, RRF, consulta léxica, saneado) | `src/lib/kb-docs.ts` |
| Interruptor `KB_DOCS` (único lector) | `src/server/kb-docs/flag.ts` |
| Límites | `src/server/kb-docs/limits.ts` |
| Única puerta de `kb_document`/`kb_chunk` | `src/server/kb-docs/store.ts` |
| Extracción de texto (unpdf) | `src/server/kb-docs/extract.ts` |
| Indexado in-process + reanudación al arrancar | `src/server/kb-docs/indexer.ts` |
| Recuperación por turno (caché de vectores por organización) | `src/server/kb-docs/retrieve.ts` |
| Sección del prompt | `src/server/ai/prompts.ts` (`renderDocs`) |
| Turno | `src/server/ai/pipeline.ts` (`loadTurnContext` recupera; `DecideInput.docs`) |
| Vista previa | `src/server/agents/preview.ts` |
| Rutas | `src/app/api/lab/documents/**` |
| Pantalla | `src/app/(app)/lab/documentos/page.tsx` + `src/components/lab/documents-client.tsx` |
| Mock de embeddings (exige prefijos e5) | `src/app/api/dev/ai-mock/v1/embeddings/route.ts` |

## Recuperación

Consulta = los últimos 2 mensajes del cliente (máx. 500 caracteres). Léxica:
`to_tsquery('spanish', 't1 | t2 …')` con palabras saneadas, top 8 por
`ts_rank_cd`. Vectorial (si hay vectores del modelo actual): coseno contra la
consulta embebida (timeout 3 s; si falla, solo léxica), top 8 con coseno ≥
`KB_DOCS_MIN_SIMILARITY` (0,80 por defecto para e5). Fusión RRF (k = 60),
máx. 4 fragmentos y 4 000 caracteres. La consulta embebida y el modelo se
llaman FUERA de transacción.

## Juez y personas (para un PR futuro, no aquí)

Las personas del Laboratorio son guiones fijos de ferretería
(`src/server/lab/personas.ts`); el Juez sí recibe la config real. Con los
documentos indexados se podrán (a) generar guiones por organización a partir
de títulos y fragmentos y congelarlos en el snapshot, y (b) pasar al Juez los
fragmentos que el agente tuvo a la vista (`DecisionMeta.docChunkIds` ya se
registra).
