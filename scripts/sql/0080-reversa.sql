-- Reversa de 0080 (varios números oficiales). ATENCIÓN: solo es seguro si cada
-- organización tiene UN número en meta_credentials; si no, borra los extra
-- (deja el más antiguo) antes de recrear el índice único.
DROP INDEX IF EXISTS "conversation_org_wa_number_idx";
ALTER TABLE "conversation" DROP COLUMN IF EXISTS "wa_phone_number_id";
DELETE FROM "meta_credentials" m USING (
  SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS rn FROM "meta_credentials"
) d WHERE m.id = d.id AND d.rn > 1;
ALTER TABLE "meta_credentials" DROP COLUMN IF EXISTS "label";
DROP INDEX IF EXISTS "meta_credentials_org_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "meta_credentials_org_uq" ON "meta_credentials" USING btree ("organization_id");
