# 037 — Tareas

## PR 1 — Grupos

- [x] T1 Esquema + migración (aditiva, idempotente, RLS, FK compuestas, CHECK) + reversa.
- [x] T2 Reglas puras de grupos en `src/lib/kb-docs.ts` + unitarias.
- [x] T3 `store.ts`: CRUD de grupos (candado, tope, nombre único), mover documento, listar por grupo, subir a un grupo, borrar grupo (mover o eliminar documentos) con conteos de impacto.
- [x] T4 Rutas `/api/lab/document-groups*`, `PATCH /api/lab/documents/[id]`, `?group=` y `groupId` + tabla de permisos.
- [x] T5 Pantalla: subpestañas de grupos, «+ Grupo», renombrar, eliminar (D2), mover documento; móvil.
- [x] T6 `tests/db/grupos-documentos.test.ts` (RLS, FK compuestas, tope concurrente, borrar con mover/eliminar, recuperación sin cambios).
- [x] T7 E2E: `scripts/e2e-documentos.mjs` + `tests/e2e/us-documentos.md`.

## PR 2 — Fuentes por agente

- [x] T8 `docSources` en la config (escritura validada, lectura tolerante, `sameConfig`, `ensure`).
- [x] T9 `DocScope` obligatorio en la recuperación; filtro en SQL y en la caché de vectores.
- [x] T10 Pipeline, vista previa, snapshot/runner con el scope del agente.
- [x] T11 Selector en el editor + «Por qué respondió así» con el grupo.
- [x] T12 Matriz de filtro en tests/db + E2E.

## PR 3 — Exclusivos

- [ ] T13 Subir y listar exclusivos desde el editor (aviso «aplican al momento»).
- [ ] T14 Archivar con D3 en la misma transacción.
- [ ] T15 Uso «N exclusivos», tests/db, E2E, `CLAUDE.md`, `docs/conocimiento-rag.md`.
