-- Reversa de drizzle/0030_modulos_por_organizacion.sql, SIN migración nueva.
-- Idempotente; como dueño del esquema, DESPUÉS de volver a desplegar el
-- commit anterior al PR 3 (el código viejo vuelve a leer CAMPAIGNS, AGENDA,
-- ATRIBUCION y CHANNELS del entorno para TODA la instancia):
--   psql -U postgres -d <base> -f scripts/sql/0030-reversa.sql
--
-- OJO: se pierde lo que cada organización tenía encendido. Revísalo antes:
--   select organization_id, campaigns, agenda, atribucion, channels from organization_module;
-- Si alguna organización tiene parent_id, se pierde (hoy nada lo escribe).
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_parent_not_self_chk";
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_parent_id_organization_id_fk";
DROP INDEX IF EXISTS "organization_parent_idx";
ALTER TABLE "organization" DROP COLUMN IF EXISTS "parent_id";
DROP TABLE IF EXISTS "organization_module";
-- La fila de la 0030 en el registro de migraciones (su "when" del journal):
-- así, volver a desplegar el PR la aplica otra vez (es idempotente).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790872943763;
