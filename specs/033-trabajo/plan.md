# 033 — Plan (PR 1: estructura + Tareas)

## Datos — `drizzle/0037_trabajo_tareas.sql` (aditiva, idempotente)

- `organization_module.trabajo boolean DEFAULT false NOT NULL`.
- `work_task`: `id`, `organization_id`, `title` (1–200, CHECK),
  `description`, `due_at`, `assignee_user_id`, `created_by`, `contact_id`,
  `conversation_id`, `done_at`, `done_by`, `created_at`, `updated_at`.
  `UNIQUE (organization_id, id)`. FKs compuestas a `contact` y
  `conversation` con `ON DELETE SET NULL (columna)`; personas → `user(id)`
  SET NULL. Índices `(org, assignee, done_at)` y `(org, contact_id)`.
  RLS forzado con la política de la 0027.
- Reversa opcional: `scripts/sql/0037-reversa.sql`.

## Módulos

- Clave nueva `trabajo` en el registro, sin entrada propia (`route: null`).
- La entrada de `agenda` pasa a «Trabajo» (`/trabajo`), con `anyOf` (existe
  con `agenda` o `trabajo`) y `alsoActive: ["/bookings"]`. Conservar la clave
  mantiene el orden guardado en Ajustes → Navegación.
- `OrgModules.trabajo`, lectura/escritura en `store.ts`, perfiles, /platform.

## Permisos

`work.manage` (Propietario, Coordinador). Las rutas `/api/work/*` llevan
`withAuth` + `moduleOff(org, "trabajo")`; el filtro por autor/responsable
vive en `server/work/tasks.ts` (lista `POR_AUTOR` en permissions-routes).

## Constitution Check

- I/III (aislamiento): RLS + FKs compuestas + `scoped()`; contacto mostrado
  solo vía `scopedContacts`. ✅
- II (soberanía): sin dependencias nuevas. ✅
- IV (idempotencia): migración re-ejecutable (`pnpm test:db` la aplica ×2). ✅
- Sandbox: Tareas no tiene ningún camino a `server/inbox/send` ni a Meta. ✅
- Módulos (029): por organización, apagado por defecto, 404 sin él. ✅
- V/IX: unit + BD real + e2e `scripts/e2e-trabajo.mjs`.
