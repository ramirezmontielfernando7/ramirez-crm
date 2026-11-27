-- 0076 — Plan «Inicio» (499 MXN, sin IA) y topes de IA por plan.
-- Agrega 'inicio' a las tres llaves de plan que lo validan y deja el tope
-- mensual de IA (USD) de cada plan en los valores finales. ADITIVO e
-- idempotente. Reversa: scripts/sql/0076-reversa.sql
ALTER TABLE organization_plan DROP CONSTRAINT IF EXISTS organization_plan_key_chk;
--> statement-breakpoint
ALTER TABLE organization_plan ADD CONSTRAINT organization_plan_key_chk CHECK (plan_key in ('inicio', 'esencial', 'pro', 'ultra', 'custom'));
--> statement-breakpoint
ALTER TABLE platform_ai_defaults DROP CONSTRAINT IF EXISTS platform_ai_defaults_scope_chk;
--> statement-breakpoint
ALTER TABLE platform_ai_defaults ADD CONSTRAINT platform_ai_defaults_scope_chk CHECK (scope in ('instance', 'inicio', 'esencial', 'pro', 'ultra'));
--> statement-breakpoint
ALTER TABLE platform_plan_catalog DROP CONSTRAINT IF EXISTS platform_plan_catalog_scope_chk;
--> statement-breakpoint
ALTER TABLE platform_plan_catalog ADD CONSTRAINT platform_plan_catalog_scope_chk CHECK (scope in ('inicio', 'esencial', 'pro', 'ultra'));
--> statement-breakpoint
INSERT INTO platform_ai_defaults (scope, monthly_usd_limit) VALUES
  ('inicio', 0.5),
  ('esencial', 2),
  ('pro', 6),
  ('ultra', 24)
ON CONFLICT (scope) DO UPDATE SET monthly_usd_limit = EXCLUDED.monthly_usd_limit, updated_at = now();
