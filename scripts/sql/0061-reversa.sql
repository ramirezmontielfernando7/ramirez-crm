-- Reversa de drizzle/0061 (Mi número: cliente por defecto y barra «¿Es cliente?»).
-- Pierde esos dos ajustes; los chats ya marcados «Es cliente» no cambian. Idempotente. Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0061-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "client_prompt_dismissed_at";
ALTER TABLE "direct_number" DROP COLUMN IF EXISTS "client_by_default";
COMMIT;
