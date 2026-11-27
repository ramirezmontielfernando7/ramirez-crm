-- Reversa de drizzle/0075 (invitation.created_at). Solo hace falta si se
-- vuelve a better-auth 1.6: con 1.7 la app NO arranca sin esta columna.
-- Idempotente.
-- Uso: psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0075-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
ALTER TABLE invitation DROP COLUMN IF EXISTS created_at;
COMMIT;
