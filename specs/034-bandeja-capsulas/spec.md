# 034 — Bandeja: cápsulas, estado de IA, archivar y eliminar

**Carril**: ciclo completo (toca el modelo de datos: `conversation.archived_at`,
migración `0039`). Un solo PR. Decisiones del dueño (2026-10-07): eliminar
borra SOLO la conversación y sus mensajes (el contacto y su lead se
conservan); un mensaje entrante desarchiva el chat; el estado de IA viaja en
el DTO de la lista.

## Problema

La fila de la Bandeja mostraba etiquetas pequeñas sin jerarquía y un texto
largo en naranja («Requiere humano · sin asignar»); no había forma de archivar
ni de eliminar un chat; los chats que nacían de un mensaje enviado desde el
teléfono del negocio (`smb_message_echoes`) llegaban sin etapa.

## Comportamiento observable

1. **Tres cápsulas en una línea**, debajo del preview: `[Etapa ▾] · [Alumno +2 ▾] · [Sin asignar ▾]`.
   Cada una es un botón con su propio menú; tocarla NO abre el chat; se
   cierra al tocar fuera o con Escape.
   - **Etapa**: etapas del pipeline, la actual marcada; cambia sin recargar
     (`PATCH /api/pipeline/leads/[id]`). Una etapa *perdida* no se elige aquí
     (pide motivo: se captura en Detalles). Un chat sin lead dice «Sin etapa».
   - **Etiquetas**: la primera y `+N`; menú con buscador, marcar/desmarcar
     (`PUT /api/contacts/[id]/tags`) y, con `tags.manage`, «Crear «x»».
   - **Asignado**: la persona o «Sin asignar»; menú con el equipo
     (`POST /api/assignments`). Sin `assignment.manage` solo informa.
2. **Fix de echoes**: el chat que nace de un echo crea su lead en la primera
   etapa abierta (`createLeadForContact`, el mismo camino que el entrante);
   idempotente y sin mover un lead que ya existe.
3. **Estado de IA = solo un ícono** junto al nombre: punto verde = IA activa;
   naranja = en pausa / requiere humano; sin ícono = sin bot (agente apagado y
   sin cerebro externo visto en 24 h). El texto completo vive en Detalles.
4. **Filtro «Etiqueta»** en el menú «Todas» (por defecto «Toda etiqueta»).
5. **Archivar**: clic derecho (escritorio) o pulsación larga de 500 ms (touch)
   en la fila, o el «⋯» del chat abierto → «Archivar» / «Recuperar» /
   «Eliminar». Archivado = fuera de la Bandeja principal, conservado en BD;
   se ve en el filtro «Archivados» (junto a «Todas» y «No leídas»). Un mensaje
   entrante lo desarchiva.
6. **Eliminar** (permanente): solo `conversation.delete` (Propietario y
   Coordinador). Diálogo: «Esta acción eliminará el chat y todos sus mensajes
   de forma permanente. No se puede deshacer.» con «Cancelar» y «Eliminar
   permanentemente» (rojo). El servidor valida el permiso ANTES de tocar nada
   (403). Cascada por FK: mensajes, y también la atribución de anuncio y los
   eventos de conversión de ese chat. El contacto y el lead se conservan.

## Piezas

| Qué | Dónde |
|---|---|
| Migración | `drizzle/0039_bandeja_archivar.sql` |
| ÚNICA puerta de archivar/eliminar | `src/server/inbox/lifecycle.ts` |
| Reglas puras (filtro por etiqueta, archivados, quién elimina) | `src/lib/inbox-filters.ts` |
| Lista (lead, etapa, etiquetas y «¿hay bot?» en UNA consulta, con el filtro del asesor) | `src/server/inbox/queries.ts` |
| Permiso | `conversation.delete` en `src/lib/auth/permissions.ts` |
| Rutas | `PATCH {archived}` y `DELETE /api/conversations/[id]` |
| UI | `src/components/inbox/` — `chat-capsules`, `floating-menu`, `conversation-actions`, `use-long-press`, `use-inbox-catalogs` |

## Decisiones y trampas

- Etiquetas y «¿hay bot?» van como subconsultas de la consulta de la lista:
  `tests/unit/assignment-scope.test.ts` exige que TODA consulta de la ruta
  lleve el filtro de asignación del asesor; una consulta aparte lo rompe.
- Los menús van en un portal con `position: fixed` (la lista tiene `overflow`
  y un menú absoluto se recortaría). Los eventos de React suben por el portal
  hasta la fila: el menú frena `click` y `pointerdown`. El scroll previo al
  abrir (el navegador entrega el evento un fotograma tarde) no lo cierra.
- Pulsación larga: se cancela si el dedo se mueve > 8 px (scroll) y se traga
  el `click` posterior. Android además dispara `contextmenu`: ambos caminos
  abren el mismo menú. La fila lleva `-webkit-touch-callout: none`.
- La eliminación no avisa por SSE a otras sesiones (el chat ya no existe, así
  que `conversation.updated` no tiene a quién llegar): se enteran en el
  siguiente refetch. Quien elimina lo ve al instante.
- Chats anteriores a este PR que nacieron de un echo siguen sin lead hasta
  que haya otro echo/entrante; la cápsula dice «Sin etapa».

## Pruebas

- Unit: `tests/unit/inbox-filters.test.ts`, matriz de permisos y de rutas.
- Integración (`tests/db/bandeja-archivar-eliminar.test.ts`): archivar y
  recuperar, entrante desarchiva, eliminar con permiso (cascada), 403 sin
  permiso, 404 de otra organización, echo con etapa (idempotente), lista.
- E2E: `scripts/e2e-bandeja-capsulas.mjs` (navegador real; desktop y tablet
  con pulsación larga; Propietario y Asesor).
