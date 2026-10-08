-- Etiquetas limpias — `contact_tag.system_origin`.
--
-- NULL = etiqueta normal (de una persona). 'import' = la automática
-- «Import: archivo» que crea la importación: no sale en la cápsula, el menú,
-- el filtro ni los selectores (sí en Audiencias, que la lee por
-- `audience_import.tag_id`). No se deduce del nombre: una persona puede crear
-- una etiqueta que empiece con «Import:».
--
-- Relleno retroactivo: SOLO las etiquetas enlazadas por
-- `audience_import.tag_id`. Las «Import: …» de importaciones de Contactos
-- anteriores a las audiencias NO se marcan aquí (se limpian a mano, con la
-- fusión de etiquetas).
--
-- Solo aditiva: el código anterior ignora la columna. Idempotente:
-- re-ejecutable sobre una base ya migrada. La tabla ya tiene RLS forzado.
ALTER TABLE "contact_tag" ADD COLUMN IF NOT EXISTS "system_origin" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_tag_system_origin_chk'
  ) THEN
    ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_system_origin_chk"
      CHECK ("system_origin" is null or "system_origin" in ('import'));
  END IF;
END $$;--> statement-breakpoint
UPDATE "contact_tag" t
SET "system_origin" = 'import'
WHERE t."system_origin" IS NULL
  AND EXISTS (
    SELECT 1 FROM "audience_import" a
    WHERE a."organization_id" = t."organization_id" AND a."tag_id" = t."id"
  );
