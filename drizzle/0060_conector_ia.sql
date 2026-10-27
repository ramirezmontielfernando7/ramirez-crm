-- Conector de IA (047), PR 1 — Datos (nada visible todavía).
--
-- Cada persona podrá conectar SU propia IA (Claude, ChatGPT, n8n…) para que
-- actúe en el CRM como ella: mismos permisos, mismo alcance, nunca los chats
-- privados de «Mi número». Aquí solo quedan los datos; ninguna ruta los usa.
--
-- `ai_connector_settings`: lo que decide el Propietario (encendido, roles,
--   tope diario de mensajes; sin fila = apagado).
-- `ai_connection`: una IA conectada por una persona (OAuth o llave personal).
-- `ai_token`: sus llaves, solo el SHA-256 (acceso 1 h, renovación 30 días,
--   llave personal sin caducidad).
-- `ai_oauth_code`: código de un solo uso del «Iniciar sesión» (PKCE).
-- `ai_oauth_client`: apps registradas por registro dinámico. Tabla de
--   PLATAFORMA (sin organización, sin RLS, solo el pool de sistema).
-- `ai_action_log`: «Qué hizo tu IA» (nunca el texto de un mensaje).
-- `direct_number.ai_connector`: quinto interruptor de «Mi número», APAGADO.
-- `message.ai_connection_id`: «enviado por IA» (NULL en todo lo que existe).
-- `organization_module.conector_ia`: complemento OCULTO, APAGADO.
--
-- Solo aditiva (tablas nuevas y columnas NULL o con DEFAULT constante: sin
-- reescribir tablas). Idempotente.
-- Revertir: scripts/sql/0060-reversa.sql (con el complemento apagado).
CREATE TABLE IF NOT EXISTS "ai_action_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"connection_id" text,
	"tool" text NOT NULL,
	"outcome" text NOT NULL,
	"conversation_id" text,
	"contact_id" text,
	"summary" text,
	"at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_action_log_outcome_chk" CHECK ("ai_action_log"."outcome" in ('ok', 'denied', 'limited', 'error')),
	CONSTRAINT "ai_action_log_tool_chk" CHECK ("ai_action_log"."tool" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "ai_action_log_summary_chk" CHECK ("ai_action_log"."summary" is null or char_length("ai_action_log"."summary") <= 200)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text,
	"scopes" text[] DEFAULT '{read}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by" text,
	CONSTRAINT "ai_connection_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "ai_connection_kind_chk" CHECK ("ai_connection"."kind" in ('oauth', 'key')),
	CONSTRAINT "ai_connection_name_chk" CHECK (char_length("ai_connection"."name") between 1 and 80),
	CONSTRAINT "ai_connection_scopes_chk" CHECK ("ai_connection"."scopes" <@ array['read', 'write']::text[] and 'read' = any("ai_connection"."scopes"))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_connector_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"allowed_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"daily_message_limit" integer DEFAULT 100 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "ai_connector_settings_roles_chk" CHECK ("ai_connector_settings"."allowed_roles" <@ array['coordinador', 'asesor']::text[]),
	CONSTRAINT "ai_connector_settings_limit_chk" CHECK ("ai_connector_settings"."daily_message_limit" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_oauth_client" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "ai_oauth_client_name_chk" CHECK (char_length("ai_oauth_client"."client_name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_oauth_code" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_oauth_code_scopes_chk" CHECK ("ai_oauth_code"."scopes" <@ array['read', 'write']::text[])
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_token" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "ai_token_kind_chk" CHECK ("ai_token"."kind" in ('access', 'refresh', 'key')),
	CONSTRAINT "ai_token_expiry_chk" CHECK (("ai_token"."kind" = 'key') = ("ai_token"."expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "direct_number" ADD COLUMN IF NOT EXISTS "ai_connector" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "ai_connection_id" text;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "conector_ia" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_action_log" ADD CONSTRAINT "ai_action_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_action_log" ADD CONSTRAINT "ai_action_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_connection" ADD CONSTRAINT "ai_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_connection" ADD CONSTRAINT "ai_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_connection" ADD CONSTRAINT "ai_connection_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_connector_settings" ADD CONSTRAINT "ai_connector_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_connector_settings" ADD CONSTRAINT "ai_connector_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_oauth_code" ADD CONSTRAINT "ai_oauth_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_oauth_code" ADD CONSTRAINT "ai_oauth_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_token" ADD CONSTRAINT "ai_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_token" ADD CONSTRAINT "ai_token_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."ai_connection"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_action_log_org_at_idx" ON "ai_action_log" USING btree ("organization_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_action_log_org_user_at_idx" ON "ai_action_log" USING btree ("organization_id","user_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_connection_org_user_idx" ON "ai_connection" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_oauth_code_hash_uq" ON "ai_oauth_code" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_oauth_code_org_user_idx" ON "ai_oauth_code" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_token_hash_uq" ON "ai_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_token_connection_idx" ON "ai_token" USING btree ("organization_id","connection_id");
--> statement-breakpoint
-- RLS (misma política que la 0027) en las tablas con organización.
ALTER TABLE "ai_connector_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_connector_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "ai_connector_settings";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "ai_connector_settings" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "ai_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_connection" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "ai_connection";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "ai_connection" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "ai_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_token" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "ai_token";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "ai_token" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "ai_oauth_code" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_oauth_code" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "ai_oauth_code";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "ai_oauth_code" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "ai_action_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_action_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "ai_action_log";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "ai_action_log" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
