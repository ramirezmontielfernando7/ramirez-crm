-- Reversa OPCIONAL de drizzle/0055 (conexión directa, PR 1: módulo y datos).
-- No hace falta para revertir el código: la 0055 solo agrega tablas y
-- columnas (NULL o con DEFAULT) y la imagen anterior las ignora. Sirve solo
-- para dejar el esquema exactamente como en la 0053.
--
-- BORRA datos: los servidores registrados, la conexión y los ajustes de cada
-- organización, el interruptor del módulo, el modo de cada chat, por dónde
-- salió cada mensaje y los `@lid` de los contactos. Antes, apaga el módulo
-- en /platform. Idempotente.
-- Uso (sesión SSH al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0055-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0055, hay que borrar esa fila para que se re-aplique.
BEGIN;
DROP TABLE IF EXISTS "direct_connection_settings";
DROP TABLE IF EXISTS "direct_connection";
DROP TABLE IF EXISTS "evolution_server";
DROP INDEX IF EXISTS "message_org_alt_id_idx";
DROP INDEX IF EXISTS "contact_org_wa_lid_uq";
ALTER TABLE "message" DROP CONSTRAINT IF EXISTS "message_transport_chk";
ALTER TABLE "message" DROP COLUMN IF EXISTS "queued_until";
ALTER TABLE "message" DROP COLUMN IF EXISTS "alt_message_id";
ALTER TABLE "message" DROP COLUMN IF EXISTS "transport";
ALTER TABLE "conversation" DROP CONSTRAINT IF EXISTS "conversation_connection_mode_chk";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "connection_mode_changed_at";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "connection_mode";
ALTER TABLE "contact" DROP COLUMN IF EXISTS "wa_lid";
ALTER TABLE "organization_module" DROP COLUMN IF EXISTS "conexion_directa";
COMMIT;
