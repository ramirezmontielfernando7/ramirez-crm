# 036 — Tareas

## PR 1 — Consumo por agente

- [x] T1 Esquema `aiUsageAgent` + migración `0042_consumo_por_agente.sql` (aditiva, idempotente, FK compuesta, RLS forzado) + reversa `scripts/sql/0042-reversa.sql`.
- [x] T2 `recordAgentUsage` / `getAgentUsage` / `isAgentKind` en `src/server/ai-quota/quota.ts`.
- [x] T3 `chatJsonForOrg(…, { agentId })`: anota al agente sin tumbar el turno; el `agentId` no llega al proveedor.
- [x] T4 Llamadores: turno real y Laboratorio (`DecideInput.agentId`), vista previa, juez (`snapshot.agentId`).
- [x] T5 Pruebas: unitarias `tests/unit/ai-usage-agent.test.ts` (+ judge, kb-docs-prompt, lab-preview-sandbox), BD `tests/db/consumo-agente.test.ts` (RLS, aislamiento, FK, concurrencia, cascada, fallo al anotar), E2E `scripts/e2e-agentes.mjs` (vista previa, evaluación, turno real, agente de etapa).

## PR 2 — Medición de almacenamiento

- [x] T6 Reglas puras `src/lib/usage.ts` (etiqueta «Almacenamiento (aprox.)», nota, categorías, fórmula de documentos, unidades).
- [x] T7 `src/server/usage/storage.ts`: por organización (pool de la app, `scoped()`) y de todas (pool de sistema, agrupado). Solo lectura.
- [x] T8 Guardarraíles: `system-db-guard` (1 uso), `tenant-query-exceptions` (5), `kb-docs-gate` (lector permitido que solo lee) y vigilancia de que no depende de agente/grupo.
- [x] T9 Pruebas: unitarias `tests/unit/usage-storage.test.ts`, BD `tests/db/almacenamiento.test.ts` (fórmula, pendientes y sin tamaño, bytes UTF-8, RLS, pool de sistema = por organización, solo lectura, cascada).

## PR 3–6

Pendientes; ver spec.md.
