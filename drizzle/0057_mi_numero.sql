-- Mi número (046), PR 1 — Datos (nada visible todavía).
--
-- Cada persona autorizada podrá vincular SU WhatsApp («Mi número») además del
-- número de la empresa. Aquí solo quedan los datos; el código de hoy sigue
-- leyendo únicamente lo de la empresa.
--
-- `direct_number`: el «Mi número» de una persona (dueña, tipo personal o de
--   la empresa, los cuatro interruptores de privacidad APAGADOS, aviso
--   aceptado, revocado). Un número vivo por persona.
-- `direct_connection.direct_number_id`: NULL = la conexión de la EMPRESA (una
--   por organización, como antes); con valor, la instancia de ese número.
-- `conversation.direct_number_id`: NULL = chat del número de la empresa (todo
--   lo que ya existe); con valor, el chat de ese número, PRIVADO de su dueño.
--   Un cliente tiene un chat por número pero una sola ficha (`contact`).
-- `conversation.client_marked_at/_by`: «Es cliente» (el chat pasó al CRM).
-- `contact.private_to_number_id`: un contacto que nació en un chat privado de
--   «Mi número» (no es del CRM; solo lo ve el dueño de ese número).
-- `conversation_access`: solicitudes y permisos para VER un chat ajeno.
-- `conversation_access_log`: «Quién ha visto tus chats».
-- `organization_module.mi_numero` + `mi_numero_max`: complemento OCULTO
--   (requiere `conexion_directa`) y cuántos números puede tener la empresa.
--
-- Dos índices únicos cambian de forma (se crea el nuevo ANTES de borrar el
-- viejo: la regla nunca deja de cumplirse):
--   conversation_org_contact_real_uq → conversation_org_contact_company_uq
--     (un chat por contacto en el número de la empresa) + uno por número.
--   direct_connection_org_uq → direct_connection_org_company_uq
--     (una conexión de la empresa por organización) + una por número.
-- Los demás cambios son aditivos (tablas y columnas NULL o con DEFAULT). Los
-- índices nuevos de `conversation` recorren la tabla una vez. Idempotente.
--
-- Revertir: scripts/sql/0057-reversa.sql (con el módulo apagado en /platform).
-- OJO: la imagen ANTERIOR no sabe vincular una conexión nueva con este esquema
-- (su ON CONFLICT buscaba el índice viejo); si se revierte el código, correr
-- también la reversa.
CREATE TABLE IF NOT EXISTS "direct_number" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'personal' NOT NULL,
	"label" text,
	"share_clients" boolean DEFAULT false NOT NULL,
	"overlap_notice" boolean DEFAULT false NOT NULL,
	"allow_view_requests" boolean DEFAULT false NOT NULL,
	"ai_replies" boolean DEFAULT false NOT NULL,
	"notice_accepted_at" timestamp,
	"authorized_by" text,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "direct_number_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "direct_number_kind_chk" CHECK ("direct_number"."kind" in ('personal', 'empresa')),
	CONSTRAINT "direct_number_label_chk" CHECK ("direct_number"."label" is null or char_length("direct_number"."label") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_access" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	"decided_by" text,
	CONSTRAINT "conversation_access_status_chk" CHECK ("conversation_access"."status" in ('pending', 'granted', 'rejected', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "direct_number_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "client_marked_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "client_marked_by" text;--> statement-breakpoint
ALTER TABLE "direct_connection" ADD COLUMN IF NOT EXISTS "direct_number_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "private_to_number_id" text;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "mi_numero" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_module" ADD COLUMN IF NOT EXISTS "mi_numero_max" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_number" ADD CONSTRAINT "direct_number_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_number" ADD CONSTRAINT "direct_number_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_number" ADD CONSTRAINT "direct_number_authorized_by_user_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_access" ADD CONSTRAINT "conversation_access_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_access" ADD CONSTRAINT "conversation_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_access" ADD CONSTRAINT "conversation_access_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_access" ADD CONSTRAINT "conversation_access_org_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversation"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_access_log" ADD CONSTRAINT "conversation_access_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_access_log" ADD CONSTRAINT "conversation_access_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_access_log" ADD CONSTRAINT "conversation_access_log_org_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversation"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation" ADD CONSTRAINT "conversation_client_marked_by_user_id_fk" FOREIGN KEY ("client_marked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation" ADD CONSTRAINT "conversation_org_direct_number_fk" FOREIGN KEY ("organization_id","direct_number_id") REFERENCES "public"."direct_number"("organization_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contact" ADD CONSTRAINT "contact_org_private_number_fk" FOREIGN KEY ("organization_id","private_to_number_id") REFERENCES "public"."direct_number"("organization_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_connection" ADD CONSTRAINT "direct_connection_org_id_uq" UNIQUE("organization_id","id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "direct_connection" ADD CONSTRAINT "direct_connection_org_direct_number_fk" FOREIGN KEY ("organization_id","direct_number_id") REFERENCES "public"."direct_number"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_module" ADD CONSTRAINT "organization_module_mi_numero_chk" CHECK (not "organization_module"."mi_numero" or "organization_module"."conexion_directa");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organization_module" ADD CONSTRAINT "organization_module_mi_numero_max_chk" CHECK ("organization_module"."mi_numero_max" between 0 and 200);
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "direct_number_org_user_uq" ON "direct_number" USING btree ("organization_id","user_id") WHERE "direct_number"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_access_live_uq" ON "conversation_access" USING btree ("conversation_id","user_id") WHERE "conversation_access"."status" in ('pending', 'granted');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_access_org_user_idx" ON "conversation_access" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_access_log_conversation_idx" ON "conversation_access_log" USING btree ("organization_id","conversation_id","viewed_at");--> statement-breakpoint
-- Los índices únicos que cambian de forma: primero el nuevo, luego se borra el viejo.
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_org_contact_company_uq" ON "conversation" USING btree ("organization_id","contact_id") WHERE "conversation"."is_test" = false and "conversation"."direct_number_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_org_number_contact_uq" ON "conversation" USING btree ("organization_id","direct_number_id","contact_id") WHERE "conversation"."direct_number_id" is not null;--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_org_contact_real_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "direct_connection_org_company_uq" ON "direct_connection" USING btree ("organization_id") WHERE "direct_connection"."direct_number_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "direct_connection_number_uq" ON "direct_connection" USING btree ("direct_number_id") WHERE "direct_connection"."direct_number_id" is not null;--> statement-breakpoint
DROP INDEX IF EXISTS "direct_connection_org_uq";--> statement-breakpoint
-- RLS (misma política que la 0027) en las tres tablas nuevas.
ALTER TABLE "direct_number" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "direct_number" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "direct_number";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "direct_number" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "conversation_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_access" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "conversation_access";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "conversation_access" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "conversation_access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_access_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "conversation_access_log";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "conversation_access_log" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
