-- Costos y Precios IA: precio propio del modelo de ANÁLISIS del asistente
-- (OPENROUTER_ANALYSIS_MODEL) y tipo de cambio OPCIONAL. Solo aditiva: el
-- código anterior ignora las columnas nuevas y la imagen anterior sigue
-- escribiendo `usd_to_local` como siempre. Idempotente. Reversa opcional:
-- scripts/sql/0056-reversa.sql.
ALTER TABLE "platform_ai_pricing" ALTER COLUMN "usd_to_local" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_ai_pricing" ADD COLUMN IF NOT EXISTS "analysis_input_usd_per_mtok" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "platform_ai_pricing" ADD COLUMN IF NOT EXISTS "analysis_output_usd_per_mtok" numeric(12, 6);
