-- Las columnas heredan ENABLE/FORCE RLS y aislamiento_por_organizacion
-- de contact y message (0027); no hay tablas ni políticas globales nuevas.
ALTER TABLE contact ADD COLUMN wa_group_jid text;
--> statement-breakpoint
ALTER TABLE contact ADD CONSTRAINT contact_group_jid_chk CHECK (wa_group_jid IS NULL OR (channel = 'whatsapp' AND wa_group_jid ~ '^[0-9]+(-[0-9]+)?@g[.]us$' AND phone IS NULL AND wa_user_id IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX contact_org_group_jid_uq ON contact (organization_id, wa_group_jid) WHERE wa_group_jid IS NOT NULL;
--> statement-breakpoint
ALTER TABLE message ADD COLUMN group_sender text;
--> statement-breakpoint
ALTER TABLE message ADD COLUMN group_sender_id text;
