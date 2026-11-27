-- Reversa de drizzle/0076 (plan Inicio). Las organizaciones con plan 'inicio'
-- pasan a 'custom' y se quitan las filas 'inicio'; los topes de IA de
-- esencial/pro/ultra NO se devuelven (Fer los puede cambiar en Plataforma).
-- Idempotente.
-- Uso: psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0076-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
UPDATE organization_plan SET plan_key = 'custom' WHERE plan_key = 'inicio';
DELETE FROM platform_ai_defaults WHERE scope = 'inicio';
DELETE FROM platform_plan_catalog WHERE scope = 'inicio';
ALTER TABLE organization_plan DROP CONSTRAINT IF EXISTS organization_plan_key_chk;
ALTER TABLE organization_plan ADD CONSTRAINT organization_plan_key_chk CHECK (plan_key in ('esencial', 'pro', 'ultra', 'custom'));
ALTER TABLE platform_ai_defaults DROP CONSTRAINT IF EXISTS platform_ai_defaults_scope_chk;
ALTER TABLE platform_ai_defaults ADD CONSTRAINT platform_ai_defaults_scope_chk CHECK (scope in ('instance', 'esencial', 'pro', 'ultra'));
ALTER TABLE platform_plan_catalog DROP CONSTRAINT IF EXISTS platform_plan_catalog_scope_chk;
ALTER TABLE platform_plan_catalog ADD CONSTRAINT platform_plan_catalog_scope_chk CHECK (scope in ('esencial', 'pro', 'ultra'));
COMMIT;
