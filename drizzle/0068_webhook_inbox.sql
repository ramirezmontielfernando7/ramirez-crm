-- Auditoría DF-03: los webhooks se GUARDAN antes de responder «recibido».
--
-- `webhook_inbox` (PLATAFORMA, sin organización ni RLS, solo pool de
-- sistema): cada evento firmado de Meta y cada aviso de mensajes del
-- dispositivo vinculado entra aquí, CIFRADO, antes del 200. Se procesa en
-- seguida y, si falla o el contenedor se cae, el trabajador de fondo lo
-- reintenta. Al terminar bien la fila se borra; tras varios intentos queda
-- como `failed` 7 días para diagnóstico.
--
-- Aditiva e idempotente: solo crea la tabla y sus índices.

CREATE TABLE IF NOT EXISTS "webhook_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload_cipher" text NOT NULL,
	"payload_iv" text NOT NULL,
	"payload_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"locked_until" timestamp,
	"last_error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_inbox_hash_uq" ON "webhook_inbox" USING btree ("payload_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_inbox_due_idx" ON "webhook_inbox" USING btree ("status","next_attempt_at");
