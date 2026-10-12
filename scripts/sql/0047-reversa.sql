-- Reversa OPCIONAL de drizzle/0047 (038 PR 1: base del asistente interno). No
-- hace falta para revertir: la 0047 solo agrega tablas y columnas y amplía dos
-- CHECK, y la imagen anterior lo ignora. Sirve solo para dejar el esquema
-- exactamente como en la 0046.
--
-- BORRA datos: las conversaciones del asistente, su tope propio, la
-- visibilidad del consumo de cada organización, el interruptor del módulo y
-- los avisos 'assistant_tokens'. Si alguna organización tiene un tope de 13
-- módulos activos, vuelve a 12 (el CHECK anterior no lo admite). Idempotente.
-- Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0047-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0047, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "assistant_message";
DROP TABLE IF EXISTS "assistant_thread";
ALTER TABLE "ai_quota" DROP CONSTRAINT IF EXISTS "ai_quota_assistant_tokens_chk";
ALTER TABLE "ai_quota" DROP COLUMN IF EXISTS "assistant_monthly_token_limit";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "asistente";
ALTER TABLE "organization_plan" DROP CONSTRAINT IF EXISTS "organization_plan_usage_visibility_chk";
ALTER TABLE "organization_plan" DROP COLUMN IF EXISTS "usage_visibility";
ALTER TABLE "user_preference" DROP COLUMN IF EXISTS "assistant_notice_accepted_at";
DELETE FROM "usage_alert" WHERE "metric" = 'assistant_tokens';
ALTER TABLE "usage_alert" DROP CONSTRAINT IF EXISTS "usage_alert_metric_chk";
ALTER TABLE "usage_alert" ADD CONSTRAINT "usage_alert_metric_chk" CHECK ("usage_alert"."metric" in ('ai_tokens', 'ai_turns', 'embed_tokens', 'storage', 'members', 'modules'));
UPDATE "organization_plan" SET "max_active_modules" = 12 WHERE "max_active_modules" > 12;
ALTER TABLE "organization_plan" DROP CONSTRAINT IF EXISTS "organization_plan_modules_chk";
ALTER TABLE "organization_plan" ADD CONSTRAINT "organization_plan_modules_chk" CHECK ("organization_plan"."max_active_modules" is null or "organization_plan"."max_active_modules" between 0 and 12);
COMMIT;
