-- 0071 — Límites sencillos: lo que ve el cliente puede incluir dólares, cada
-- función de IA (agentes, creador, asistente) puede tener su tope propio en
-- dólares con «avisar» o «bloquear», y los documentos del agente llevan un
-- freno de seguridad en bytes. Todo es ADITIVO (columnas NULL / con DEFAULT).
-- Reversa: scripts/sql/0071-reversa.sql
ALTER TABLE organization_plan DROP CONSTRAINT IF EXISTS organization_plan_usage_visibility_chk;
--> statement-breakpoint
ALTER TABLE organization_plan ADD CONSTRAINT organization_plan_usage_visibility_chk CHECK (usage_visibility in ('status', 'percent', 'tokens', 'usd'));
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS agent_usd_limit numeric(12,4);
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS creator_usd_limit numeric(12,4);
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS assistant_usd_limit numeric(12,4);
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS pool_mode text NOT NULL DEFAULT 'block';
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS agent_mode text NOT NULL DEFAULT 'block';
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS creator_mode text NOT NULL DEFAULT 'block';
--> statement-breakpoint
ALTER TABLE ai_quota ADD COLUMN IF NOT EXISTS assistant_mode text NOT NULL DEFAULT 'block';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_quota_fn_usd_chk') THEN
    ALTER TABLE ai_quota ADD CONSTRAINT ai_quota_fn_usd_chk CHECK ((agent_usd_limit is null or agent_usd_limit >= 0) and (creator_usd_limit is null or creator_usd_limit >= 0) and (assistant_usd_limit is null or assistant_usd_limit >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_quota_modes_chk') THEN
    ALTER TABLE ai_quota ADD CONSTRAINT ai_quota_modes_chk CHECK (pool_mode in ('block', 'warn') and agent_mode in ('block', 'warn') and creator_mode in ('block', 'warn') and assistant_mode in ('block', 'warn'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE kb_document_limit ADD COLUMN IF NOT EXISTS max_total_bytes bigint;
