-- 024 - Conocimientos: material que el equipo consulta y envia a los clientes.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tabla e indice, y bloques DO en las claves foraneas.
--
-- Aditiva: una tabla nueva que nace vacia. Independiente de kb_entry (lo que
-- lee el agente de IA): el agente no lee esta tabla.

CREATE TABLE IF NOT EXISTS "knowledge_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"file_path" text,
	"file_name" text,
	"file_mime" text,
	"file_size" integer,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "knowledge_entry" ADD CONSTRAINT "knowledge_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "knowledge_entry" ADD CONSTRAINT "knowledge_entry_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_entry_org_updated_idx" ON "knowledge_entry" USING btree ("organization_id","updated_at");
