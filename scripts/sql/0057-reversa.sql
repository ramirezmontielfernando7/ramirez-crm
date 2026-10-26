-- Reversa de drizzle/0057 (Mi número, PR 1: datos).
-- Deja el esquema como en la 0056: borra las tres tablas nuevas y las
-- columnas, y regresa los dos índices únicos a su forma anterior. Hace falta
-- si se REVIERTE EL CÓDIGO a una imagen anterior (esa imagen busca el índice
-- viejo `direct_connection_org_uq` al vincular).
--
-- BORRA datos: los «Mi número», sus conexiones y sus chats (los que tengan
-- número), las solicitudes y la bitácora de quién vio qué. Antes, apaga «Mi
-- número» en /platform y borra sus instancias del servidor. Idempotente.
-- Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0057-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0057, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "conversation_access_log";
DROP TABLE IF EXISTS "conversation_access";
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversation' AND column_name = 'direct_number_id') THEN
		DELETE FROM "conversation" WHERE "direct_number_id" IS NOT NULL;
		DELETE FROM "contact" WHERE "private_to_number_id" IS NOT NULL;
		DELETE FROM "direct_connection" WHERE "direct_number_id" IS NOT NULL;
	END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_org_contact_real_uq" ON "conversation" USING btree ("organization_id","contact_id") WHERE "conversation"."is_test" = false;
DROP INDEX IF EXISTS "conversation_org_contact_company_uq";
DROP INDEX IF EXISTS "conversation_org_number_contact_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "direct_connection_org_uq" ON "direct_connection" USING btree ("organization_id");
DROP INDEX IF EXISTS "direct_connection_org_company_uq";
DROP INDEX IF EXISTS "direct_connection_number_uq";
ALTER TABLE "direct_connection" DROP CONSTRAINT IF EXISTS "direct_connection_org_direct_number_fk";
ALTER TABLE "direct_connection" DROP CONSTRAINT IF EXISTS "direct_connection_org_id_uq";
ALTER TABLE "direct_connection" DROP COLUMN IF EXISTS "direct_number_id";
ALTER TABLE "contact" DROP CONSTRAINT IF EXISTS "contact_org_private_number_fk";
ALTER TABLE "contact" DROP COLUMN IF EXISTS "private_to_number_id";
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_org_direct_number_fk";
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_client_marked_by_user_id_fk";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "client_marked_by";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "client_marked_at";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "direct_number_id";
DROP TABLE IF EXISTS "direct_number";
ALTER TABLE "organization_module" DROP CONSTRAINT IF EXISTS "organization_module_mi_numero_max_chk";
ALTER TABLE "organization_module" DROP CONSTRAINT IF EXISTS "organization_module_mi_numero_chk";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "mi_numero_max";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "mi_numero";
COMMIT;
