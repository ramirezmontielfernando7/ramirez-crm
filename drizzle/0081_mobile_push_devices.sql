-- C9: registros Android opcionales, ligados a la sesión concreta de Better Auth.
CREATE TABLE IF NOT EXISTS "mobile_push_devices" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "token_cipher" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_tag" text NOT NULL,
  "key_version" integer NOT NULL DEFAULT 1,
  "platform" text NOT NULL DEFAULT 'android',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp,
  CONSTRAINT "mobile_push_devices_platform_ck" CHECK ("platform" = 'android')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mobile_push_devices_org_user_token_uq"
  ON "mobile_push_devices" ("organization_id", "user_id", "token_hash");--> statement-breakpoint
-- Un solo usuario/tenant activo por token físico. Ante duda falla cerrado.
CREATE UNIQUE INDEX IF NOT EXISTS "mobile_push_devices_active_token_uq"
  ON "mobile_push_devices" ("token_hash") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_push_devices_session_idx"
  ON "mobile_push_devices" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_push_devices_seen_idx"
  ON "mobile_push_devices" ("last_seen_at");--> statement-breakpoint
ALTER TABLE "mobile_push_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mobile_push_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "aislamiento_por_organizacion" ON "mobile_push_devices";--> statement-breakpoint
CREATE POLICY "aislamiento_por_organizacion" ON "mobile_push_devices"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));
