# 033 — Tareas (PR 1)

- [x] T1 Esquema `work_task` + `organization_module.trabajo`; migración 0037 idempotente con RLS; reversa.
- [x] T2 Módulo `trabajo` en registro, defaults, store, perfiles y /platform.
- [x] T3 Entrada de menú «Trabajo» (`anyOf`, `alsoActive`), íconos.
- [x] T4 Permiso `work.manage`.
- [x] T5 `server/work/tasks.ts` (única puerta) + `lib/work.ts` (reglas puras).
- [x] T6 Rutas `/api/work/tasks` y `/api/work/tasks/[id]`.
- [x] T7 `WorkShell` + `/trabajo`, `/trabajo/tareas`; `/bookings` dentro de Trabajo y abriendo en Lista.
- [x] T8 «Nueva tarea para este chat» en el panel del contacto.
- [x] T9 Guardias: permissions-routes, modules-routes-guard, modules-registry, permissions.
- [x] T10 BD real: `tests/db/trabajo.test.ts`.
- [x] T11 E2E: `scripts/e2e-trabajo.mjs` + `tests/e2e/us-trabajo.md`.
- [x] T12 Docs: `docs/rls.md`, `CLAUDE.md`.

## PR 2 — Notas

- [x] N1 Esquema `work_note` y migración 0038 idempotente con RLS; reversa.
- [x] N2 `server/work/notes.ts` + reglas puras en `lib/work.ts` (colores, `canEditNote`, línea de visibilidad).
- [x] N3 Rutas `/api/work/notes` y `/api/work/notes/[id]`; guardias de permisos y módulos.
- [x] N4 Pestaña Notas (`notes-client.tsx`), tokens `--note-*` con prueba de contraste.
- [x] N5 «Notas de trabajo» en el panel del contacto (`contact-notes.tsx`) con la línea de quién la ve.
- [x] N6 BD real (`tests/db/trabajo.test.ts`) y e2e (`scripts/e2e-trabajo.mjs`, sección 3b).
- [x] N7 Docs: `docs/rls.md`, `CLAUDE.md`.
