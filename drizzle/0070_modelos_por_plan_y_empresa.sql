-- 0070 — Modelo y esfuerzo por función (instancia, plan y empresa), tope
-- mensual de IA en dólares y costo estimado por llamada. Todo es ADITIVO:
-- columnas NULL / con DEFAULT y dos tablas de plataforma nuevas. Sin datos
-- sembrados: nada cambia hasta que el administrador lo elige en Plataforma.
-- Reversa: scripts/sql/0070-reversa.sql
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS monthly_usd_limit numeric(12,4);
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS agent_model text;
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS agent_effort text;
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS creator_model text;
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS creator_effort text;
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS assistant_model text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_quota_usd_chk') THEN
    ALTER TABLE ai_quota ADD CONSTRAINT ai_quota_usd_chk CHECK (monthly_usd_limit is null or monthly_usd_limit >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_quota_agent_effort_chk') THEN
    ALTER TABLE ai_quota ADD CONSTRAINT ai_quota_agent_effort_chk CHECK (agent_effort is null or agent_effort in ('none', 'low', 'medium', 'high'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_quota_creator_effort_chk') THEN
    ALTER TABLE ai_quota ADD CONSTRAINT ai_quota_creator_effort_chk CHECK (creator_effort is null or creator_effort in ('none', 'low', 'medium', 'high'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS est_cost_usd numeric(14,6) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE usage_alert DROP CONSTRAINT IF EXISTS usage_alert_metric_chk;
--> statement-breakpoint
ALTER TABLE usage_alert ADD CONSTRAINT usage_alert_metric_chk CHECK (metric in ('ai_tokens', 'ai_turns', 'embed_tokens', 'storage', 'members', 'modules', 'assistant_tokens', 'ai_usd'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS platform_ai_defaults (
  scope text PRIMARY KEY,
  agent_model text,
  agent_effort text,
  creator_model text,
  creator_effort text,
  assistant_model text,
  monthly_usd_limit numeric(12,4),
  budget_monthly_usd numeric(12,4),
  credits_usd numeric(12,4),
  credits_since text,
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  CONSTRAINT platform_ai_defaults_scope_chk CHECK (scope in ('instance', 'esencial', 'pro', 'ultra')),
  CONSTRAINT platform_ai_defaults_agent_effort_chk CHECK (agent_effort is null or agent_effort in ('none', 'low', 'medium', 'high')),
  CONSTRAINT platform_ai_defaults_creator_effort_chk CHECK (creator_effort is null or creator_effort in ('none', 'low', 'medium', 'high')),
  CONSTRAINT platform_ai_defaults_usd_chk CHECK (monthly_usd_limit is null or monthly_usd_limit >= 0),
  CONSTRAINT platform_ai_defaults_since_chk CHECK (credits_since is null or credits_since ~ '^[0-9]{4}-[0-9]{2}-01$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS platform_ai_model_price (
  model text PRIMARY KEY,
  input_usd_per_mtok numeric(12,6) NOT NULL,
  output_usd_per_mtok numeric(12,6) NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  CONSTRAINT platform_ai_model_price_positive_chk CHECK (input_usd_per_mtok >= 0 and output_usd_per_mtok >= 0)
);
