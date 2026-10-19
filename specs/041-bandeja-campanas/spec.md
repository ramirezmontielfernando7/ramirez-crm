# 041 — Chats de campaña fuera de la Bandeja principal

**Carril**: ligero (PASO 1 del plan de rendimiento). Una migración aditiva e
idempotente (`drizzle/0051_bandeja_campanas.sql`). Pedido y diseño aprobados
por el dueño el 2026-10-19, antes de programar.

## Problema

Cuando corre una campaña masiva, cada chat que crea el envío cae en tiempo
real en la Bandeja: cientos de chats nuevos, un `message.new` por envío y un
`message.status` por cada palomita (sent/delivered/read). Cada evento hace que
cada pantalla abierta vuelva a pedir la lista completa, y a cada asesor
conectado el servidor le hace una consulta de visibilidad por evento.

## Comportamiento observable

1. **Pestaña «Campañas»** dentro de los filtros de la Bandeja (no en
   Archivados). Vive ahí todo chat al que una campaña masiva envió y cuyo
   contacto NUNCA ha escrito (`conversation.campaign_pending_id`). No
   aparece en la principal, no cuenta como no leído, no avisa en vivo. Sin
   ninguno, el filtro no aparece. La lista se pide aparte
   (`GET /api/conversations?view=campaigns`) y solo mientras la pestaña está
   abierta; la principal trae su cuántos (`campaignPending`).
2. **Al responder** (primer entrante), en la MISMA sentencia que suma el no
   leído, la marca pasa a `campaign_replied_id`: el chat vuelve a la
   principal con la cápsula «Respondió a campaña X» y desde ahí es un chat
   normal (asignación, agente, no leídos, avisos).
3. **Conversación activa previa**: si el contacto ya había escrito
   (`last_inbound_at` no nulo), el envío NO la marca: sigue en la principal y
   su envío avisa como siempre. Lo decide un `UPDATE … WHERE last_inbound_at
   IS NULL` atómico antes de enviar (`src/server/campaigns/inbox-view.ts`).
4. **Eventos en vivo**: el envío a un chat pendiente no publica `message.new`
   (`sendTemplate({ silent })`); abrirlo (marcar leído) no publica
   `conversation.updated`; los ticks de estado de CUALQUIER mensaje de
   campaña no publican `message.status` (el `UPDATE … RETURNING` de
   `status.ts` dice si el mensaje tiene `campaign_recipient`). La BD guarda
   cada estado igual. `campaign.progress` sigue a lo más uno por segundo.

## Decisiones aprobadas por el dueño

- Las palomitas de un mensaje de campaña en un chat abierto no se mueven en
  vivo; se ven al reabrir.
- Varias campañas a un chat sin respuesta: la marca muestra la más reciente.
- Chats del Laboratorio: no aplica (las campañas no les envían).
- Responder desde «Campañas» no saca el chat: sale cuando responde el contacto.

## Chats viejos

`scripts/reclasificar-campanas.mjs` (`--org <id>` o `--all`; por defecto solo
cuenta; `--apply` pide el número exacto). Solo llena columnas vacías: nunca
escribió → «Campañas»; escribió después de la primera campaña → «Respondió a
campaña X»; escribía antes → no se toca. Correrlo dos veces cambia 0. Se
aplica solo con autorización del dueño y después de una copia de seguridad.

## Fuera de alcance (Paso 2)

- `useInboxUnread` (globo del menú) y la Bandeja piden la lista COMPLETA con
  cada `message.new`/`conversation.updated`; la Bandeja sin espera entre
  ráfagas y sin usar `since=` (el contrato sse.md dice que el catch-up es con
  `since=`, el cliente no lo hace).

## Pruebas

- `tests/unit/bandeja-campanas.test.ts` — reglas puras y guardarraíles.
- `tests/db/bandeja-campanas.test.ts` — envío real con `sendRecipient`,
  ticks sin eventos, respuesta, asesor, otra organización y el script dos veces.
- `scripts/e2e-bandeja-campanas.mjs` (guion `tests/e2e/us-bandeja-campanas.md`).
