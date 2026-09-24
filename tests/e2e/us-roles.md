# Guion E2E — Roles y asignación de chats

> Automatizado en `scripts/e2e-roles.mjs` (`pnpm test:e2e:roles`, app viva en
> `pnpm dev` con los mocks). Spec: [020](../../specs/020-roles-asignacion/spec.md).
> Re-ejecutable: reutiliza las cuentas del equipo y usa teléfonos nuevos.

Cuatro sesiones a la vez contra la BD real: propietario (el mismo de
`e2e-selftest.mjs`), una coordinadora y dos asesores.

1. **Equipo.** El propietario crea la coordinadora y los asesores A y B con su
   rol; el propietario sigue siendo propietario.
2. **Llega un lead.** Entra por el wa-mock y aparece **sin asignar** para el
   propietario; el asesor A no lo ve.
3. **Asignar.** La coordinadora lo asigna a A. Por SSE, A no recibió el
   mensaje mientras no era suyo y sí recibe `assignment.changed`. A lo ve
   marcado como suyo; B no.
4. **Lo de otro no existe.** B pide la ficha, el historial, los mensajes,
   escribe, marca leído, mueve el lead y edita notas → **404** en todo; no lo
   encuentra en Contactos.
5. **El asesor trabaja, no configura.** A mueve SU lead de etapa (200). Crear
   o editar etapas, sincronizar o subir plantillas, marca, WhatsApp, webhook,
   agente, usuarios, asignar, lote y resultados de B → **403**. Sus propios
   resultados sí. `/settings/whatsapp` lo regresa a la Bandeja.
6. **La coordinadora opera, no configura.** Crea y borra una etapa; marca,
   WhatsApp, agente y usuarios → 403; ve los resultados de A y al equipo.
7. **Handoff.** El cliente pide un humano: el chat queda en atención humana y
   su `assignee` es A.
8. **Vacaciones.** Un segundo lead se asigna a A; lote A → B con motivo: A deja
   de ver ambos (404), B los ve. El historial muestra los dos movimientos
   (quién, desde cuándo, quién reasignó, `lote`, motivo).
9. **Roles.** El propietario sube a B a coordinador y B ve lo sin asignar al
   instante; de vuelta a asesor, deja de verlo. El propietario no se puede
   degradar (422) y la coordinadora no cambia roles (403).
