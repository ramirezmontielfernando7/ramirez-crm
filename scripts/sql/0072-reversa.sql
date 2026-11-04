-- Reversa de drizzle/0072 (reparto por función). Los topes en % se pierden
-- (quedan sin tope en dólares); los de dólares se conservan. Idempotente.
-- Uso: psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0072-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
ALTER TABLE ai_quota DROP CONSTRAINT IF EXISTS ai_quota_cap_units_chk;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS agent_cap_unit;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS agent_cap_value;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS creator_cap_unit;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS creator_cap_value;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS assistant_cap_unit;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS assistant_cap_value;
COMMIT;
