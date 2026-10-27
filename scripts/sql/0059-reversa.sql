-- Reversa de drizzle/0059 (respuestas rápidas).
-- BORRA las respuestas rápidas guardadas. Idempotente. Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0059-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP TABLE IF EXISTS "quick_reply";
COMMIT;
