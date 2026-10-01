-- Reversa de drizzle/0029_plataforma.sql, SIN migración nueva.
-- Idempotente; como dueño del esquema, DESPUÉS de volver a desplegar el
-- commit anterior al PR 2 (el código viejo no conoce estas columnas):
--   psql -U postgres -d <base> -f scripts/sql/0029-reversa.sql
--
-- OJO: borra el estado de las organizaciones. Una organización SUSPENDIDA o
-- BORRADA vuelve a estar activa (el código viejo no sabe de estados).
-- Revísalo antes: select id, name, status from organization where status <> 'active';
-- También se pierden la bitácora de plataforma, los administradores y los
-- enlaces pendientes (ninguno afecta a la operación de los negocios).
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_status_chk";
ALTER TABLE "organization" DROP COLUMN IF EXISTS "status";
ALTER TABLE "organization" DROP COLUMN IF EXISTS "status_reason";
ALTER TABLE "organization" DROP COLUMN IF EXISTS "status_changed_at";
ALTER TABLE "organization" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "organization" DROP COLUMN IF EXISTS "purge_after";
DROP TABLE IF EXISTS "account_link_token";
DROP TABLE IF EXISTS "platform_admin";
DROP TABLE IF EXISTS "platform_audit_log";
-- La fila de la 0029 en el registro de migraciones (su "when" del journal):
-- así, volver a desplegar el PR la aplica otra vez (es idempotente).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790862846571;
