-- Fase 1 multitenant, PR 4 (H5, segunda parte): RLS por organización.
--
-- Cada tabla de dominio: ENABLE + FORCE ROW LEVEL SECURITY y UNA política
--   organization_id = current_setting('app.org_id', true)
-- para leer (USING) y para escribir (WITH CHECK). Sin `app.org_id` fijado
-- (vacío o NULL) la comparación nunca es verdadera: cero filas, y ninguna
-- escritura pasa. `organization` usa su propio `id`.
--
-- A quién aplica: a `vocero_app` (la app atendiendo a una organización; el
-- PR 3 fija `app.org_id` en cada consulta). `vocero_system` tiene BYPASSRLS
-- (enrutamiento, arranque, better-auth) y el dueño `postgres` es
-- superusuario: a los dos no les cambia nada. FORCE cubre al dueño si algún
-- día no fuera superusuario.
--
-- Excepciones (sin organization_id, de plataforma; ver tests/db/rls.test.ts):
-- user, session, account, verification.
--
-- Idempotente. Reversa SIN migración nueva: scripts/sql/0027-reversa.sql,
-- o al instante sin tocar la base: DATABASE_URL → el usuario vocero_system
-- (BYPASSRLS). Guía: docs/rls.md.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ad_attribution',
    'agent_profile',
    'agent_test_case',
    'agent_test_run',
    'assignment_settings',
    'booking',
    'bot_api_key',
    'calendar_settings',
    'campaign',
    'campaign_recipient',
    'capi_settings',
    'contact',
    'contact_activity_event',
    'contact_assignment_event',
    'contact_participant',
    'contact_participant_event',
    'contact_tag',
    'contact_tag_assignment',
    'conversation',
    'conversion_event',
    'google_credentials',
    'instagram_credentials',
    'invitation',
    'kb_entry',
    'knowledge_entry',
    'lead',
    'lead_stage_event',
    'media_asset',
    'member',
    'message',
    'messenger_credentials',
    'meta_credentials',
    'offered_slot',
    'pipeline_stage',
    'sales_team',
    'team_chat_attachment',
    'team_chat_member',
    'team_chat_message',
    'team_chat_reaction',
    'team_chat_read_state',
    'team_chat_settings',
    'team_chat_thread',
    'template',
    'user_preference',
    'zoom_credentials'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'aislamiento_por_organizacion'
    ) THEN
      EXECUTE format(
        'CREATE POLICY aislamiento_por_organizacion ON %I AS PERMISSIVE FOR ALL TO PUBLIC '
        'USING (organization_id = current_setting(''app.org_id'', true)) '
        'WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
        t
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- La organización solo se ve (y se edita) a sí misma: su marca. Crearla o
-- borrarla es de plataforma (vocero_system).
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organization' AND policyname = 'aislamiento_por_organizacion'
  ) THEN
    CREATE POLICY aislamiento_por_organizacion ON "organization" AS PERMISSIVE FOR ALL TO PUBLIC
      USING (id = current_setting('app.org_id', true))
      WITH CHECK (id = current_setting('app.org_id', true));
  END IF;
END
$$;
