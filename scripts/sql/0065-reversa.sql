-- Reversa de drizzle/0065 (enlace de subida de un solo uso de la IA conectada).
-- Borra los enlaces; lo que ya se subió a la Biblioteca se queda. Idempotente.
-- Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0065-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP TABLE IF EXISTS "ai_upload_link";
COMMIT;
