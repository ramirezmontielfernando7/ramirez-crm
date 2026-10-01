/**
 * Fase 3, PR 2 (H10) — Cabeceras de seguridad de toda la app.
 *
 * - HSTS de 1 DÍA (`max-age=86400`), sin `includeSubDomains`: se sube en un
 *   PR posterior cuando esté comprobado que todo va por HTTPS.
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY`: la app no se puede
 *   meter en un iframe ajeno (clickjacking). Nada de Vocero usa iframes.
 * - CSP en MODO REPORTE (`Content-Security-Policy-Report-Only`): no bloquea
 *   nada; el navegador avisa a `/api/csp-report` lo que SÍ bloquearía. Se
 *   vuelve obligatoria en un PR chico tras una semana de reportes limpios.
 *   `script-src 'unsafe-inline'`: Next mete scripts en línea para hidratar;
 *   quitarlo exige nonces (y renderizar todo por request). `style-src
 *   'unsafe-inline'`: el acento de marca va en un `<style>` en línea.
 */

export const HSTS_MAX_AGE_SECONDS = 86_400;

export function cspReportOnly(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

export function securityHeaders(dev: boolean): { key: string; value: string }[] {
  return [
    { key: "Strict-Transport-Security", value: `max-age=${HSTS_MAX_AGE_SECONDS}` },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    // Lo único que se aplica ya de la CSP: nadie nos mete en un iframe.
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "Content-Security-Policy-Report-Only", value: cspReportOnly(dev) },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}
