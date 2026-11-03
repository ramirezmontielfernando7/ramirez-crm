-- Reversa de drizzle/0069 (Chat general e hilos archivables del asistente).
-- Quita el índice y las columnas; las conversaciones se conservan (el
-- «Chat general» pasa a ser un hilo normal). Idempotente.
-- Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0069-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP INDEX IF EXISTS assistant_thread_general_uq;
ALTER TABLE assistant_thread DROP CONSTRAINT IF EXISTS assistant_thread_kind_chk;
ALTER TABLE assistant_thread DROP COLUMN IF EXISTS archived_at;
ALTER TABLE assistant_thread DROP COLUMN IF EXISTS kind;
COMMIT;
