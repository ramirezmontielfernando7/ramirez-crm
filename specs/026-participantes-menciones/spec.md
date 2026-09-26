# 026 — Participantes en chats de WhatsApp y menciones de chats de cliente (Bloque C, PR 2)

**Estado:** implementado · guion E2E [`tests/e2e/us-participantes-menciones.md`](../../tests/e2e/us-participantes-menciones.md)
(`pnpm test:e2e:participantes`) · migración `0021_participantes_y_menciones.sql` ·
carril **ciclo completo** (tablas nuevas, cambio del filtro central de
visibilidad, eventos SSE nuevos).

## Historias

1. **Participantes.** Varios asesores pueden ver y atender (leer, responder,
   anotar) un mismo chat de cliente además del asignado. La asignación
   principal (`contact.assigned_user_id`) sigue siendo la **única** fuente de
   verdad de "de quién es"; los participantes son un concepto aparte, con su
   tabla (`contact_participant`) y su bitácora
   (`contact_participant_event`), que sale en la línea de tiempo.
   - Los agregan y quitan Propietario y Coordinador (`assignment.manage`).
   - El asignado no entra como participante (409); alguien de fuera, 422;
     agregar dos veces es idempotente. Reasignar no borra participantes.
   - `scopedContacts()` / `scopedConversations()` / `scopedMediaAssets()`
     aceptan "asignado a mí O participo" con un solo fragmento
     (`tenant.ts`), así que la Bandeja, los mensajes, los adjuntos, las citas
     y el SSE los incluyen sin tocar cada ruta. Índice
     `(organization_id, user_id)` + PK `(contact_id, user_id)` para el EXISTS.
2. **Aviso de handoff** (`handoff.requested`, aparte de
   `conversation.updated`): chat asignado → al asesor asignado, a los
   Coordinadores y al Propietario; chat sin asignar → Coordinadores y
   Propietario, como hoy. **Los participantes no lo reciben** (sí ven el
   cambio de estado del chat). Lo publican el agente, el cerebro externo y la
   respuesta manual desde el teléfono. En pantalla: toast con sonido y "Ver
   chat".
3. **Menciones de chats de cliente** dentro del chat de equipo.
   - El botón `@` del compositor busca entre los chats que quien escribe ve;
     el editor muestra `@{Nombre}` y al enviar se guarda el marcador
     `@[chat:<id>]` (el nombre nunca se guarda).
   - El servidor valida que el autor vea cada chat mencionado (si no, 422
     sin decir cuál); tope de 10.
   - Al leer, cada mención se resuelve **por quien lee**: con acceso,
     nombre y contacto para navegar (`/inbox?contact=…`); sin acceso,
     `{ accessible: false }` y nada más. El texto viaja con marcadores por
     posición (`@[m:i]`), la vista previa dice "@chat" y el evento SSE va
     neutro (`needsResolve`), así que el id tampoco se filtra (criterio 404).

## Datos (0021, aditiva y re-ejecutable)

`contact_participant`, `contact_participant_event`. Las menciones usan
`team_chat_message.mentions` (creada en 0020).

## API

- `GET /api/contacts/[id]/participants` (FILTRADAS: quien ve el chat).
- `POST` / `DELETE /api/contacts/[id]/participants` (PROTEGIDAS:
  `assignment.manage`).
- `GET /api/team-chat/messages/[id]` (POR_MEMBRESIA): el mensaje con las
  menciones resueltas para quien pregunta.
