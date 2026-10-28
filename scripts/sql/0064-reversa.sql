-- Reversa de drizzle/0064 («Chats nuevos de los asesores»).
-- Los asesores vuelven a poder abrir chats nuevos. Idempotente. Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0064-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
ALTER TABLE "messaging_settings" DROP COLUMN IF EXISTS "advisor_new_chats_blocked";
COMMIT;
