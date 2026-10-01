-- Fase 3 multitenant, PR 2: administrador de plataforma y alta de organizaciones.
--
-- 1. `organization`: estado (active | suspended | deleted), motivo, fechas y
--    `purge_after` (borrado suave con 30 días de gracia). Todas las
--    organizaciones existentes quedan `active`: nada cambia para ellas.
-- 2. Tablas de PLATAFORMA (sin organization_id, sin RLS; solo el pool de
--    sistema: scripts/migrate.mjs revoca a vocero_app):
--    `platform_admin`, `platform_audit_log`, `account_link_token`.
--
-- Idempotente. Reversa SIN migración nueva: scripts/sql/0029-reversa.sql.

CREATE TABLE IF NOT EXISTS "account_link_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"used_ip" text,
	"used_user_agent" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_admin" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"failed_reauth" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"target_org_id" text,
	"target_org_name" text,
	"target_user_id" text,
	"target_user_email" text,
	"detail" jsonb,
	"ip" text
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "status_reason" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "purge_after" timestamp;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "account_link_token" ADD CONSTRAINT "account_link_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "platform_admin" ADD CONSTRAINT "platform_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_link_token_hash_uq" ON "account_link_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_link_token_user_idx" ON "account_link_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_log_at_idx" ON "platform_audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_log_org_idx" ON "platform_audit_log" USING btree ("target_org_id","at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization" ADD CONSTRAINT "organization_status_chk" CHECK ("organization"."status" in ('active', 'suspended', 'deleted'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
