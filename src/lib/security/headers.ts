/**
 * Fase 3, PR 2 (H10) — Cabeceras de seguridad de toda la app.
 *
 * Fase 2 del lanzamiento (2026-11, S-09):
 * - HSTS de 1 AÑO (`max-age=31536000`), sin `includeSubDomains` ni
 *   `preload`: solo obliga HTTPS en el dominio de la app (Coolify ya lo da
 *   con Let's Encrypt). Sin `includeSubDomains` no afecta a otros
 *   subdominios del negocio que aún no tengan HTTPS.
 * - La CSP completa pasa de «solo reporta» a OBLIGATORIA. Sigue mandando sus
 *   reportes a `/api/csp-report` (el log dice «la CSP bloqueó algo»), y el
 *   job e2e del CI falla si en toda la corrida llega uno solo.
 *   `script-src 'unsafe-inline'`: Next mete scripts en línea para hidratar;
 *   quitarlo exige nonces (y renderizar todo por request). `style-src
 *   'unsafe-inline'`: el acento de marca va en un `<style>` en línea.
 *   Para volver atrás sin código: no existe interruptor; revertir el PR.
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY`: la app no se puede
 *   meter en un iframe ajeno (clickjacking). Nada de Vocero usa iframes.
 */

export const HSTS_MAX_AGE_SECONDS = 31_536_000;

export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    // Tech Provider: el SDK de Facebook abre «Conectar con Facebook».
    `script-src 'self' 'unsafe-inline' https://connect.facebook.net${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    // En desarrollo, el recargado en caliente de Next usa un WebSocket.
    `connect-src 'self' https://*.facebook.com${dev ? " ws: wss:" : ""}`,
    "frame-src https://*.facebook.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "Strict-Transport-Security", value: `max-age=${HSTS_MAX_AGE_SECONDS}` },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}

/**
 * La CSP obligatoria. NO va en las rutas que sirven adjuntos: ellas mandan
 * su propia CSP `sandbox` (H9) y una cabecera de next.config la pisaría (el
 * adjunto HTML volvería a poder ejecutarse). Esas rutas siguen con
 * `X-Frame-Options: DENY`.
 */
export function enforcedCsp(dev: boolean): { key: string; value: string } {
  return { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) };
}

/**
 * Rutas que mandan su propia CSP: los adjuntos (`sandbox`, src/lib/
 * attachment-headers.ts) y el favicon SVG de la marca. Si agregas otra, súmala
 * aquí (tests/unit/security-headers.test.ts lo vigila).
 */
export const OWN_CSP_PATHS = [
  "api/media/",
  "api/team-chat/attachments/",
  "api/knowledge/[^/]+/file",
  "api/branding/favicon",
] as const;

export const OWN_CSP_SOURCE = `/:path((?!${OWN_CSP_PATHS.join("|")}).*)`;
