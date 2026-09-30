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
};
