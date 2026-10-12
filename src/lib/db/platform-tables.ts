/**
 * Tablas de PLATAFORMA: las únicas sin `organization_id` (Fase 1 multitenant).
 *
 * Todo lo demás pertenece a una organización y lo vigila
 * `tests/unit/tenant-schema.test.ts`. Agregar aquí una tabla es una decisión
 * de seguridad: va con el motivo, y el revisor la tiene que ver.
 */
export const PLATFORM_TABLES: Readonly<Record<string, string>> = {
  user: "better-auth: una cuenta de persona; su negocio lo dice `member`",
  session: "better-auth: sesiones de login, anteriores a elegir organización",
  account: "better-auth: credenciales de login de cada `user`",
  verification: "better-auth: tokens de verificación, sin negocio",
  organization: "la raíz del tenant: ella ES la organización",
  platform_admin: "Fase 3: administradores de la plataforma, por encima de las organizaciones (solo pool de sistema)",
  platform_audit_log: "Fase 3: bitácora del administrador de plataforma; sobrevive al borrado de la organización (solo pool de sistema)",
  account_link_token: "Fase 3: enlaces de un solo uso para poner contraseña, antes de tener sesión (solo pool de sistema)",
  platform_ai_pricing:
    "036 PR 3: precios de IA y tipo de cambio que captura el administrador de plataforma, para estimar el costo de TODAS las organizaciones (solo pool de sistema)",
  webhook_unrouted:
    "eventos de Meta que no se pudieron enrutar: justo no se sabe de qué organización son (solo pool de sistema, cifrados, 7 días)",
};
