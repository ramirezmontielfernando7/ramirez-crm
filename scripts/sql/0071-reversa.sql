-- Reversa de drizzle/0071 (límites sencillos). Quita las columnas nuevas y
-- vuelve «usd» a «percent». Idempotente.
-- Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0071-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
UPDATE organization_plan SET usage_visibility = 'percent' WHERE usage_visibility = 'usd';
ALTER TABLE organization_plan DROP CONSTRAINT IF EXISTS organization_plan_usage_visibility_chk;
ALTER TABLE organization_plan ADD CONSTRAINT organization_plan_usage_visibility_chk CHECK (usage_visibility in ('status', 'percent', 'tokens'));
ALTER TABLE ai_quota DROP CONSTRAINT IF EXISTS ai_quota_fn_usd_chk;
ALTER TABLE ai_quota DROP CONSTRAINT IF EXISTS ai_quota_modes_chk;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS agent_usd_limit;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS creator_usd_limit;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS assistant_usd_limit;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS pool_mode;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS agent_mode;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS creator_mode;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS assistant_mode;
ALTER TABLE kb_document_limit DROP COLUMN IF EXISTS max_total_bytes;
DELETE FROM ai_usage WHERE kind LIKE 'fn\_%';
COMMIT;
