-- 0079 — Mensajes automáticos sin IA, chats olvidados y tiempo de primera
-- respuesta (spec 049). ADITIVO e idempotente: solo columnas nuevas.
-- Reversa: scripts/sql/0079-reversa.sql
--
-- 1. messaging_settings: bienvenida, «fuera de horario» (con su horario y zona)
--    y las horas para avisar de un chat olvidado. Todo apagado por defecto.
-- 2. conversation: cuándo salió la bienvenida, el último «fuera de horario» y
--    el último aviso de chat olvidado (para no repetirlos).
-- 3. message.auto_kind: marca los mensajes automáticos (no cuentan como
--    respuesta de una persona).
ALTER TABLE "messaging_settings" ADD COLUMN IF NOT EXISTS "welcome_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_settings" ADD COLUMN IF NOT EXISTS "welcome_text" text;--> statement-breakpoint
ALTER TABLE "messaging_settings" ADD COLUMN IF NOT EXISTS "away_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_settings" ADD COLUMN IF NOT EXISTS "away_text" text;--> statement-breakpoint
ALTER TABLE "messaging_settings" ADD COLUMN IF NOT EXISTS "auto_hours" jsonb;--> statement-breakpoint
ALTER TABLE "messaging_settings" ADD COLUMN IF NOT EXISTS "auto_timezone" text DEFAULT 'America/Mexico_City' NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_settings" ADD COLUMN IF NOT EXISTS "forgotten_alert_hours" integer;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "auto_welcome_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "auto_away_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "forgotten_alerted_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "auto_kind" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "messaging_settings" ADD CONSTRAINT "messaging_settings_forgotten_hours_chk" CHECK ("forgotten_alert_hours" is null or "forgotten_alert_hours" between 1 and 168);
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "message" ADD CONSTRAINT "message_auto_kind_chk" CHECK ("auto_kind" is null or "auto_kind" in ('welcome', 'away'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
