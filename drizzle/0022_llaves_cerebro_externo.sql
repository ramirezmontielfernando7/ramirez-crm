-- Fase 1 multitenant (H2): llaves del cerebro externo por organización.
-- Aditiva e idempotente: re-ejecutable sobre una base ya migrada. Reversa:
-- DROP TABLE "bot_api_key"; (la app vuelve a 401 en /api/bot/*).
CREATE TABLE IF NOT EXISTS "bot_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"source" text DEFAULT 'script' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "bot_api_key" ADD CONSTRAINT "bot_api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bot_api_key_hash_uq" ON "bot_api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_api_key_org_idx" ON "bot_api_key" USING btree ("organization_id");
