ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS reserved_tokens integer NOT NULL DEFAULT 0;
