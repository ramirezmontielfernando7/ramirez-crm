-- 022 - Linea de tiempo del chat y preferencias de interfaz por usuario.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tablas e indices, y bloques DO en las claves foraneas.
--
-- Aditiva: dos tablas nuevas que nacen vacias. La linea de tiempo empieza a
-- registrar notas, pausas de la IA, consentimiento y etiquetas desde el
-- despliegue; etapas y asignaciones ya tenian su bitacora (0014, 0015).

CREATE TABLE IF NOT EXISTS "contact_activity_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" text,
	"source" text DEFAULT 'usuario' NOT NULL,
	"detail" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_preference" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"nav_collapsed" boolean,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_preference_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_activity_event" ADD CONSTRAINT "contact_activity_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_activity_event" ADD CONSTRAINT "contact_activity_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact_activity_event" ADD CONSTRAINT "contact_activity_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cace_contact_occurred_idx" ON "contact_activity_event" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cace_org_occurred_idx" ON "contact_activity_event" USING btree ("organization_id","occurred_at");