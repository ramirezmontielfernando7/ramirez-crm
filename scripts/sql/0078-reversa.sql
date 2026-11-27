-- Reversa de drizzle/0078 (Plataforma para vender, spec 048). Quita la prueba
-- gratis, el «pagado hasta», la bitácora de pagos, los interruptores de
-- emergencia, el aviso a todos y los módulos editados de cada plan (vuelven
-- los de fábrica). Ninguna organización pierde chats ni contactos. Idempotente.
-- Uso: psql -U postgres -d vocero -v ON_ERROR_STOP=1 -f 0078-reversa.sql
-- La fila de drizzle.__drizzle_migrations NO se toca.
BEGIN;
DROP TABLE IF EXISTS organization_payment;
DROP TABLE IF EXISTS organization_billing;
DROP TABLE IF EXISTS platform_kill_switch;
DROP TABLE IF EXISTS platform_broadcast;
ALTER TABLE platform_plan_catalog DROP COLUMN IF EXISTS modules;
COMMIT;
