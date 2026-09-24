# 020 — Roles y asignación de chats

**Estado:** implementado · guion E2E [`tests/e2e/us-roles.md`](../../tests/e2e/us-roles.md)
(`pnpm test:e2e:roles`).

## Problema

Vocero tenía dos roles de hecho (`owner` y `member`) y cinco chequeos sueltos
`session.role !== "owner"`; el resto de la configuración (WhatsApp, webhook,
agente, plantillas, etapas…) no validaba rol. Todo el equipo veía todos los
chats y no existía "a quién le toca este lead".

## Roles

| Puede… | Propietario | Coordinador | Asesor |
|---|:-:|:-:|:-:|
| Ver chats, leads, citas y resultados de **todo el equipo** (`scope.all`, `results.all`) | ✓ | ✓ | solo lo asignado |
| Asignar y reasignar, también en lote (`assignment.manage`) | ✓ | ✓ | — |
| Crear/editar/borrar etapas (`pipeline.edit`) — mover SUS leads lo puede todo rol | ✓ | ✓ | — |
| Subir/editar/sincronizar plantillas (`templates.manage`) | ✓ | ✓ | — |
| Ver el equipo (`users.read`) | ✓ | ✓ | — |
| Cuentas y roles (`users.manage`) | ✓ | — | — |
| Marca, WhatsApp, webhooks, canales, agenda, anuncios (`settings.manage`) | ✓ | — | — |
| Agente de IA, base de conocimiento, Laboratorio (`agent.manage`) | ✓ | — | — |
| Exportar contactos (`contacts.export`; aún no hay exportación) | ✓ | — | — |

La matriz vive en UN lugar: `src/lib/auth/permissions.ts`, declarada con el
control de acceso del plugin `organization` de better-auth (`createAccessControl`
+ `organization({ ac, roles })`). Un rol desconocido no puede nada.

## Decisiones

- **D1 — La asignación vive en el contacto** (`contact.assigned_user_id`). El
  lead es 1:1 con el contacto y hay una conversación real por contacto; las
  citas y la analítica ya cruzan por `contact_id`. Una sola fuente de verdad
  para lead + chat + citas + resultados.
- **D2 — Una sola puerta escribe la asignación**
  (`src/server/assignment/assign.ts`) y anota cada movimiento en
  `contact_assignment_event` (append-only, patrón `lead_stage_event`):
  de quién, a quién, quién lo movió, cuándo, `source`
  (`manual`/`lote`/`auto`/`sistema`/`migracion`), motivo y `batch_id`.
- **D3 — Filtro central.** `scopedContacts()` / `scopedConversations()` /
  `scopedMediaAssets()` en `src/lib/db/tenant.ts`, hermanos de `scoped()`. Para
  quien ve todo son idénticos a `scoped()`; al asesor le añaden "el contacto
  está asignado a mí". La sesión trae su `access` armado.
- **D4 — Lo ajeno es 404, no 403.** Un asesor que pide el lead de otro recibe
  lo mismo que si no existiera.
- **D5 — Permisos en el servidor.** `withAuth(handler, { permission })`
  responde 403 antes de ejecutar el handler. La UI solo esconde
  (`useViewer().can(...)`) y las páginas redirigen a la Bandeja.
- **D6 — SSE filtrado por suscriptor** (`src/server/events/visibility.ts`): al
  asesor solo le llegan eventos de sus chats; falla cerrado.
- **D7 — Leads nuevos sin asignar.** `createLeadForContact` consulta una
  estrategia de reparto (`src/server/assignment/strategy.ts`); hoy `manual`
  devuelve null. El round-robin será otra estrategia que lea
  `assignment_settings` (ya en el esquema). El alta manual de un asesor queda
  asignada a él.
- **D8 — Handoff.** El chat trae `assignee`; asignado a mí + handoff =
  "Requiere tu atención"; sin asignar + handoff = "Requiere humano · sin
  asignar" para quien reparte.
- **D9 — Equipos de ventas: solo esquema.** `sales_team` (un
  `coordinator_user_id` por equipo) y `member.sales_team_id`. Sin interfaz. No
  se usa el `team` de better-auth: cambia la sesión (`activeTeamId`) y no sabe
  de coordinadores.
- **D10 — Migración segura** (`0015_roles_y_asignacion`, re-ejecutable): todo
  queda sin asignar, `owner` intacto, y el antiguo `member` pasa a
  `coordinador` (convertirlo en asesor le vaciaría la bandeja de golpe).

- **D11 — El alta de un duplicado no delata a nadie.** Si el teléfono ya
  existe, `POST /api/contacts` solo dice «Ya existe un contacto con ese
  teléfono» (409 `duplicate`) a quien puede ver ese contacto (Propietario,
  Coordinador o el asesor asignado). A un asesor sin acceso le responde como a
  un dato inválido: 422 `invalid`, «No se pudo crear el contacto, verifica los
  datos e intenta de nuevo».

## Fuera de alcance

Reparto automático (round-robin), interfaz de equipos de ventas y la
exportación de contactos (el permiso ya existe para cuando llegue).
