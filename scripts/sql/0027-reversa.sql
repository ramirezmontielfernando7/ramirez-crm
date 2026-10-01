-- Reversa de drizzle/0027_rls_por_organizacion.sql, SIN migración nueva.
-- Idempotente; como superusuario (Terminal de Postgres en Coolify):
--   psql -U postgres -d <base> -f scripts/sql/0027-reversa.sql
-- (o pegando el bloque en `psql -U postgres -d <base>`).
--
-- Quita la política y apaga RLS en TODA tabla de public que la tenga: no
-- depende de la lista de la migración, así que sirve aunque haya tablas
-- nuevas. La app sigue funcionando igual que con el PR 3 (cada consulta
-- sigue fijando app.org_id; simplemente nadie lo exige).
--
-- Reversa más rápida, sin tocar la base: DATABASE_URL → el usuario
-- vocero_system (BYPASSRLS) y redesplegar. Ver docs/rls.md.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (c.relrowsecurity OR c.relforcerowsecurity)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS aislamiento_por_organizacion ON %I', r.relname);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END
$$;
