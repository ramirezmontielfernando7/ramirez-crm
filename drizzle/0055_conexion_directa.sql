-- Conexión directa, PR 1 — Módulo y datos (nada visible todavía).
--
-- Un complemento OCULTO por organización (`organization_module.conexion_directa`,
-- DEFAULT false: nadie ve nada hasta que la plataforma lo enciende) y los datos
-- que usarán los PRs siguientes:
--
-- `evolution_server`: servidores del dispositivo vinculado (tabla de
--   PLATAFORMA, sin organización ni RLS; solo el pool de sistema: SOLO_SISTEMA
--   en scripts/migrate.mjs). Llave maestra cifrada (AES-256-GCM, key_version).
-- `direct_connection`: la conexión de cada organización (servidor, instancia,
--   llave cifrada, hash del token del webhook, estado, número, freno de
--   emergencia). Una por organización por ahora.
-- `direct_connection_settings`: la «Configuración avanzada» (modo por
--   defecto, límites de envío, ventana, regreso automático, IA, permisos
--   delegados, aviso aceptado). Sin fila valen los DEFAULT.
-- `conversation.connection_mode` (+ `connection_mode_changed_at`): el modo de
--   cada chat (meta / directa / mixta); NULL = el de la organización.
-- `message.transport`, `message.alt_message_id`, `message.queued_until`: por
--   dónde salió, el ID del otro lado (unir el eco de Meta) y «En cola».
-- `contact.wa_lid`: el ID privado `@lid`, único por organización.
--
-- Solo aditiva: tablas y columnas nuevas, todas NULL o con DEFAULT; nada se
-- reescribe. El código anterior las ignora. Los CHECK de `conversation` y
-- `message` van NOT VALID (las filas existentes son NULL; así no se recorre la
-- tabla con candado). Los dos índices parciales nuevos sí recorren su tabla
-- una vez. Idempotente: re-ejecutable sobre una base ya migrada.
--
-- Revertir: scripts/sql/0055-reversa.sql (borra lo de aquí; antes, apagar el
-- módulo en /platform).
CREATE TABLE IF NOT EXISTS "direct_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"server_id" text NOT NULL,
	"instance_name" text NOT NULL,
	"instance_key_cipher" text,
	"instance_key_iv" text,
	"instance_key_tag" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"webhook_token_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"phone_number" text,
	"connected_at" timestamp,
	"last_seen_at" timestamp,
	"last_check_at" timestamp,
	"disconnect_count" integer DEFAULT 0 NOT NULL,
	"disconnect_window_start" timestamp,
	"paused_until" timestamp,
	"pause_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "direct_connection_status_chk" CHECK ("direct_connection"."status" in ('pending', 'connecting', 'connected', 'disconnected')),
	CONSTRAINT "direct_connection_pause_chk" CHECK ("direct_connection"."pause_reason" is null or "direct_connection"."pause_reason" in ('ban', 'disconnects', 'manual')),
	CONSTRAINT "direct_connection_key_chk" CHECK (("direct_connection"."instance_key_cipher" is null) = ("direct_connection"."instance_key_iv" is null) and ("direct_connection"."instance_key_iv" is null) = ("direct_connection"."instance_key_tag" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "direct_connection_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"default_mode" text DEFAULT 'meta' NOT NULL,
	"limits_enabled" boolean DEFAULT true NOT NULL,
	"min_interval_seconds" integer DEFAULT 8 NOT NULL,
	"per_chat_per_minute" integer DEFAULT 5 NOT NULL,
	"per_hour" integer DEFAULT 60 NOT NULL,
	"prefer_meta_in_window" boolean DEFAULT true NOT NULL,
	"auto_return_to_meta" boolean DEFAULT true NOT NULL,
	"closed_window_mode" text DEFAULT 'mixta' NOT NULL,
	"ai_via_direct" boolean DEFAULT false NOT NULL,
	"mode_roles" text[] DEFAULT '{coordinador}'::text[] NOT NULL,
	"link_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"limits_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"notice_accepted_by" text,
	"notice_accepted_at" timestamp,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "direct_connection_settings_mode_chk" CHECK ("direct_connection_settings"."default_mode" in ('meta', 'directa', 'mixta')),
	CONSTRAINT "direct_connection_settings_closed_chk" CHECK ("direct_connection_settings"."closed_window_mode" in ('directa', 'mixta')),
	CONSTRAINT "direct_connection_settings_limits_chk" CHECK ("direct_connection_settings"."min_interval_seconds" between 0 and 3600 and "direct_connection_settings"."per_chat_per_minute" between 1 and 60 and "direct_connection_settings"."per_hour" between 1 and 10000),
	CONSTRAINT "direct_connection_settings_roles_chk" CHECK ("direct_connection_settings"."mode_roles" <@ array['coordinador', 'asesor']::text[] and "direct_connection_settings"."link_roles" <@ array['coordinador', 'asesor']::text[] and "direct_connection_settings"."limits_roles" <@ array['coordinador', 'asesor']::text[])
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evolution_server" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_cipher" text NOT NULL,
	"api_key_iv" text NOT NULL,
	"api_key_tag" text NOT NULL,
	"api_key_last4" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"max_instances" integer DEFAULT 25 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evolution_server_status_chk" CHECK ("evolution_server"."status" in ('active', 'full', 'disabled')),
	CONSTRAINT "evolution_server_capacity_chk" CHECK ("evolution_server"."max_instances" between 1 and 1000),
	CONSTRAINT "evolution_server_name_chk" CHECK (char_length("evolution_server"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_lid" text;
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "connection_mode" text;
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "connection_mode_changed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "transport" text;
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "alt_message_id" text;
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "queued_until" timestamp;
--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "conexion_directa" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_connection" ADD CONSTRAINT "direct_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_connection" ADD CONSTRAINT "direct_connection_server_id_evolution_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."evolution_server"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_connection_settings" ADD CONSTRAINT "direct_connection_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_connection_settings" ADD CONSTRAINT "direct_connection_settings_notice_accepted_by_user_id_fk" FOREIGN KEY ("notice_accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_connection_settings" ADD CONSTRAINT "direct_connection_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "evolution_server" ADD CONSTRAINT "evolution_server_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "direct_connection_org_uq" ON "direct_connection" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "direct_connection_server_instance_uq" ON "direct_connection" USING btree ("server_id","instance_name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "direct_connection_webhook_uq" ON "direct_connection" USING btree ("webhook_token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evolution_server_base_url_uq" ON "evolution_server" USING btree ("base_url");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_org_wa_lid_uq" ON "contact" USING btree ("organization_id","wa_lid") WHERE "contact"."wa_lid" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_org_alt_id_idx" ON "message" USING btree ("organization_id","alt_message_id") WHERE "message"."alt_message_id" is not null;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation" ADD CONSTRAINT "conversation_connection_mode_chk" CHECK ("conversation"."connection_mode" is null or "conversation"."connection_mode" in ('meta', 'directa', 'mixta')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "message" ADD CONSTRAINT "message_transport_chk" CHECK ("message"."transport" is null or "message"."transport" in ('meta', 'directa')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- RLS (misma política que la 0027) en las dos tablas con organización.
ALTER TABLE "direct_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "direct_connection" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "direct_connection";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "direct_connection" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "direct_connection_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "direct_connection_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "direct_connection_settings";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "direct_connection_settings" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
