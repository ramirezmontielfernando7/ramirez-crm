-- 047 PR 4: nombre opcional de la IA conectada («Joe») y su copia en el mensaje.
ALTER TABLE "ai_connection" ADD COLUMN IF NOT EXISTS "assistant_name" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "ai_sender_name" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_connection" ADD CONSTRAINT "ai_connection_assistant_name_chk" CHECK ("ai_connection"."assistant_name" is null or char_length("ai_connection"."assistant_name") between 1 and 30);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
