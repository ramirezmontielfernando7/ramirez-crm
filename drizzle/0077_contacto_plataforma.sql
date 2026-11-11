-- 0077 — Ajustes de la PLATAFORMA (sin organización), por ahora uno solo: el
-- WhatsApp de contacto que el cliente ve en «¿Necesitas más?» de Uso y plan
-- y en «Mejora tu plan». Lo edita el administrador en Plataforma →
-- Organizaciones y Planes → «Planes y precios». Solo pool de sistema.
-- ADITIVO e idempotente. Reversa: scripts/sql/0077-reversa.sql
CREATE TABLE IF NOT EXISTS platform_setting (
  key text PRIMARY KEY,
  value text,
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  CONSTRAINT platform_setting_key_chk CHECK (key in ('contact_whatsapp')),
  CONSTRAINT platform_setting_value_chk CHECK (value is null or length(value) <= 200)
);
