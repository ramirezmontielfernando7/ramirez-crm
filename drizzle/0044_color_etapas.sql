-- Color de las etapas del pipeline — `pipeline_stage.color`.
--
-- Una CLAVE de la paleta de etiquetas (`TAG_COLORS` de lib/tags.ts), no un hex
-- libre. NULL = sin color elegido: la Bandeja usa el respaldo por nombre
-- (Nuevo, En conversación, Interesado, Cliente, Perdido) y, si tampoco hay, gris.
--
-- Solo aditiva: el código anterior ignora la columna; sin relleno retroactivo.
-- Idempotente: re-ejecutable sobre una base ya migrada. La tabla ya tiene RLS
-- forzado.
ALTER TABLE "pipeline_stage" ADD COLUMN IF NOT EXISTS "color" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stage_color_chk'
  ) THEN
    ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_color_chk"
      CHECK ("color" is null or "color" in ('gris', 'azul', 'verde', 'ambar', 'rojo', 'morado'));
  END IF;
END $$;
