-- Reversa de drizzle/0077 (ajustes de la plataforma). Quita la tabla; «¿Necesitas
-- más?» vuelve a decir «Escríbenos» sin enlace. Idempotente.
-- Uso: psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0077-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP TABLE IF EXISTS platform_setting;
COMMIT;
