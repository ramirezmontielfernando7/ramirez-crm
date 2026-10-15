# 040 — Tareas

- [x] Migración `0050_biblioteca_planes.sql` (CHECK de `plan_key`, `knowledge_entry.show_in_chat`, `kb_document.knowledge_entry_id` con FK compuesta SET NULL, índice único parcial, relleno del plan). Idempotente.
- [x] `PLAN_KEYS`/`PLAN_LABEL` (`src/lib/limits.ts`), `planKeyOf`/`planKeyOfModules`/`planToggles` (`src/lib/platform-modules.ts`).
- [x] `syncPlanKey` (`src/server/limits/`) en el alta, cambios de módulos (con bitácora) y topes; `plan` en `POST …/modules` aplica una plantilla.
- [x] Puente `src/server/library/` (`bridge.ts`, `http.ts`, `view.ts`) sobre las dos puertas.
- [x] Rutas: `POST /api/lab/documents` (`chat`), `PATCH /api/lab/documents/[id]` (`chat`), `DELETE` (borra el original oculto), `GET/POST /api/knowledge` (`scope=library`, `rag`, `ragGroupId`), `PATCH /api/knowledge/[id]` (rehace la IA), `PATCH /api/knowledge/[id]/destinations`; envío solo con `getKnowledgeForChat`.
- [x] UI: insignias e interruptores (`components/library/destinations.tsx`) en Biblioteca y Documentos; «Entrenar también al Agente» en el editor de la Biblioteca.
- [x] /platform: pestañas nuevas, tabla con filtros (`src/lib/platform-orgs.ts`), ficha en 4 pestañas (`organization-detail.tsx`), Webhooks sin ruta y Administradores y auditoría (`/api/platform/webhooks`, `/api/platform/admins`, `/api/platform/organizations/[id]/summary`).
- [x] Pruebas unitarias, de BD y E2E.
