-- Reversa de drizzle/0063 («Funciones avanzadas» del conector de IA).
-- La IA vuelve a no tener funciones avanzadas. Idempotente. Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0063-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
ALTER TABLE "ai_connector_settings" DROP CONSTRAINT IF EXISTS "ai_connector_settings_advanced_roles_chk";
ALTER TABLE "ai_connector_settings" DROP CONSTRAINT IF EXISTS "ai_connector_settings_advanced_areas_chk";
ALTER TABLE "ai_connector_settings" DROP COLUMN IF EXISTS "advanced_enabled";
ALTER TABLE "ai_connector_settings" DROP COLUMN IF EXISTS "advanced_roles";
ALTER TABLE "ai_connector_settings" DROP COLUMN IF EXISTS "advanced_areas";
ALTER TABLE "ai_connector_settings" DROP COLUMN IF EXISTS "advanced_launch_campaigns";
COMMIT;
