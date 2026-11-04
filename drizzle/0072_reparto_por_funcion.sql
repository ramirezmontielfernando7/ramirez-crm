-- 0072 — Reparto de la bolsa de IA por función: cada tope se guarda como se
-- escribió (dólares, millones de tokens o % del total). ADITIVO.
-- Reversa: scripts/sql/0072-reversa.sql
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS agent_cap_unit text NOT NULL DEFAULT 'usd';
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS agent_cap_value numeric(14,4);
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS creator_cap_unit text NOT NULL DEFAULT 'usd';
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS creator_cap_value numeric(14,4);
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS assistant_cap_unit text NOT NULL DEFAULT 'usd';
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS assistant_cap_value numeric(14,4);
--> statement-breakpoint
-- Lo que ya había en dólares queda como «dólares» con su valor.
UPDATE ai_quota SET agent_cap_value = agent_usd_limit WHERE agent_usd_limit IS NOT NULL AND agent_cap_value IS NULL;
--> statement-breakpoint
UPDATE ai_quota SET creator_cap_value = creator_usd_limit WHERE creator_usd_limit IS NOT NULL AND creator_cap_value IS NULL;
--> statement-breakpoint
UPDATE ai_quota SET assistant_cap_value = assistant_usd_limit WHERE assistant_usd_limit IS NOT NULL AND assistant_cap_value IS NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_quota_cap_units_chk') THEN
    ALTER TABLE ai_quota ADD CONSTRAINT ai_quota_cap_units_chk CHECK (agent_cap_unit in ('usd', 'mtok', 'pct') and creator_cap_unit in ('usd', 'mtok', 'pct') and assistant_cap_unit in ('usd', 'mtok', 'pct'));
  END IF;
END $$;
