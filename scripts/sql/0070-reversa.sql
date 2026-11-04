-- Reversa de drizzle/0070 (modelos por plan y empresa, tope en dólares).
-- Quita las dos tablas de plataforma y las columnas nuevas; los topes de
-- tokens y turnos de siempre no se tocan. Los avisos «ai_usd» se borran.
-- Idempotente.
-- Uso (SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0070-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP TABLE IF EXISTS platform_ai_model_price;
DROP TABLE IF EXISTS platform_ai_defaults;
DELETE FROM usage_alert WHERE metric = 'ai_usd';
ALTER TABLE usage_alert DROP CONSTRAINT IF EXISTS usage_alert_metric_chk;
ALTER TABLE usage_alert ADD CONSTRAINT usage_alert_metric_chk CHECK (metric in ('ai_tokens', 'ai_turns', 'embed_tokens', 'storage', 'members', 'modules', 'assistant_tokens'));
ALTER TABLE ai_usage DROP COLUMN IF EXISTS est_cost_usd;
ALTER TABLE ai_quota DROP CONSTRAINT IF EXISTS ai_quota_usd_chk;
ALTER TABLE ai_quota DROP CONSTRAINT IF EXISTS ai_quota_agent_effort_chk;
ALTER TABLE ai_quota DROP CONSTRAINT IF EXISTS ai_quota_creator_effort_chk;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS monthly_usd_limit;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS agent_model;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS agent_effort;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS creator_model;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS creator_effort;
ALTER TABLE ai_quota DROP COLUMN IF EXISTS assistant_model;
COMMIT;
