# C11 · Citas y reacciones de clientes

## Alcance

La rama parte de `main` en `5d9a6398300d598cd7ed048d2e8d5362be729291`.

El webhook de WhatsApp Cloud API guarda `context.id` en el mensaje recibido.
Una reacción entrante modifica una anotación y emite
`message.reaction` por SSE. El evento lleva solo `conversationId` y
`messageId`, con la visibilidad habitual de la Bandeja. La reacción conserva
los contadores, la fecha del chat, la ventana, el handoff y la IA. Tampoco
genera un mensaje ni un aviso push. Una referencia que el servidor no puede
resolver en el mismo chat se omite. La app móvil conserva su versión y
contratos de escritura.

La Bandeja web muestra las citas con salto al original si está cargado.
El menú ofrece «Responder» y «Reaccionar». El compositor muestra la cita
seleccionada y la deja quitar. Las reacciones de cliente y equipo se
distinguen por etiqueta y color. Las capturas de [claro](mockups/citas-reacciones/claro.png)
y [oscuro](mockups/citas-reacciones/oscuro.png) usan datos ficticios.

## Contrato para C12

| Método | Ruta | Contrato |
| --- | --- | --- |
| GET | `/api/conversations/{id}/messages[?since=ISO]` | Conserva los campos existentes. Cada mensaje añade `reactions` y `replyTo`. |
| POST | `/api/conversations/{id}/messages` | Texto `{ "text": "...", "replyToMessageId": "msg_..." }`. El ID interno es opcional. Con cita se devuelve `replyApplied: true/false` junto con `messageId` y, cuando corresponde, `queuedUntil`. |
| PUT | `/api/conversations/{id}/messages/{messageId}/reaction` | `{ "emoji": "👍" }` aplica o reemplaza y `{ "emoji": "" }` quita. Respuesta `{ "ok": true, "changed": true/false }`. Un emoji, con soporte para banderas, modificadores y secuencias unidas. |

Parte aditiva exacta de cada elemento en `GET.messages[]`:

```json
{
  "reactions": [
    { "direction": "in", "emoji": "👍" },
    { "direction": "out", "emoji": "❤️" }
  ],
  "replyTo": {
    "id": "msg_ejemplo",
    "direction": "in",
    "type": "text",
    "preview": "Texto ficticio del mensaje citado"
  }
}
```

`direction` es `in` (cliente) u `out` (equipo). Sin reacciones se devuelve
`[]`. Sin cita resoluble en el mismo chat se devuelve `null`. La vista previa
se limita a 120 caracteres Unicode y usa un rótulo por tipo si el texto está
vacío. Ningún ID de Meta se añade al DTO. En SSE, `message.reaction` solicita
recargar el historial de ese chat abierto. Cuando un `message.new` incluye
`hasQuote: true`, recargar el historial resuelve la cita. El evento no lleva
el texto de la cita.

```text
event: message.reaction
data: {"conversationId":"cv_ejemplo","messageId":"msg_ejemplo"}
```

Las rutas mantienen `withAuth` y la visibilidad por organización y asesor.
Una sesión ausente recibe 401. Un mensaje o chat fuera de alcance recibe
404. Los envíos conservan los errores del canal, incluido 409
`window_closed`. La reacción sobre un mensaje sin ID válido de Meta se
rechaza. Si el chat sale por conexión directa u otro canal sin cita
compatible, el texto se envía con `replyApplied: false`. En texto dividido,
solo la primera parte lleva la cita.

## Integridad y límites

RLS forzada protege la tabla nueva. La recepción valida organización,
número, chat y remitente antes de tocarla. El retiro conserva una fila con
emoji vacío para deduplicar el webhook. Se guardan los IDs vistos en el
último segundo de evento y se descartan timestamps anteriores. Eventos
distintos del mismo segundo se ordenan por llegada. Una reserva de base
serializa los envíos de reacción concurrentes y se confirma después de la
llamada a Meta. Un PUT idéntico ya confirmado devuelve `changed: false`.
Si la aceptación queda incierta, se conserva la reserva durante dos minutos
y se devuelve el error del canal. No hay reenvío automático. Un intento
manual posterior puede repetir un envío cuya confirmación se perdió.

El alcance se limita a la Bandeja de clientes de WhatsApp Cloud API. Los
grupos de conexión directa, Mi número, Instagram y Messenger conservan su
comportamiento. El historial de Clientes sigue llegando entero cuando
no se solicita `since`. La revisión física de Meta y la integración de C12
quedan pendientes.

