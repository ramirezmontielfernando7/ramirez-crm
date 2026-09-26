-- 025 - Chat de equipo: comunicacion INTERNA entre usuarios de la misma
-- organizacion (directos, grupos y el canal de avisos). Nada de esto sale a Meta.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tablas e indices, bloques DO en las claves foraneas y el
-- canal de avisos sembrado con ON CONFLICT DO NOTHING.
--
-- Aditiva: tablas nuevas; no toca ninguna existente. Sin fila en
-- team_chat_settings = los defaults (supervision del Propietario encendida,
-- aviso apagado, grupos solo el Propietario).

CREATE TABLE IF NOT EXISTS "team_chat_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"uploaded_by_user_id" text,
	"mime_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_chat_member" (
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_chat_member_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"author_user_id" text,
	"body" text DEFAULT '' NOT NULL,
	"attachment_id" text,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_chat_reaction" (
	"organization_id" text NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_chat_reaction_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_chat_read_state" (
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp NOT NULL,
	CONSTRAINT "team_chat_read_state_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_chat_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"owner_oversight" boolean DEFAULT true NOT NULL,
	"show_oversight_notice" boolean DEFAULT false NOT NULL,
	"coordinators_can_create_groups" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_chat_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"direct_key" text,
	"created_by_user_id" text,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_attachment" ADD CONSTRAINT "team_chat_attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_attachment" ADD CONSTRAINT "team_chat_attachment_thread_id_team_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."team_chat_thread"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_attachment" ADD CONSTRAINT "team_chat_attachment_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_member" ADD CONSTRAINT "team_chat_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_member" ADD CONSTRAINT "team_chat_member_thread_id_team_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."team_chat_thread"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_member" ADD CONSTRAINT "team_chat_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_member" ADD CONSTRAINT "team_chat_member_added_by_user_id_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_thread_id_team_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."team_chat_thread"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_message" ADD CONSTRAINT "team_chat_message_attachment_id_team_chat_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."team_chat_attachment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_reaction" ADD CONSTRAINT "team_chat_reaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_reaction" ADD CONSTRAINT "team_chat_reaction_message_id_team_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."team_chat_message"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_reaction" ADD CONSTRAINT "team_chat_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_read_state" ADD CONSTRAINT "team_chat_read_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_read_state" ADD CONSTRAINT "team_chat_read_state_thread_id_team_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."team_chat_thread"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_read_state" ADD CONSTRAINT "team_chat_read_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_settings" ADD CONSTRAINT "team_chat_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_thread" ADD CONSTRAINT "team_chat_thread_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "team_chat_thread" ADD CONSTRAINT "team_chat_thread_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_chat_attachment_thread_idx" ON "team_chat_attachment" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_chat_member_org_user_idx" ON "team_chat_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_chat_message_thread_created_idx" ON "team_chat_message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_chat_read_state_org_user_idx" ON "team_chat_read_state" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_chat_thread_org_last_idx" ON "team_chat_thread" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_chat_thread_direct_uq" ON "team_chat_thread" USING btree ("organization_id","direct_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_chat_thread_announcements_uq" ON "team_chat_thread" USING btree ("organization_id") WHERE "team_chat_thread"."kind" = 'announcements';
--> statement-breakpoint
-- Canal de avisos para cada organizacion que ya existe (las nuevas lo crean
-- al primer uso, con el mismo id determinista). Todos participan de forma
-- implicita: no lleva filas en team_chat_member.
INSERT INTO "team_chat_thread" ("id", "organization_id", "kind", "name")
SELECT 'tct_avisos_' || substr(md5("id"), 1, 16), "id", 'announcements', 'Avisos'
FROM "organization"
ON CONFLICT DO NOTHING;
