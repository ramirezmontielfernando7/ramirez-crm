# 022 — Sidebar colapsable, panel de Detalles reorganizado y línea de tiempo del chat

**Estado:** implementado · guion E2E [`tests/e2e/us-linea-tiempo.md`](../../tests/e2e/us-linea-tiempo.md)
(`pnpm test:e2e:linea`)

## Problema

La Bandeja es donde el equipo pasa el día, y se sentía pesada: el menú
lateral ocupaba espacio que el Asesor no usa, el panel de Detalles mostraba
todo a la vez, y lo que le pasaba a un chat (quién lo movió de etapa, quién
pausó la IA, qué se anotó) estaba repartido o ni siquiera quedaba registrado.
Las notas eran UN campo que cada guardado sobrescribía, sin autor ni hora.

## Historias

1. **Menú lateral colapsable (escritorio).** Un botón (hamburguesa) lo
   colapsa a íconos con resorte (≤ 250 ms); colapsado, la marca queda en su
   mosaico, cada ícono lleva tooltip, el conteo de no leídos es un punto y el
   perfil es un avatar que abre una tarjeta (nombre, rol, tema, salir).
   - Asesor: arranca **colapsado**. Coordinador y Propietario: **abierto**.
   - La elección se guarda **por usuario en BD** (`user_preference`) y sigue
     a la persona entre dispositivos. `null` = default del rol.
   - En el teléfono el cajón no cambia: siempre completo.
   - **Tercer estado: oculto.** El mismo hamburguesa recorre el ciclo
     expandido → íconos → oculto → expandido. Oculto, la columna desaparece
     y la pantalla usa TODO el ancho (sin franja); el hamburguesa para volver
     va en la fila del título de cada pantalla, alineado con el texto y
     siempre visible (sin depender de hover). Al cambiar de estado, la
     columna de contenido entera se desliza a su lugar como una sola pieza
     (solo `transform`, 220 ms, sin rebote). Se guarda en
     `user_preference.nav_mode` (`expanded|collapsed|hidden`, aditiva;
     `nav_collapsed` se sigue escribiendo y se lee si no hay `nav_mode`).
     Solo escritorio: el cajón del teléfono sigue abierto/cerrado.
2. **Resultados solo para quien mide.** Permiso nuevo `results.read`
   (Propietario y Coordinador). El Asesor no ve la entrada del menú
   (colapsado o expandido), `/results` lo regresa a la Bandeja y
   `/api/analytics/*` le responde **403**. El contenido de Resultados no cambia.
3. **Panel de Detalles, de arriba abajo:** Contacto (+ IA en esta conversación,
   intacto, + anuncio de origen) · Asignación · "Ver historial de asignación"
   (plegado; **solo** Propietario/Coordinador) · Etapa del pipeline ·
   "Más detalles" (plegado: Mensajes masivos, Etiquetas, Ficha) · Actividad.
4. **Línea de tiempo del chat ("Actividad").** Todo lo que le pasa al
   contacto, lo más reciente arriba, una línea "[acción] por [quién]" con su
   hora; lo que trae más (texto de la nota, motivo de pérdida, origen del
   consentimiento) se abre en su lugar con "ver más". El Asesor la ve
   **completa**, incluso lo que pasó cuando el chat era de otro (los cambios
   de asignación incluidos: el botón de historial se oculta por orden, no por
   secreto).
5. **Notas como eventos.** Arriba de la línea de tiempo, "Escribe una nota…"
   + "Añadir nota" (Ctrl/⌘ + Enter). Cada nota queda con autor y hora; lo que
   había en `contact.notes` se muestra como "Nota inicial". Las notas del
   agente de IA también llegan aquí ("por el agente de IA").
6. **Sensación táctil.** Expandir/colapsar con resorte (`motion`), botones y
   switches que se hunden al presionar, filas que entran escalonadas. Nada
   pasa de 300 ms; `prefers-reduced-motion` lo desactiva. Calibración:
   sutil, nunca protagonista — resorte de 200 ms con rebote 0.12, entradas
   sin rebote (180 ms, 4 px), curva CSS `ease-spring` que sobrepasa ~1 %.

## Datos

- Ya existían y se reúsan al leer: `lead_stage_event` (etapas, con actor y
  `source` bot/dueño) y `contact_assignment_event` (asignaciones).
- **Nueva** `contact_activity_event` (append-only, `organization_id NOT NULL`,
  única puerta `src/server/activity/log.ts`): `note_added`, `ai_paused`,
  `ai_resumed`, `ai_handoff`, `consent_changed`, `tag_added`, `tag_removed`,
  con `actor_user_id` + `source` (`usuario`/`bot`/`api`/`sistema`) y `detail`.
- **Nueva** `user_preference` (`organization_id`, `user_id`, `nav_collapsed`).
- Migración `0017`, aditiva y re-ejecutable. La historia de notas/IA/etiquetas
  empieza en el despliegue (antes no se registraba).

## Decisiones

- **Se registra en cada punto de escritura**, no con triggers: el switch de
  la Bandeja, el handoff del agente, la respuesta desde el teléfono
  (`manual_reply`), `/api/bot/handoff`, `/api/bot/reset`, el consentimiento
  (PATCH del contacto) y las etiquetas del contacto. Las anotaciones al margen
  (`logActivitySafe`) nunca tumban la operación que registran.
- **No se registra**: la importación masiva de CSV (etiquetas/consentimiento
  de miles de filas; su registro es el resumen de la importación) y marcar
  leído.
- La línea de tiempo se arma al leer (`src/server/activity/timeline.ts`),
  tope 200 eventos; las palabras salen de UNA función pura
  (`describeTimelineItem` en `src/lib/timeline.ts`).

## API

| Ruta | Quién | Qué |
|---|---|---|
| `GET /api/contacts/[id]/timeline` | quien ve el contacto (`scopedContacts`) | `{ items }` |
| `POST /api/contacts/[id]/notes` | quien ve el contacto | `{ text }` → 201 |
| `GET/PUT /api/preferences` | cualquier sesión, solo lo propio | `{ navCollapsed: boolean \| null }` |
| `GET /api/analytics/*` | `results.read` | 403 al Asesor |
