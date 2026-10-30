-- 047: enlace de subida de un solo uso de la IA conectada (Biblioteca).
CREATE TABLE "ai_upload_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text,
	"token_hash" text NOT NULL,
	"note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"in_chat" boolean DEFAULT true NOT NULL,
	"rag" boolean DEFAULT false NOT NULL,
	"rag_group_id" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"entry_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_upload_link_destino_chk" CHECK ("ai_upload_link"."in_chat" or "ai_upload_link"."rag")
);
--> statement-breakpoint
ALTER TABLE "ai_upload_link" ADD CONSTRAINT "ai_upload_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upload_link" ADD CONSTRAINT "ai_upload_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_upload_link_hash_uq" ON "ai_upload_link" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ai_upload_link_user_idx" ON "ai_upload_link" USING btree ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "ai_upload_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_upload_link" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "ai_upload_link";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "ai_upload_link" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
