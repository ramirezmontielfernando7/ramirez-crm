-- 041 — Chats de campaña fuera de la Bandeja principal.
--
-- `conversation.campaign_pending_id`: la campaña masiva que inició el chat y
-- que el contacto aún no responde. No NULL = el chat vive en la pestaña
-- «Campañas» de la Bandeja (no en la principal, no cuenta como no leído, no
-- manda avisos en vivo). Lo marca el despachador de campañas solo si el
-- contacto nunca había escrito (`last_inbound_at` NULL).
-- `conversation.campaign_replied_id`: la campaña a la que respondió; el
-- primer entrante mueve el valor de la columna anterior a esta en la misma
-- sentencia («Respondió a campaña X»).
--
-- Sin FK: borrar una campaña no toca el chat (la etiqueta dice «una
-- campaña»). La tabla ya tiene RLS; no hace falta política nueva.
--
-- Solo aditiva (el código anterior ignora las columnas). No rellena nada: la
-- reclasificación de los chats viejos es `scripts/reclasificar-campanas.mjs`,
-- que corre el operador. Idempotente: re-ejecutable.
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "campaign_pending_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "campaign_replied_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_org_campaign_pending_idx" ON "conversation" USING btree ("organization_id","campaign_pending_id") WHERE "conversation"."campaign_pending_id" is not null;
