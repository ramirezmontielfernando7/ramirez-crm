import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { consumeAccountLink, inspectAccountLink, MIN_PASSWORD_LENGTH } from "@/server/platform-admin/links";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** Pública (sin sesión): el token ES la credencial. Límite por IP. */
const LIMIT = { windowMs: 10 * 60 * 1000, max: 20 };

const REASON: Record<string, string> = {
  invalid: "El enlace no es válido.",
  used: "Este enlace ya se usó. Pide uno nuevo a soporte de la plataforma.",
  expired: "El enlace caducó. Pide uno nuevo a soporte de la plataforma.",
};

/** Fase 3, PR 2 — ¿Qué es este enlace? (sin usarlo). */
export async function GET(req: Request, { params }: Params) {
  if (!checkRateLimit(`account-link:${clientIp(req.headers)}`, LIMIT).allowed) {
    return apiError(429, "rate_limited", "Demasiados intentos; espera unos minutos");
  }
  const { token } = await params;
  const info = await inspectAccountLink(token);
  if (!info.ok) return apiError(410, info.reason, REASON[info.reason] ?? "El enlace no es válido.");
  return Response.json({ purpose: info.purpose, name: info.name, email: info.emailMasked });
}

const schema = z.object({ password: z.string().min(1).max(200) });

/** Fase 3, PR 2 — Usa el enlace: la persona pone su contraseña. */
export async function POST(req: Request, { params }: Params) {
  if (!checkRateLimit(`account-link:${clientIp(req.headers)}`, LIMIT).allowed) {
    return apiError(429, "rate_limited", "Demasiados intentos; espera unos minutos");
  }
  const { token } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const result = await consumeAccountLink({
    token,
    password: body.data.password,
    ip: clientIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  if (!result.ok) {
    if (result.reason === "weak_password") {
      return apiError(422, "weak_password", `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    }
    return apiError(410, result.reason, REASON[result.reason] ?? "El enlace no es válido.");
  }
  return Response.json({ ok: true, purpose: result.purpose });
}
