-- Reversa de 0079 (mensajes automáticos, chats olvidados). Borra los datos de
-- esas columnas; las funciones dejan de existir hasta volver a migrar.
ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_auto_kind_chk";
ALTER TABLE "messaging_settings" DROP CONSTRAINT IF EXISTS "messaging_settings_forgotten_hours_chk";
ALTER TABLE "message" DROP COLUMN IF EXISTS "auto_kind";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "forgotten_alerted_at";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "auto_away_at";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "auto_welcome_at";
ALTER TABLE "messaging_settings" DROP COLUMN IF EXISTS "forgotten_alert_hours";
ALTER TABLE "messaging_settings" DROP COLUMN IF EXISTS "auto_timezone";
ALTER TABLE "messaging_settings" DROP COLUMN IF EXISTS "auto_hours";
ALTER TABLE "messaging_settings" DROP COLUMN IF EXISTS "away_text";
ALTER TABLE "messaging_settings" DROP COLUMN IF EXISTS "away_enabled";
ALTER TABLE "messaging_settings" DROP COLUMN IF EXISTS "welcome_text";
ALTER TABLE "messaging_settings" DROP COLUMN IF EXISTS "welcome_enabled";
