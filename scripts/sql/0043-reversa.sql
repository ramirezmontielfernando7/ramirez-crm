-- Reversa OPCIONAL de drizzle/0043 (037: grupos de documentos y documentos
-- exclusivos de un agente). La 0043 solo agrega, así que la imagen anterior
-- arranca igual sobre una base migrada. PERO la imagen anterior ignora
-- `agent_id`: un documento EXCLUSIVO de un agente lo leerían TODOS los
-- agentes. Si vuelves a la imagen anterior y hay exclusivos, corre esto
-- ANTES de desplegarla (o pásalos tú a General con
-- `update kb_document set agent_id = null where agent_id is not null`, si
-- está bien que los lean todos).
--
-- BORRA datos: los documentos exclusivos (y sus fragmentos, por la FK) y los
-- grupos (sus documentos quedan, en General). Idempotente. Uso (sesión SSH
-- al servidor):
--   psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0043-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca: si después se vuelve a
-- desplegar el código con 0043, hay que borrar esa fila para que se re-aplique.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kb_document' AND column_name = 'agent_id') THEN
    DELETE FROM "kb_document" WHERE "agent_id" IS NOT NULL;
  END IF;
END $$;
ALTER TABLE "kb_document" DROP CONSTRAINT IF EXISTS "kb_document_owner_chk";
ALTER TABLE "kb_document" DROP CONSTRAINT IF EXISTS "kb_document_org_group_fk";
ALTER TABLE "kb_document" DROP CONSTRAINT IF EXISTS "kb_document_org_agent_fk";
DROP INDEX IF EXISTS "kb_document_org_group_idx";
DROP INDEX IF EXISTS "kb_document_org_agent_idx";
ALTER TABLE "kb_document" DROP COLUMN IF EXISTS "group_id";
ALTER TABLE "kb_document" DROP COLUMN IF EXISTS "agent_id";
DROP TABLE IF EXISTS "kb_document_group";
COMMIT;
