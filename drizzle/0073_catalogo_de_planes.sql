-- 0073 — Catálogo de planes (nombre, precio, qué incluye) que edita el
-- administrador de plataforma. Tabla de PLATAFORMA (sin organización), solo
-- pool de sistema. Sin filas: valen los valores de fábrica del código.
-- ADITIVO. Reversa: scripts/sql/0073-reversa.sql
CREATE TABLE IF NOT EXISTS platform_plan_catalog (
  scope text PRIMARY KEY,
  name text,
  tagline text,
  price_monthly_mxn integer,
  price_yearly_mxn integer,
  implementation_fee_mxn integer,
  people_limit integer,
  storage_gb integer,
  features jsonb,
  recommended boolean,
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  CONSTRAINT platform_plan_catalog_scope_chk CHECK (scope in ('esencial', 'pro', 'ultra')),
  CONSTRAINT platform_plan_catalog_money_chk CHECK (
    (price_monthly_mxn is null or price_monthly_mxn between 0 and 1000000)
    and (price_yearly_mxn is null or price_yearly_mxn between 0 and 10000000)
    and (implementation_fee_mxn is null or implementation_fee_mxn between 0 and 1000000)
    and (people_limit is null or people_limit between 1 and 100000)
    and (storage_gb is null or storage_gb between 1 and 100000)
  )
);
