# 035 — Tareas

- [x] T1 Esquema + migración `0040_documentos_rag.sql` (aditiva, idempotente, RLS forzado, FK compuesta) + reversa `scripts/sql/0040-reversa.sql`.
- [x] T2 Adaptador `src/lib/ai/embeddings.ts` con prefijos e5 + `embedForOrg` (única puerta, `ai_usage.kind = 'embed'`, tope opcional).
- [x] T3 Reglas puras `src/lib/kb-docs.ts` (formatos, fragmentación, consulta léxica sin acentos, RRF, presupuesto, saneado).
- [x] T4 `src/server/kb-docs/`: flag, límites, store (puerta única), extract (unpdf), indexer (in-process + arranque), retrieve (caché de vectores por organización).
- [x] T5 Turno: `loadTurnContext` y la vista previa recuperan; `decideTurn` inyecta la sección delimitada con nonce; `DecisionMeta.docChunkIds`.
- [x] T6 Rutas `/api/lab/documents*` (permiso `agent.manage`, módulo `lab`, `KB_DOCS`) + tabla de permisos.
- [x] T7 Pantalla Laboratorio → Documentos (lista, subir, estado con refresco, reindexar, eliminar, uso contra límites).
- [x] T8 Mock de embeddings (exige prefijos e5) + ai-mock con documentos (obedece lo que se escape del bloque).
- [x] T9 Pruebas: unitarias (adaptador/prefijos, reglas, extracción, prompt/inyección, puertas, mock), `tests/db/documentos.test.ts` (aislamiento, RLS, FK, límites, degradación, turno), E2E `scripts/e2e-documentos.mjs` + CI.
- [x] T10 Operación: `docker-compose.yml` (perfil `rag` con `mem_limit`/`cpus`), `scripts/kb-limits.mjs` (en `/app/ops/`), `.env.example`, guía `docs/conocimiento-rag.md`, `CLAUDE.md`.
- [ ] T11 Medir la RAM real del contenedor TEI con `scripts/kb-medir-ram.mjs` y fijar `mem_limit` con el número medido (bloqueado: el entorno de desarrollo no tiene salida a ghcr.io ni a huggingface.co).
