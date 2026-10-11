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

## PR 4 — Plataforma → Organizaciones

- [x] T10 `src/server/platform-admin/usage.ts` (resumen agrupado + detalle con RLS), `agentNames`, `getManyOrgModules`.
- [x] T11 Rutas: `usage` en la lista y `GET /api/platform/organizations/[id]/usage` (404 a quien no es administrador; en `permissions-routes`).
- [x] T12 UI: pestañas, lista minimalista con fila desplegable, medidores (`src/lib/usage.ts`), «x/12» (`src/lib/platform-modules.ts`); celular y modo oscuro.
- [x] T13 Pruebas: unitarias `platform-usage.test.ts`, BD `plataforma-consumo.test.ts`, E2E `e2e-plataforma.mjs` (consumo real, escritorio, celular oscuro sin desplazamiento horizontal) y `e2e-modulos.mjs` (interruptor dentro del detalle).

## PR 3a — Plan, topes, bloqueos y avisos

- [x] T14 Migración `0045_limites_avisos_costos` + reversa `scripts/sql/0045-reversa.sql`.
- [x] T15 `src/server/limits/` (topes vigentes, guardado, bloqueos, avisos, revisión cada 6 h) + `src/lib/limits.ts`.
- [x] T16 Bloqueos en Documentos, Conocimientos, chat de equipo, altas de personas, módulos; tope de embeddings propio.
- [x] T17 Permiso `usage.read`, `/api/usage/alerts`, aviso en la app; `/api/platform/organizations/[id]/limits` y «Plan y topes».
- [x] T18 Pruebas: `tests/unit/limits.test.ts`, `tests/db/limites.test.ts`, E2E `e2e-plataforma.mjs` (sección 4c).

## PR 3b — Panel de costos (sin migración)

- [x] T19 Adaptador: `usage.cost` → `LlmUsage.costUsd` (chat y embeddings) y log con el id de la generación; ai-mock lo manda a $3/$15.
- [x] T20 `cost_usd` en `recordUsage`, `recordAgentUsage`, `recordEmbedUsage`.
- [x] T21 `src/lib/costs.ts` (estimado, historial «vigente desde», proyección, USD/moneda local) + `src/server/costs/` (precios, reporte).
- [x] T22 `GET/POST /api/platform/pricing`, `GET /api/platform/costs`, pestaña Plataforma → Costos.
- [x] T23 Pruebas: `tests/unit/costs.test.ts`, adaptadores, `tests/db/costos.test.ts`, E2E `e2e-plataforma.mjs` (sección 4d).

## PR 3c, 5 y 6

Pendientes; ver spec.md.
