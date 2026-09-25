import { apiError, parseBody, withAuth } from "@/lib/api";
import { isAiConfigured } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { writingRequestSchema } from "@/server/writing-assist/prompts";
import { rewriteDraft } from "@/server/writing-assist/rewrite";

export const dynamic = "force-dynamic";

/** 023 — Por persona: suficiente para escribir, no para vaciar el saldo. */
const LIMIT = { windowMs: 60_000, max: 30 };

/** ¿Hay IA configurada? El editor lo usa para habilitar la varita. */
export const GET = withAuth(async () => {
  return Response.json({ available: isAiConfigured() });
});

/**
 * 023 — Asistente de redacción: reescribe el borrador del asesor. Todos los
 * roles. No toca la conversación, el agente ni el pipeline.
 */
export const POST = withAuth(async (session, req: Request) => {
  const parsed = await parseBody(req, writingRequestSchema);
  if (!parsed.ok) return parsed.response;

  if (!isAiConfigured()) {
    return apiError(503, "not_configured", "La IA no está configurada en esta instancia");
  }
  if (!checkRateLimit(`writing-assist:${session.userId}`, LIMIT).allowed) {
    return apiError(429, "rate_limited", "Demasiadas solicitudes; espera un minuto");
  }

  const result = await rewriteDraft(parsed.data);
  if (!result.ok) {
    return result.error === "not_configured"
      ? apiError(503, "not_configured", "La IA no está configurada en esta instancia")
      : apiError(502, result.error, "La IA no pudo procesar el texto. Intenta de nuevo.");
  }
  return Response.json({ text: result.text });
});
