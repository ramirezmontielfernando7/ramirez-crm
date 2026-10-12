-- 038 (PR 6) — Campañas listas para reciclar leads: bajas de marketing de
-- Meta y tope de frecuencia por contacto.
--
-- `contact.wa_marketing_opt_out_at`: Meta respondió 131050 (la persona dejó de
-- recibir MARKETING de este negocio desde WhatsApp). No cambia `wa_consent`:
-- utilidad y autenticación le siguen llegando; las campañas de marketing la
-- omiten. NULL en todas las filas existentes.
-- `campaign_settings.marketing_min_days`: días mínimos entre dos campañas de
-- marketing al mismo contacto (0 = sin tope; por defecto 7).
-- `campaign_recipient_org_contact_sent_idx`: la consulta «¿recibió marketing
-- hace menos de N días?» por contacto.
--
-- Solo aditiva: el código anterior ignora las columnas y el índice nuevos.
-- Sin tablas nuevas (RLS sin cambios). Limpieza opcional:
-- scripts/sql/0046-reversa.sql. Idempotente: re-ejecutable sobre una base ya
-- migrada.
ALTER TABLE "campaign_settings" ADD COLUMN IF NOT EXISTS "marketing_min_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_marketing_opt_out_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_recipient_org_contact_sent_idx" ON "campaign_recipient" USING btree ("organization_id","contact_id","sent_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_marketing_min_days_chk" CHECK ("campaign_settings"."marketing_min_days" between 0 and 90);
EXCEPTION WHEN duplicate_object THEN null; END $$;
