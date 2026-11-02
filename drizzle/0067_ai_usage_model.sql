CREATE TABLE IF NOT EXISTS ai_usage_model (
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  period text NOT NULL,
  kind text NOT NULL,
  model text NOT NULL,
  turns integer NOT NULL DEFAULT 0,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(14,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, period, kind, model)
);
--> statement-breakpoint
ALTER TABLE ai_usage_model ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_usage_model FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_usage_model' AND policyname = 'aislamiento_por_organizacion') THEN
    CREATE POLICY aislamiento_por_organizacion ON ai_usage_model
      USING (organization_id = current_setting('app.org_id', true))
      WITH CHECK (organization_id = current_setting('app.org_id', true));
  END IF;
END $$;
