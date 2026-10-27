-- Motivos de pérdida editables del Pipeline (`loss_reason`). Una organización sin filas usa los seis de siempre (se siembran al leerlos); no hay relleno ni cambios en lead_stage_event.
-- Solo aditiva. Reversa: scripts/sql/0058-reversa.sql.
CREATE TABLE IF NOT EXISTS "loss_reason" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "loss_reason_org_key_uq" UNIQUE("organization_id","key"),
	CONSTRAINT "loss_reason_label_chk" CHECK (char_length("loss_reason"."label") between 1 and 60)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "loss_reason" ADD CONSTRAINT "loss_reason_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loss_reason_org_pos_idx" ON "loss_reason" USING btree ("organization_id","position");--> statement-breakpoint
-- RLS (misma política que la 0027).
ALTER TABLE "loss_reason" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loss_reason" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "loss_reason";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "loss_reason" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
