-- 038 (PR 2) — Motor del asistente interno: lo que se guarda de cada respuesta.
--
-- `assistant_message.masked_content`: el texto como lo vio el modelo, con
-- nombres, teléfonos y correos ENMASCARADOS. Es lo que se le recuerda en las
-- preguntas siguientes del hilo (el historial nunca reabre los datos reales).
-- `assistant_message.sources`: de dónde salen los datos de la respuesta (las
-- consultas del catálogo que corrieron, sus parámetros y resultados, cuáles
-- citó el modelo y los avisos de verificación). NULL en las preguntas.
--
-- Solo aditiva (dos columnas NULL y un CHECK que toda fila existente cumple,
-- porque nace NULL): el código anterior las ignora. Las tablas ya tienen RLS
-- forzado desde la 0047. Limpieza opcional: scripts/sql/0048-reversa.sql.
-- Idempotente: re-ejecutable sobre una base ya migrada.
ALTER TABLE "assistant_message" ADD COLUMN IF NOT EXISTS "masked_content" text;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN IF NOT EXISTS "sources" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_message" DROP CONSTRAINT IF EXISTS "assistant_message_masked_chk";--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_masked_chk" CHECK (char_length("assistant_message"."masked_content") <= 20000);
