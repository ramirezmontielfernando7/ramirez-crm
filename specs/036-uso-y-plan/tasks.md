# 036 — Tareas

## PR 1 — Consumo por agente

- [x] T1 Esquema `aiUsageAgent` + migración `0042_consumo_por_agente.sql` (aditiva, idempotente, FK compuesta, RLS forzado) + reversa `scripts/sql/0042-reversa.sql`.
- [x] T2 `recordAgentUsage` / `getAgentUsage` / `isAgentKind` en `src/server/ai-quota/quota.ts`.
- [x] T3 `chatJsonForOrg(…, { agentId })`: anota al agente sin tumbar el turno; el `agentId` no llega al proveedor.
- [x] T4 Llamadores: turno real y Laboratorio (`DecideInput.agentId`), vista previa, juez (`snapshot.agentId`).
- [x] T5 Pruebas: unitarias `tests/unit/ai-usage-agent.test.ts` (+ judge, kb-docs-prompt, lab-preview-sandbox), BD `tests/db/consumo-agente.test.ts` (RLS, aislamiento, FK, concurrencia, cascada, fallo al anotar), E2E `scripts/e2e-agentes.mjs` (vista previa, evaluación, turno real, agente de etapa).

## PR 2–6

Pendientes; ver spec.md.
