import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

const log = logger("csp");

/** Pública (el navegador la llama sin sesión). Límite por IP. */
const LIMIT = { windowMs: 60_000, max: 30 };

/** Solo el host de lo bloqueado: la ruta o la query podrían traer datos. */
function soloHost(uri: unknown): string {
  if (typeof uri !== "string" || !uri) return "-";
  if (!uri.includes("/")) return uri.slice(0, 40); // "inline", "eval", "data"…
  try {
    return new URL(uri).host || uri.slice(0, 20);
  } catch {
    return "uri-ilegible";
  }
}

/**
 * Fase 3, PR 2 (H10) — Reportes de la CSP en modo reporte: qué bloquearía
 * la política si fuera obligatoria. Se registra la directiva y el host, nada
 * más. Responde 204 siempre (el navegador no espera nada).
 */
export async function POST(req: Request) {
  if (!checkRateLimit(`csp-report:${clientIp(req.headers)}`, LIMIT).allowed) {
    return new Response(null, { status: 204 });
  }
  const text = (await req.text()).slice(0, 20_000);
  try {
    const body = JSON.parse(text) as unknown;
    const reports = Array.isArray(body) ? body : [body];
    for (const r of reports.slice(0, 10)) {
      const raw = (r as { "csp-report"?: Record<string, unknown>; body?: Record<string, unknown> }) ?? {};
      const rep = raw["csp-report"] ?? raw.body ?? {};
      log.warn("la CSP bloquearía algo", {
        directiva: String(rep["violated-directive"] ?? rep["effectiveDirective"] ?? rep["effective-directive"] ?? "-").slice(0, 60),
        bloqueado: soloHost(rep["blocked-uri"] ?? rep["blockedURL"]),
      });
    }
  } catch {
    // Cuerpo ilegible: no hay nada que registrar.
  }
  return new Response(null, { status: 204 });
}