## Migración y reversión

Migración única [0082_message_annotations.sql](../drizzle/0082_message_annotations.sql).
Se aprovecha el índice único existente de `message.wa_message_id` para
localizar el original. La reversión
[`0082-reversa.sql`](../scripts/sql/0082-reversa.sql) elimina las anotaciones
y las referencias a citas. Volver primero al código anterior y tomar
respaldo antes de ejecutar el SQL. Si se reaplica, reconciliar el registro
del migrador con el esquema restaurado en una operación autorizada.

```sql
-- C11. La misma fila conserva las bajas y los eventos entrantes ya vistos.
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "reply_to_wa_message_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_reaction" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "direction" text NOT NULL CHECK ("direction" IN ('in', 'out')),
  "emoji" text NOT NULL,
  "wa_reaction_message_id" text UNIQUE,
  "seen_wa_ids" text[] NOT NULL DEFAULT '{}',
  "event_at" timestamp,
  "pending_emoji" text,
  "pending_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "message_reaction_message_direction_uq" UNIQUE ("message_id", "direction"),
  CONSTRAINT "message_reaction_org_message_fk" FOREIGN KEY ("organization_id", "message_id")
    REFERENCES "message"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "message_reaction_org_conv_fk" FOREIGN KEY ("organization_id", "conversation_id")
    REFERENCES "conversation"("organization_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_reaction_org_conv_idx"
  ON "message_reaction" ("organization_id", "conversation_id", "message_id");
--> statement-breakpoint
ALTER TABLE "message_reaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_reaction" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "aislamiento_por_organizacion" ON "message_reaction";
--> statement-breakpoint
CREATE POLICY "aislamiento_por_organizacion" ON "message_reaction"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));
```

## Checklist de despliegue

1. Claude revisa la consulta de alcance, la reserva saliente, el contrato
   C12, la migración y la reversión.
2. En el entorno autorizado, respaldar PostgreSQL. Aplicar 0082 antes de
   servir código C11 y comprobar el estado de RLS.
3. Validar en entorno de prueba con un chat propio, una cita recibida y
   enviada, cambio y retiro de reacción y ventana cerrada. Revisar que sigue
   funcionando el cliente previo.
4. Revisar el comportamiento en tema claro y oscuro. C12 podrá integrar
   los campos y el evento una vez validado el servidor.

## Verificación local

La entrega a Meta se ejercitó con wa-mock. Las pruebas usaron datos y
credenciales desechables. La operación quedó limitada al repositorio y al
entorno local. No hubo PR, merge, despliegue ni aplicación de la migración
a una base real.

- Node 22.22.0. TypeScript y lint. Suite unitaria con 2.572 pruebas aprobadas
  de 224 archivos y una omisión propia de la suite.
- PostgreSQL 19 local con `vocero_app` sin `BYPASSRLS` y rol separado de
  sistema. Las 863 pruebas de 103 archivos pasaron, incluida
  `tests/db/rls.test.ts`. El migrador se ejecutó dos veces. Se repitió el
  SQL de 0082 y se comprobó la reversión seguida de una reaplicación en
  otra base local.
- El ensayo inicial de suites de BD con una URL de aplicación distinta de
  `http://localhost:3000` falló en OAuth porque sus fixtures fijan el
  emisor y el recurso a esa dirección. El gate pasó con la URL esperada
  y sin cambios al conector.
- Playwright pasó en la Bandeja web con wa-mock, PostgreSQL y tráfico
  limitado a loopback. Verificó la cita entrante y su salto, una reacción
  recibida por SSE sin aumentar el historial, el envío de una cita y una
  reacción con una sola petición a wa-mock por acción, el retiro y el 404
  del destino inexistente. Para repetirlo, configurar una base de prueba
  migrada, iniciar el servidor local con `WA_MOCK_ENABLED=true` y apuntar
  `META_GRAPH_BASE_URL` a su `/api/dev/wa-mock/graph`. Con el mismo
  `APP_BASE_URL` local y Chromium disponible, ejecutar
  `WA_MOCK_ENABLED=true node scripts/e2e-selftest.mjs --citas-reacciones`.
  El servidor de desarrollo corrió con Webpack. Turbopack rechazó una
  regla CSS que ya existía en la base.
- `pnpm build` completó la compilación, las comprobaciones de Next.js
  y la generación del paquete standalone en el entorno local aislado.
