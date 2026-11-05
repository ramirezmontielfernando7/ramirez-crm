-- Reversa de drizzle/0073 (catálogo de planes). Quita la tabla de plataforma;
-- la ventana «Mejora tu plan» vuelve a los precios de fábrica del código.
-- Idempotente.
-- Uso: psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0073-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP TABLE IF EXISTS platform_plan_catalog;
COMMIT;
