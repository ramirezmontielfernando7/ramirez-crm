-- 038 (PR 3) — Análisis guardado por conversación (lo usa el asistente
-- interno). Una fila por conversación: se analiza UNA vez y se reutiliza
-- mientras no lleguen mensajes nuevos (`message_count`). Categorías cerradas
-- por CHECK; lo que el modelo no sabe queda 'no_se_sabe'. `status =
-- 'insufficient'` marca, sin llamar al modelo, las conversaciones sin
-- información suficiente (vacías, cortas, solo multimedia o automáticos).
-- `summary` trae los datos reales (lo ve el Propietario); `summary_masked`,
-- fichas en vez de datos personales (lo que se le vuelve a dar al modelo).
--
-- Solo aditiva: una tabla nueva con RLS forzado (política de la 0027) y FK
-- compuesta a su conversación (se borra con ella). El código anterior la
-- ignora. Limpieza opcional: scripts/sql/0049-reversa.sql. Idempotente:
-- re-ejecutable sobre una base ya migrada.
CREATE TABLE IF NOT EXISTS "conversation_insight" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text NOT NULL,
	"insufficient_reason" text,
	"message_count" integer NOT NULL,
	"outcome" text,
	"loss_reason" text,
	"objection" text,
	"advisor_performance" text,
	"confidence" text,
	"summary" text,
	"summary_masked" text,
	"model" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"analyzed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_insight_org_conversation_uq" UNIQUE("organization_id","conversation_id"),
	CONSTRAINT "conversation_insight_status_chk" CHECK ("conversation_insight"."status" in ('analyzed', 'insufficient')),
	CONSTRAINT "conversation_insight_reason_chk" CHECK ("conversation_insight"."insufficient_reason" is null or "conversation_insight"."insufficient_reason" in ('vacia', 'muy_corta', 'solo_multimedia', 'solo_automaticos', 'sin_mensajes_del_cliente')),
	CONSTRAINT "conversation_insight_outcome_chk" CHECK ("conversation_insight"."outcome" is null or "conversation_insight"."outcome" in ('venta', 'perdida', 'en_curso', 'sin_respuesta', 'no_se_sabe')),
	CONSTRAINT "conversation_insight_loss_chk" CHECK ("conversation_insight"."loss_reason" is null or "conversation_insight"."loss_reason" in ('precio', 'no_interesado', 'eligio_competencia', 'sin_respuesta', 'fuera_de_zona', 'sin_disponibilidad', 'otro', 'no_aplica', 'no_se_sabe')),
	CONSTRAINT "conversation_insight_objection_chk" CHECK ("conversation_insight"."objection" is null or "conversation_insight"."objection" in ('precio', 'tiempo_entrega', 'confianza', 'forma_pago', 'caracteristicas', 'ninguna', 'otro', 'no_se_sabe')),
	CONSTRAINT "conversation_insight_advisor_chk" CHECK ("conversation_insight"."advisor_performance" is null or "conversation_insight"."advisor_performance" in ('bueno', 'regular', 'malo', 'sin_asesor', 'no_se_sabe')),
	CONSTRAINT "conversation_insight_confidence_chk" CHECK ("conversation_insight"."confidence" is null or "conversation_insight"."confidence" in ('alta', 'media', 'baja')),
	CONSTRAINT "conversation_insight_count_chk" CHECK ("conversation_insight"."message_count" >= 0),
	CONSTRAINT "conversation_insight_summary_chk" CHECK (char_length("conversation_insight"."summary") <= 500 and char_length("conversation_insight"."summary_masked") <= 500)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_insight" ADD CONSTRAINT "conversation_insight_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversation_insight" ADD CONSTRAINT "conversation_insight_org_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversation"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_insight_org_analyzed_idx" ON "conversation_insight" USING btree ("organization_id","analyzed_at");--> statement-breakpoint
-- RLS (misma política que la 0027).
ALTER TABLE "conversation_insight" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_insight" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS aislamiento_por_organizacion ON "conversation_insight";--> statement-breakpoint
CREATE POLICY aislamiento_por_organizacion ON "conversation_insight" USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
