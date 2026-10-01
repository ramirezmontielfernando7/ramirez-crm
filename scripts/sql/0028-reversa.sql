-- Reversa de drizzle/0028_credenciales_y_webhooks.sql, SIN migración nueva.
-- Idempotente; como superusuario (el dueño del esquema):
--   psql -U postgres -d <base> -f scripts/sql/0028-reversa.sql
--
-- ANTES de correrla:
--   1. Vuelve a desplegar el commit anterior al PR (la app vieja no conoce
--      estas columnas ni tablas; mientras corra el código nuevo, NO la corras).
--   2. ENCRYPTION_KEY debe ser la llave con la que están cifradas las filas
--      HOY. Si ya rotaste, es la NUEVA. El código anterior no sabe de
--      versiones: descifra todo con ENCRYPTION_KEY.
--   3. Si usas Instagram o Messenger por Zernio: el secreto del webhook
--      quedó cifrado y el código viejo lo lee de la columna en claro, que el
--      arranque dejó en NULL. Después de la reversa, vuelve a pegar el
--      secreto en Ajustes → Instagram / Messenger.
--
-- Qué hace: quita la FK compuesta, las tablas nuevas y las columnas nuevas.
-- No toca ningún token: siguen cifrados igual (AES-256-GCM, mismo formato).
-- Perder `webhook_unrouted` y `ai_usage` no afecta la operación.
ALTER TABLE "meta_credentials" DROP CONSTRAINT IF EXISTS "meta_credentials_org_waba_fk";
DROP TABLE IF EXISTS "whatsapp_business_account";
DROP TABLE IF EXISTS "webhook_unrouted";
DROP TABLE IF EXISTS "ai_usage";
DROP TABLE IF EXISTS "ai_quota";
ALTER TABLE "meta_credentials" DROP COLUMN IF EXISTS "key_version";
ALTER TABLE "instagram_credentials" DROP COLUMN IF EXISTS "key_version";
ALTER TABLE "instagram_credentials" DROP COLUMN IF EXISTS "webhook_secret_cipher";
ALTER TABLE "instagram_credentials" DROP COLUMN IF EXISTS "webhook_secret_iv";
ALTER TABLE "instagram_credentials" DROP COLUMN IF EXISTS "webhook_secret_tag";
ALTER TABLE "messenger_credentials" DROP COLUMN IF EXISTS "key_version";
ALTER TABLE "messenger_credentials" DROP COLUMN IF EXISTS "webhook_secret_cipher";
ALTER TABLE "messenger_credentials" DROP COLUMN IF EXISTS "webhook_secret_iv";
ALTER TABLE "messenger_credentials" DROP COLUMN IF EXISTS "webhook_secret_tag";
ALTER TABLE "zoom_credentials" DROP COLUMN IF EXISTS "key_version";
ALTER TABLE "google_credentials" DROP COLUMN IF EXISTS "key_version";
ALTER TABLE "capi_settings" DROP COLUMN IF EXISTS "key_version";
-- La fila de la 0028 en el registro de migraciones (su "when" del journal):
-- sin borrarla, volver a desplegar el PR NO volvería a aplicar la 0028 y la
-- app arrancaría sin sus columnas. La 0028 es idempotente: reaplicarla es seguro.
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1790836831812;
