-- Respuestas rápidas (`quick_reply`): mensajes guardados en Ajustes que se mandan desde el chat con el rayo o con `/atajo` (Empresa y Mi número).
-- Solo aditiva. Reversa: scripts/sql/0059-reversa.sql.
CREATE TABLE IF NOT EXISTS "quick_reply" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"shortcut" text NOT NULL,
	"body" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quick_reply_org_shortcut_uq" UNIQUE("organization_id","shortcut"),
	CONSTRAINT "quick_reply_shortcut_chk" CHECK ("quick_reply"."shortcut" ~ '^[a-z0-9_-]{1,30}$'),
	CONSTRAINT "quick_reply_body_chk" CHECK (char_length("quick_reply"."body") between 1 and 4096)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quick_reply" ADD CONSTRAINT "quick_reply_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "quick_reply" ADD CONSTRAINT "quick_reply_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- RLS (misma política que la 0027).
ALTER TABLE "quick_reply" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quick_reply" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "quick_reply";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "quick_reply" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
