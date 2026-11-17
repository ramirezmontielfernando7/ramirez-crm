/**
 * Auditoría 2026-11 — Freno CSRF para la API propia.
 *
 * La sesión viaja en una cookie `SameSite=Lax`, y para el navegador TODOS los
 * subdominios de un mismo dominio son «el mismo sitio»: si otra app de
 * `*.tu-dominio` (un CRM, un drive, un panel) tuviera un XSS, podría mandar a
 * esta API un POST con la cookie de quien la visita. Lax no lo impide; esto sí.
 *
 * Regla: una petición que CAMBIA algo (no GET/HEAD/OPTIONS), que trae la
 * cookie de sesión y que el navegador marca como venida de otro origen se
 * rechaza. Sin cookie de sesión no hay nada que falsificar (webhooks, bot,
 * MCP y OAuth se autentican con firma o llave, no con cookie).
 *
 * Función pura (sin Next) para probarla sola: `src/middleware.ts` la aplica.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rutas que nunca dependen de la cookie de sesión del navegador, o que ya
 * traen su propio control de origen:
 * - /api/auth: better-auth valida `Origin` contra sus orígenes de confianza.
 * - webhooks, bot, mcp, oauth: firma HMAC, llave o token Bearer.
 * - account-link y upload-links: un token de un solo uso en la URL.
 * - csp-report: el navegador lo manda solo; no cambia nada de nadie.
 * - dev: mocks, 404 en producción (`mockGuard`).
 */
const EXEMPT_PREFIXES = [
  "/api/auth/",
  "/api/webhooks/",
  "/api/bot/",
  "/api/mcp",
  "/api/oauth/",
  "/api/account-link/",
  "/api/ai-connector/upload-links/",
  "/api/csp-report",
  "/api/dev/",
];

/** better-auth: `better-auth.session_token`, con `__Secure-` delante en HTTPS. */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-|__Host-)?better-auth\.session_token=/;

export type CsrfInput = {
  method: string;
  pathname: string;
  cookie: string | null;
  /** Cabecera `Origin`. */
  origin: string | null;
  /** Cabecera `Sec-Fetch-Site` (same-origin | same-site | cross-site | none). */
  secFetchSite: string | null;
  /** El host al que llegó la petición (`X-Forwarded-Host` o `Host`). */
  host: string | null;
};

function isExempt(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** true = rechazar: escritura con cookie de sesión que viene de otro origen. */
export function isCrossSiteWrite(input: CsrfInput): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return false;
  if (!input.pathname.startsWith("/api/")) return false;
  if (isExempt(input.pathname)) return false;
  if (!input.cookie || !SESSION_COOKIE.test(input.cookie)) return false;

  // Los navegadores actuales mandan Sec-Fetch-Site: es la señal más fiable.
  // `none` = la persona escribió la URL o vino de un marcador: no hay sitio
  // atacante detrás.
  const site = input.secFetchSite?.toLowerCase().trim();
  if (site) return site !== "same-origin" && site !== "none";

  // Navegadores sin Sec-Fetch-*: el Origin debe ser este mismo host.
  if (input.origin && input.origin !== "null") {
    const from = hostOf(input.origin);
    const to = input.host?.split(",")[0]?.trim().toLowerCase() ?? null;
    return !from || !to || from !== to;
  }
  // `Origin: null` (iframe sandbox, redirecciones raras) con cookie: rechazar.
  if (input.origin === "null") return true;

  // Sin ninguna de las dos: no es un navegador (curl, un script con la cookie
  // copiada). CSRF necesita un navegador engañado; aquí no lo hay.
  return false;
}
