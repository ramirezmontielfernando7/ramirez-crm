-- 0078 — Plataforma para vender (spec 048). ADITIVO e idempotente.
-- Reversa: scripts/sql/0078-reversa.sql
--
-- 1. organization_billing: prueba gratis con fecha de fin, «pagado hasta»,
--    días de gracia y la IA extra del mes («restablecer IA»). Sin fila = la
--    organización no lleva cobro desde Plataforma y opera como siempre.
-- 2. organization_payment: bitácora de pagos y extras registrados a mano.
-- 3. platform_kill_switch: interruptores de emergencia para TODAS las
--    organizaciones (IA, campañas, envíos por conexión directa). Plataforma.
-- 4. platform_broadcast: aviso a todos los clientes (franja arriba). Plataforma.
-- 5. platform_plan_catalog.modules: qué módulos trae cada plan, editable.
CREATE TABLE IF NOT EXISTS "organization_billing" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"trial_ends_at" timestamp,
	"paid_until" timestamp,
	"grace_days" integer DEFAULT 5 NOT NULL,
	"ai_bonus_usd" numeric(12, 4),
	"ai_bonus_month" text,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "organization_billing_grace_chk" CHECK ("grace_days" between 0 and 60),
	CONSTRAINT "organization_billing_bonus_chk" CHECK ("ai_bonus_usd" is null or "ai_bonus_usd" >= 0),
	CONSTRAINT "organization_billing_bonus_month_chk" CHECK ("ai_bonus_month" is null or "ai_bonus_month" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "organization_billing_note_chk" CHECK ("note" is null or char_length("note") <= 500)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "organization_billing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_billing" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "organization_billing";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "organization_billing" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_mxn" integer DEFAULT 0 NOT NULL,
	"months" integer,
	"quantity" integer DEFAULT 1 NOT NULL,
	"note" text,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"recorded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_payment_kind_chk" CHECK ("kind" in ('plan', 'ai_reset', 'extra_person', 'extra_storage', 'onboarding', 'other')),
	CONSTRAINT "organization_payment_amount_chk" CHECK ("amount_mxn" between 0 and 10000000),
	CONSTRAINT "organization_payment_months_chk" CHECK ("months" is null or "months" between 1 and 36),
	CONSTRAINT "organization_payment_quantity_chk" CHECK ("quantity" between 1 and 100),
	CONSTRAINT "organization_payment_note_chk" CHECK ("note" is null or char_length("note") <= 300)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_payment" ADD CONSTRAINT "organization_payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_payment" ADD CONSTRAINT "organization_payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_payment_org_idx" ON "organization_payment" ("organization_id", "paid_at" DESC);
--> statement-breakpoint
ALTER TABLE "organization_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_payment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "organization_payment";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "organization_payment" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_kill_switch" (
	"key" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"reason" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "platform_kill_switch_key_chk" CHECK ("key" in ('ai', 'campaigns', 'direct_send')),
	CONSTRAINT "platform_kill_switch_reason_chk" CHECK ("reason" is null or char_length("reason") <= 300)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_broadcast" (
	"id" text PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"starts_at" timestamp DEFAULT now() NOT NULL,
	"ends_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
	CONSTRAINT "platform_broadcast_level_chk" CHECK ("level" in ('info', 'warning')),
	CONSTRAINT "platform_broadcast_message_chk" CHECK (char_length("message") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "platform_plan_catalog" ADD COLUMN IF NOT EXISTS "modules" jsonb;
