import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { isAiConfigured } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { agentConfigSchema, type AgentConfig } from "@/server/agents/config";
import { runReview } from "@/server/agents/creator";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

const PER_MINUTE = 10;
const MAX_BODY_CHARS = 64_000;

const bodySchema = z.object({
  config: agentConfigSchema,
  transcript: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(2000) })).min(2).max(40),
});

/** «Revisar este chat»: analiza la conversación de prueba y sugiere ajustes. No guarda nada. */
export const POST = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  if (!isAiConfigured()) return apiError(409, "ai_not_configured", "Configura tu proveedor de IA para revisar el chat");
  const limit = checkRateLimit(`lab-review:${session.userId}`, { windowMs: 60_000, max: PER_MINUTE });
  if (!limit.allowed) return apiError(429, "review_rate_limited", "Vas muy rápido. Espera un momento.");

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return apiError(413, "body_too_large", "La conversación de prueba es demasiado larga; reiníciala");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return apiError(422, "invalid_body", "El body debe ser JSON válido");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return apiError(422, "invalid_body", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }

  const result = await runReview({ organizationId: session.organizationId, config: parsed.data.config as AgentConfig, transcript: parsed.data.transcript });
  if (!result.ok) {
    if (result.error === "quota_exceeded") return apiError(429, "quota_exceeded", "Se agotó la cuota mensual de IA de tu negocio");
    if (result.error === "not_configured") return apiError(409, "ai_not_configured", "Configura tu proveedor de IA para revisar el chat");
    return apiError(502, "provider_error", "No se pudo revisar el chat. Inténtalo de nuevo.");
  }
  return Response.json(result);
}, { permission: "agent.manage" });
