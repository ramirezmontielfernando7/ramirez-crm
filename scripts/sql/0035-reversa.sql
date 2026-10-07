-- Reversa OPCIONAL de drizzle/0035 (031, PR A1: agentes). No hace falta para
-- revertir: la 0035 solo agrega columnas y tablas y la imagen anterior las
-- ignora. Sirve solo para dejar el esquema exactamente como en la 0034.
--
-- BORRA datos: todos los agentes (incluido el general, que se vuelve a crear
-- desde `agent_profile` si se re-aplica la 0035), sus versiones, el
-- conocimiento PROPIO de cada agente (las entradas con agent_id) y el registro
-- de qué agente se evaluó en cada corrida. El conocimiento compartido y
-- `agent_profile` no se tocan.
-- Idempotente. Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0035-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0035, hay que borrar esa fila para que se re-aplique.
BEGIN;
DELETE FROM "kb_entry" WHERE "agent_id" IS NOT NULL;
ALTER TABLE "kb_entry" DROP CONSTRAINT IF EXISTS "kb_entry_org_agent_fk";
DROP INDEX IF EXISTS "kb_org_agent_idx";
ALTER TABLE "kb_entry" DROP COLUMN IF EXISTS "agent_id";
ALTER TABLE "agent_test_run" DROP CONSTRAINT IF EXISTS "agent_test_run_org_agent_fk";
ALTER TABLE "agent_test_run" DROP COLUMN IF EXISTS "agent_id";
ALTER TABLE "agent_test_run" DROP COLUMN IF EXISTS "agent_snapshot";
DROP TABLE IF EXISTS "agent_publish_log";
DROP FUNCTION IF EXISTS agent_publish_log_append_only();
DROP TABLE IF EXISTS "agent";
COMMIT;
