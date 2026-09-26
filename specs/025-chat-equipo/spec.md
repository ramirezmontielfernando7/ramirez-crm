# 025 — Chat de equipo (Bloque C, PR 1)

**Estado:** implementado · guion E2E [`tests/e2e/us-chat-equipo.md`](../../tests/e2e/us-chat-equipo.md)
(`pnpm test:e2e:chat`) · migración `0020_chat_interno.sql` · carril **ciclo
completo** (tablas nuevas, permisos nuevos, contrato de API y de SSE nuevos;
plan y tareas quedan en esta spec por su tamaño).

## Problema

El equipo se coordina por WhatsApp personal o por fuera del CRM: los avisos
se pierden, el Propietario no sabe qué se habla de la operación y nada queda
junto a los chats de clientes.

## Qué NO es

No es un chat con clientes. Es comunicación INTERNA entre usuarios de la
misma organización. Nada de aquí sale a Meta (no pasa por `inbox/send`).

## Historias

1. **Directos 1 a 1** entre cualquier par de miembros (uno por par, a prueba
   de carreras: `direct_key` único).
2. **Grupos** creados desde Ajustes → Chat de equipo. Crea el Propietario
   (`team_chat.create_groups`); el Propietario puede **delegarlo** al
   Coordinador con un toggle por organización — resuelto en la matriz
   (`DELEGABLE` en `permissions.ts`), no con un chequeo suelto.
3. **Canal de Avisos**, uno por organización, creado en la migración para
   las existentes y al primer uso para las nuevas. Todos participan de forma
   implícita; publican Propietario y Coordinador (`team_chat.announce`); el
   resto lee y reacciona.
4. **Mensajería**: texto (≤ 4000, validado en servidor), un adjunto por
   mensaje (≤ 16 MB; SVG y HTML bloqueados por tipo y extensión), emojis con
   frimousse (datos servidos por la instancia), reacciones, editar y borrar
   (suave) solo el autor, historial paginado (`before=<id>`, tope 100) y
   Conocimientos (destino `internal_chat` de 024).
5. **Tiempo real** por el SSE existente: eventos `team.message` y
   `team.thread` con su audiencia calculada al publicar (participantes que
   siguen en la organización + el Propietario si supervisa). La audiencia
   viaja fuera de `data` y no pasa por el atajo de `seesAll`.
6. **No leídos** por usuario e hilo (`team_chat_read_state`), globo en el
   menú (expandido: en su renglón; en íconos: sobre el logo; oculto: en el
   botón que lo reabre; teléfono: sobre el logo de la barra) y sonido corto
   (WebAudio, sin archivos). El globo vive en su propio almacén: no repinta
   el menú.
7. **Supervisión del Propietario** (`team_chat.oversee`): encendida por
   default, ve directos y grupos ajenos en **solo lectura** (no escribe, no
   reacciona, no marca leído, no suman a su globo), con aviso fijo en la
   lista. `show_oversight_notice` (default apagado): si está encendido Y la
   supervisión también, los demás ven «El Propietario puede supervisar las
   conversaciones». Solo el Propietario cambia estos ajustes.

## Decisiones

- **Tablas propias, no `sales_team`**: un canal necesita membresía
  muchos-a-muchos; `sales_team` es "un miembro, un equipo" sin código.
- **Recurso ajeno = 404**; 403 solo cuando se ve el hilo pero no se puede
  hacer eso (supervisión, editar lo de otro, publicar en Avisos).
- **Usuario removido**: sale de toda audiencia aunque su conexión SSE siga
  abierta, y sus peticiones responden 401 (sin membresía).
- **Borrado suave**: la fila queda con `deleted_at`, el texto se vacía y el
  adjunto se borra del disco.
- **Adjuntos en `MEDIA_DIR/team-chat/<org>/<hilo>/`**, aparte de
  `media_asset` (su visibilidad es por membresía, no por chat de cliente).
  Se sirven con `nosniff`, `sandbox` y `attachment` salvo imágenes raster.

## Datos (0020, aditiva y re-ejecutable)

`team_chat_thread`, `team_chat_member`, `team_chat_message`,
`team_chat_reaction`, `team_chat_read_state`, `team_chat_attachment`,
`team_chat_settings`. Todas con `organization_id` y `scoped()`.

## API

Rutas en `src/app/api/team-chat/`; en `permissions-routes.test.ts`, grupos y
ajustes en `PROTEGIDAS` y el resto en la lista nueva `POR_MEMBRESIA`.

## Pendiente (PR 2 del Bloque C)

Menciones de chats de cliente dentro de mensajes internos y participantes en
chats de WhatsApp (migración 0021).
