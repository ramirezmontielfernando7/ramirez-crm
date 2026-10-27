-- Mi número: «Marcar chats nuevos como cliente por defecto» y la barra «¿Es cliente? Sí / No».
-- `direct_number.client_by_default`: el chat nuevo de este número nace «Es cliente» (solo con `share_clients`). Apagado de fábrica.
-- `conversation.client_prompt_dismissed_at`: la persona contestó «No» a la barra en este chat; no vuelve a salir.
-- Solo aditiva (columna con DEFAULT constante y columna NULL). Idempotente. Reversa: scripts/sql/0061-reversa.sql.
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "client_prompt_dismissed_at" timestamp;--> statement-breakpoint
ALTER TABLE "direct_number" ADD COLUMN IF NOT EXISTS "client_by_default" boolean DEFAULT false NOT NULL;
