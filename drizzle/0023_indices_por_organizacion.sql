-- Fase 1 multitenant, PR 2 (H20): índices que empiezan por organization_id
-- en las 8 tablas de dominio que no tenían ninguno. Cada uno, con la consulta
-- que sirve, está comentado en src/lib/db/schema.ts.
--
-- Aditiva e idempotente (IF NOT EXISTS). Reversa: DROP INDEX de cada uno.
--
-- Sin CONCURRENTLY a propósito: el migrador de drizzle aplica todas las
-- migraciones pendientes dentro de UNA transacción, y CREATE INDEX
-- CONCURRENTLY no puede correr dentro de una. Con las tablas de hoy (sin
-- clientes todavía) cada índice tarda milisegundos; el bloqueo (SHARE: se
-- puede leer, las escrituras esperan) dura eso mismo.
CREATE INDEX IF NOT EXISTS "test_case_org_run_idx" ON "agent_test_case" USING btree ("organization_id","run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_recipient_org_campaign_status_idx" ON "campaign_recipient" USING btree ("organization_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_org_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_org_user_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_user_created_idx" ON "member" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offered_slot_org_conv_idx" ON "offered_slot" USING btree ("organization_id","conversation_id","start_utc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_chat_attachment_org_thread_idx" ON "team_chat_attachment" USING btree ("organization_id","thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_chat_message_org_thread_created_idx" ON "team_chat_message" USING btree ("organization_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_chat_reaction_org_message_idx" ON "team_chat_reaction" USING btree ("organization_id","message_id");