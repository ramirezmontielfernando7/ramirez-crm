-- Reversa de drizzle/0062 (nombre de la IA conectada).
-- Las burbujas vuelven a decir «Asistente». Idempotente. Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0062-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
ALTER TABLE "ai_connection" DROP CONSTRAINT IF EXISTS "ai_connection_assistant_name_chk";
ALTER TABLE "ai_connection" DROP COLUMN IF EXISTS "assistant_name";
ALTER TABLE "message" DROP COLUMN IF EXISTS "ai_sender_name";
COMMIT;
