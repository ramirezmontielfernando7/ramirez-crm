-- Reversa de drizzle/0058 (motivos de pérdida editables).
-- BORRA los motivos personalizados (los eventos ya guardados conservan su
-- clave). Idempotente. Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0058-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP TABLE IF EXISTS "loss_reason";
COMMIT;
