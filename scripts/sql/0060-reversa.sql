-- Reversa de drizzle/0060 (conector de IA).
-- BORRA las IAs conectadas, sus llaves y la bitácora «Qué hizo tu IA».
-- Apaga antes el complemento en /platform. Idempotente. Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0060-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP TABLE IF EXISTS "ai_action_log";
DROP TABLE IF EXISTS "ai_token";
DROP TABLE IF EXISTS "ai_oauth_code";
DROP TABLE IF EXISTS "ai_connection";
DROP TABLE IF EXISTS "ai_oauth_client";
DROP TABLE IF EXISTS "ai_connector_settings";
ALTER TABLE "message" DROP COLUMN IF EXISTS "ai_connection_id";
ALTER TABLE "direct_number" DROP COLUMN IF EXISTS "ai_connector";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "conector_ia";
COMMIT;
