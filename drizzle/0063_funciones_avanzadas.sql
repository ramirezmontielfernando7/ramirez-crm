-- 047 PR 6: «Funciones avanzadas» del conector de IA (todo APAGADO por defecto).
ALTER TABLE "ai_connector_settings" ADD COLUMN IF NOT EXISTS "advanced_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_connector_settings" ADD COLUMN IF NOT EXISTS "advanced_roles" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_connector_settings" ADD COLUMN IF NOT EXISTS "advanced_areas" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_connector_settings" ADD COLUMN IF NOT EXISTS "advanced_launch_campaigns" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_connector_settings" ADD CONSTRAINT "ai_connector_settings_advanced_roles_chk" CHECK ("ai_connector_settings"."advanced_roles" <@ array['coordinador']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_connector_settings" ADD CONSTRAINT "ai_connector_settings_advanced_areas_chk" CHECK ("ai_connector_settings"."advanced_areas" <@ array['contacts', 'campaigns', 'tags', 'agents', 'settings']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
