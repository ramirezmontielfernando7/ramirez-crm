/**
 * Fase 1 multitenant — la organización del propietario de la plataforma
 * (`PLATFORM_ORG_ID`). Hasta que exista el administrador de plataforma
 * (Fase 3), es lo que decide quién ve los secretos de la plataforma (el
 * token del webhook, H7) y a quién pertenece la `BOT_API_KEY` (H2).
 *
 * `null` si no está configurada. NUNCA hay respaldo a "la primera
 * organización": sin la variable, nadie es la plataforma.
 */
export function platformOrgId(): string | null {
  // Directo de process.env (como isMockEnabled): variable de operación, sin
  // la caché de getEnv(). Validada como texto opcional en lib/env.ts.
  const id = process.env.PLATFORM_ORG_ID?.trim();
  return id ? id : null;
}

export function isPlatformOrg(organizationId: string): boolean {
  const id = platformOrgId();
  return id !== null && id === organizationId;
}
