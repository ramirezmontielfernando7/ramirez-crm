-- 048: «Chats nuevos de los asesores» (APAGADO por defecto).
ALTER TABLE "messaging_settings" ADD COLUMN IF NOT EXISTS "advisor_new_chats_blocked" boolean DEFAULT false NOT NULL;
